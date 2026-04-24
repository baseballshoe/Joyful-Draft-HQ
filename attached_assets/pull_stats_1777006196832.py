"""
scripts/pull_stats.py
─────────────────────
Nightly stats puller for JOYT.

Pulls from TWO sources:
  1. FanGraphs (via pybaseball + ScraperAPI) — wRC+, FIP, SIERA, xFIP, WAR
  2. Baseball Savant (via pybaseball direct) — barrel%, xwOBA, exit velo

ENV vars required:
  DATABASE_URL     — Postgres connection string
  SCRAPER_API_KEY  — ScraperAPI key for FanGraphs proxy (optional)

If SCRAPER_API_KEY is not set, FanGraphs will be attempted direct
(will 403 from GitHub IPs but works from local dev).
Savant always pulls direct — no proxy needed.
"""
import os
import sys
import logging
from datetime import datetime
import re
import warnings
from urllib.parse import urlencode

import psycopg2
from psycopg2.extras import execute_batch
import pybaseball as pb
import requests

# ── ScraperAPI wrapping ──────────────────────────────────────────────────
# We wrap requests.get/post so that only FanGraphs URLs route through
# ScraperAPI. Savant and other sites pass through unchanged.
SCRAPER_API_KEY = os.environ.get('SCRAPER_API_KEY')
_original_get  = requests.get
_original_post = requests.post

def _wrap_for_scraperapi(func):
    def wrapper(url, *args, **kwargs):
        if SCRAPER_API_KEY and 'fangraphs.com' in url:
            # Bake any caller-supplied params into the target URL
            extra_params = kwargs.pop('params', None) or {}
            target_url = url
            if extra_params:
                sep = '&' if '?' in url else '?'
                target_url = f"{url}{sep}{urlencode(extra_params)}"
            proxy_params = {
                'api_key': SCRAPER_API_KEY,
                'url':     target_url,
            }
            # ScraperAPI needs a longer timeout (renders JS, rotates IPs)
            kwargs['timeout'] = kwargs.get('timeout', 70)
            return func('https://api.scraperapi.com', params=proxy_params, *args, **kwargs)
        return func(url, *args, **kwargs)
    return wrapper

if SCRAPER_API_KEY:
    requests.get  = _wrap_for_scraperapi(_original_get)
    requests.post = _wrap_for_scraperapi(_original_post)


warnings.filterwarnings('ignore')
pb.cache.enable()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    log.error('DATABASE_URL not set')
    sys.exit(1)

if SCRAPER_API_KEY:
    log.info('ScraperAPI configured — FanGraphs requests will route through proxy')
else:
    log.warning('SCRAPER_API_KEY not set — FanGraphs will likely 403 from GitHub')

CURRENT_SEASON = datetime.now().year


# ── Helpers ──────────────────────────────────────────────────────────────
def normalize_name(name: str) -> str:
    if not name:
        return ''
    import unicodedata
    n = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    n = re.sub(r'\s+(jr|sr|iii|ii|iv)\.?$', '', n.lower().strip())
    n = re.sub(r'[^a-z0-9]', '', n)
    return n


def get_db():
    return psycopg2.connect(DATABASE_URL)


def safe_int(val):
    try:
        if val is None: return None
        f = float(val)
        if f != f: return None
        return int(f)
    except (ValueError, TypeError):
        return None


def safe_float(val):
    try:
        if val is None: return None
        f = float(val)
        if f != f: return None
        return f
    except (ValueError, TypeError):
        return None


# ── Step 1: Build player ID map ──────────────────────────────────────────
def build_player_id_map(conn):
    log.info('Building player ID map…')

    with conn.cursor() as cur:
        cur.execute('SELECT id, name FROM players')
        our_players = cur.fetchall()

    log.info(f'  {len(our_players)} players in our DB')

    with conn.cursor() as cur:
        cur.execute('SELECT player_id FROM player_ids WHERE mlbam_id IS NOT NULL')
        already_mapped = {row[0] for row in cur.fetchall()}

    to_lookup = [(pid, name) for pid, name in our_players if pid not in already_mapped]
    log.info(f'  {len(to_lookup)} players need ID lookup')

    if not to_lookup:
        log.info('  All players already mapped')
        return

    try:
        chadwick = pb.chadwick_register()
    except Exception as e:
        log.error(f'Failed to load Chadwick register: {e}')
        return

    chadwick['name_full_normalized'] = chadwick.apply(
        lambda row: normalize_name(f"{row['name_first']} {row['name_last']}"),
        axis=1
    )

    records = []
    unmatched = []
    for pid, name in to_lookup:
        norm = normalize_name(name)
        if not norm:
            unmatched.append(name)
            continue
        matches = chadwick[chadwick['name_full_normalized'] == norm]

        if len(matches) == 0:
            unmatched.append(name)
            continue

        if len(matches) > 1:
            matches = matches.sort_values('mlb_played_last', ascending=False)

        row = matches.iloc[0]
        records.append((
            pid,
            safe_int(row['key_mlbam']) if row['key_mlbam'] and row['key_mlbam'] > 0 else None,
            safe_int(row['key_fangraphs']) if row['key_fangraphs'] and row['key_fangraphs'] > 0 else None,
            str(row['key_bbref']) if row['key_bbref'] else None,
            norm,
        ))

    log.info(f'  Matched {len(records)}, unmatched {len(unmatched)}')

    if records:
        with conn.cursor() as cur:
            execute_batch(cur, """
                INSERT INTO player_ids
                    (player_id, mlbam_id, fangraphs_id, bbref_id, name_normalized, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (player_id)
                DO UPDATE SET
                    mlbam_id        = EXCLUDED.mlbam_id,
                    fangraphs_id    = EXCLUDED.fangraphs_id,
                    bbref_id        = EXCLUDED.bbref_id,
                    name_normalized = EXCLUDED.name_normalized,
                    updated_at      = NOW()
            """, records)
        conn.commit()


# ── Step 2: FanGraphs pulls (routed through ScraperAPI if configured) ───
def try_fangraphs_batters():
    strategies = [
        lambda: pb.batting_stats(CURRENT_SEASON, qual=1),
        lambda: pb.batting_stats(CURRENT_SEASON),
        lambda: pb.batting_stats(CURRENT_SEASON - 1, qual=100),
    ]
    for i, strategy in enumerate(strategies, 1):
        try:
            log.info(f'  Trying FanGraphs batter strategy {i}...')
            df = strategy()
            if df is not None and len(df) > 0:
                log.info(f'  Strategy {i} succeeded: {len(df)} rows')
                return df
        except Exception as e:
            log.warning(f'  Strategy {i} failed: {str(e)[:150]}')
    return None


def try_fangraphs_pitchers():
    strategies = [
        lambda: pb.pitching_stats(CURRENT_SEASON, qual=1),
        lambda: pb.pitching_stats(CURRENT_SEASON),
        lambda: pb.pitching_stats(CURRENT_SEASON - 1, qual=40),
    ]
    for i, strategy in enumerate(strategies, 1):
        try:
            log.info(f'  Trying FanGraphs pitcher strategy {i}...')
            df = strategy()
            if df is not None and len(df) > 0:
                log.info(f'  Strategy {i} succeeded: {len(df)} rows')
                return df
        except Exception as e:
            log.warning(f'  Strategy {i} failed: {str(e)[:150]}')
    return None


def pull_fangraphs_batters(conn):
    log.info('=== FanGraphs Batters ===')
    df = try_fangraphs_batters()
    if df is None:
        return 0

    with conn.cursor() as cur:
        cur.execute('SELECT fangraphs_id, player_id FROM player_ids WHERE fangraphs_id IS NOT NULL')
        fg_to_pid = dict(cur.fetchall())

    records = []
    for _, row in df.iterrows():
        fg_id = safe_int(row.get('IDfg'))
        pid = fg_to_pid.get(fg_id)
        if not pid: continue
        records.append((
            pid, CURRENT_SEASON,
            safe_int(row.get('G')), safe_int(row.get('AB')), safe_int(row.get('PA')),
            safe_int(row.get('R')), safe_int(row.get('H')),
            safe_int(row.get('2B')), safe_int(row.get('3B')), safe_int(row.get('HR')),
            safe_int(row.get('RBI')), safe_int(row.get('SB')), safe_int(row.get('CS')),
            safe_int(row.get('BB')), safe_int(row.get('SO')),
            safe_float(row.get('AVG')), safe_float(row.get('OBP')), safe_float(row.get('SLG')),
            safe_float(row.get('OPS')), safe_float(row.get('ISO')), safe_float(row.get('BABIP')),
            safe_float(row.get('wOBA')), safe_float(row.get('wRC+')),
            safe_float(row.get('Barrel%')), safe_float(row.get('HardHit%')),
            safe_float(row.get('EV')), safe_float(row.get('maxEV')), safe_float(row.get('LA')),
            safe_float(row.get('xBA')), safe_float(row.get('xSLG')), safe_float(row.get('xwOBA')),
            safe_float(row.get('O-Swing%')), safe_float(row.get('SwStr%')),
            safe_float(row.get('Contact%')), safe_float(row.get('Z-Contact%')),
            safe_float(row.get('Spd')),
            'fangraphs',
        ))

    if not records:
        log.warning('  No FanGraphs batter rows matched our players')
        return 0

    log.info(f'  Writing {len(records)} batter rows from FanGraphs')
    with conn.cursor() as cur:
        player_ids = [r[0] for r in records]
        cur.execute(
            'DELETE FROM batter_stats WHERE season = %s AND player_id = ANY(%s) AND data_source LIKE %s',
            (CURRENT_SEASON, player_ids, '%fangraphs%')
        )
        execute_batch(cur, """
            INSERT INTO batter_stats (
                player_id, season, games, at_bats, plate_apps, runs, hits, doubles, triples,
                home_runs, rbi, stolen_bases, caught_stealing, walks, strikeouts,
                avg, obp, slg, ops, iso, babip, w_oba, wrc_plus,
                barrel_pct, hard_hit_pct, avg_exit_velo, max_exit_velo, avg_launch_angle,
                xba, xslg, xwoba, chase_pct, whiff_pct, contact_pct, zone_contact_pct,
                sprint_speed, data_source, fetched_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, NOW()
            )
        """, records)
    conn.commit()
    return len(records)


def pull_fangraphs_pitchers(conn):
    log.info('=== FanGraphs Pitchers ===')
    df = try_fangraphs_pitchers()
    if df is None:
        return 0

    with conn.cursor() as cur:
        cur.execute('SELECT fangraphs_id, player_id FROM player_ids WHERE fangraphs_id IS NOT NULL')
        fg_to_pid = dict(cur.fetchall())

    records = []
    for _, row in df.iterrows():
        fg_id = safe_int(row.get('IDfg'))
        pid = fg_to_pid.get(fg_id)
        if not pid: continue
        records.append((
            pid, CURRENT_SEASON,
            safe_int(row.get('G')), safe_int(row.get('GS')),
            safe_int(row.get('W')), safe_int(row.get('L')),
            safe_int(row.get('SV')), safe_int(row.get('HLD')),
            safe_int(row.get('QS')), safe_float(row.get('IP')),
            safe_int(row.get('H')), safe_int(row.get('ER')),
            safe_int(row.get('BB')), safe_int(row.get('SO')),
            safe_int(row.get('HR')),
            safe_float(row.get('ERA')), safe_float(row.get('WHIP')),
            safe_float(row.get('K/9')), safe_float(row.get('BB/9')),
            safe_float(row.get('K%')), safe_float(row.get('BB%')),
            safe_float(row.get('K-BB%')),
            safe_float(row.get('FIP')), safe_float(row.get('xFIP')),
            safe_float(row.get('SIERA')), safe_float(row.get('xERA')),
            safe_float(row.get('WAR')),
            safe_float(row.get('FBv')), safe_float(row.get('maxFBv')),
            safe_float(row.get('SpinRate')),
            safe_float(row.get('Barrel%')), safe_float(row.get('HardHit%')),
            safe_float(row.get('xwOBA')), safe_float(row.get('xBA')),
            safe_float(row.get('CSW%')), safe_float(row.get('SwStr%')),
            safe_float(row.get('O-Swing%')), safe_float(row.get('Zone%')),
            'fangraphs',
        ))

    if not records:
        log.warning('  No FanGraphs pitcher rows matched our players')
        return 0

    log.info(f'  Writing {len(records)} pitcher rows from FanGraphs')
    with conn.cursor() as cur:
        player_ids = [r[0] for r in records]
        cur.execute(
            'DELETE FROM pitcher_stats WHERE season = %s AND player_id = ANY(%s) AND data_source LIKE %s',
            (CURRENT_SEASON, player_ids, '%fangraphs%')
        )
        execute_batch(cur, """
            INSERT INTO pitcher_stats (
                player_id, season, games, games_started, wins, losses, saves, holds,
                quality_starts, innings_pitched, hits_allowed, earned_runs,
                walks_allowed, strikeouts_pitched, homeruns_allowed,
                era, whip, k_per_9, bb_per_9, k_rate, bb_rate, k_minus_bb,
                fip, x_fip, siera, x_era, war,
                avg_fastball_velo, max_fastball_velo, spin_rate,
                barrel_pct_against, hard_hit_pct_against, xwoba_against, xba_against,
                csw_pct, sw_strike_pct, chase_pct_induced, zone_pct,
                data_source, fetched_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, NOW()
            )
        """, records)
    conn.commit()
    return len(records)


# ── Step 3: Baseball Savant pulls (direct, no proxy needed) ──────────────
def pull_savant_batters(conn):
    log.info('=== Baseball Savant Batters ===')

    try:
        df = pb.statcast_batter_expected_stats(CURRENT_SEASON, minPA=1)
        log.info(f'  Fetched {len(df)} batter xStats rows')
    except Exception as e:
        log.warning(f'  Expected stats fetch failed: {str(e)[:120]}')
        df = None

    try:
        df_ev = pb.statcast_batter_exitvelo_barrels(CURRENT_SEASON, minBBE=1)
        log.info(f'  Fetched {len(df_ev)} batter exit velo rows')
    except Exception as e:
        log.warning(f'  Exit velo fetch failed: {str(e)[:120]}')
        df_ev = None

    if df is None and df_ev is None:
        return 0

    with conn.cursor() as cur:
        cur.execute('SELECT mlbam_id, player_id FROM player_ids WHERE mlbam_id IS NOT NULL')
        mlbam_to_pid = dict(cur.fetchall())

    records = {}
    if df is not None:
        for _, row in df.iterrows():
            mlbam = safe_int(row.get('player_id'))
            pid = mlbam_to_pid.get(mlbam)
            if not pid: continue
            records.setdefault(pid, {}).update({
                'xba':   safe_float(row.get('est_ba')),
                'xslg':  safe_float(row.get('est_slg')),
                'xwoba': safe_float(row.get('est_woba')),
                'avg':   safe_float(row.get('ba')),
                'slg':   safe_float(row.get('slg')),
                'woba':  safe_float(row.get('woba')),
            })

    if df_ev is not None:
        for _, row in df_ev.iterrows():
            mlbam = safe_int(row.get('player_id'))
            pid = mlbam_to_pid.get(mlbam)
            if not pid: continue
            records.setdefault(pid, {}).update({
                'avg_ev':      safe_float(row.get('avg_hit_speed')),
                'max_ev':      safe_float(row.get('max_hit_speed')),
                'barrel_pct':  safe_float(row.get('brl_percent')),
                'hardhit_pct': safe_float(row.get('ev95percent')),
                'avg_la':      safe_float(row.get('avg_hit_angle')),
            })

    if not records:
        return 0

    rows_to_insert = []
    for pid, stats in records.items():
        rows_to_insert.append((
            pid, CURRENT_SEASON,
            None, None, None, None, None, None, None, None,
            None, None, None, None, None,
            stats.get('avg'), None, stats.get('slg'), None, None, None,
            stats.get('woba'), None,
            stats.get('barrel_pct'), stats.get('hardhit_pct'),
            stats.get('avg_ev'), stats.get('max_ev'), stats.get('avg_la'),
            stats.get('xba'), stats.get('xslg'), stats.get('xwoba'),
            None, None, None, None, None,
            'savant',
        ))

    log.info(f'  Writing {len(rows_to_insert)} batter rows from Savant')
    with conn.cursor() as cur:
        player_ids = [r[0] for r in rows_to_insert]
        cur.execute(
            'DELETE FROM batter_stats WHERE season = %s AND player_id = ANY(%s) AND data_source = %s',
            (CURRENT_SEASON, player_ids, 'savant')
        )
        execute_batch(cur, """
            INSERT INTO batter_stats (
                player_id, season, games, at_bats, plate_apps, runs, hits, doubles, triples,
                home_runs, rbi, stolen_bases, caught_stealing, walks, strikeouts,
                avg, obp, slg, ops, iso, babip, w_oba, wrc_plus,
                barrel_pct, hard_hit_pct, avg_exit_velo, max_exit_velo, avg_launch_angle,
                xba, xslg, xwoba, chase_pct, whiff_pct, contact_pct, zone_contact_pct,
                sprint_speed, data_source, fetched_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, NOW()
            )
        """, rows_to_insert)
    conn.commit()
    return len(rows_to_insert)


def pull_savant_pitchers(conn):
    log.info('=== Baseball Savant Pitchers ===')

    try:
        df = pb.statcast_pitcher_expected_stats(CURRENT_SEASON, minPA=1)
        log.info(f'  Fetched {len(df)} pitcher xStats rows')
    except Exception as e:
        log.warning(f'  Expected stats fetch failed: {str(e)[:120]}')
        df = None

    try:
        df_ev = pb.statcast_pitcher_exitvelo_barrels(CURRENT_SEASON, minBBE=1)
        log.info(f'  Fetched {len(df_ev)} pitcher exit velo rows')
    except Exception as e:
        log.warning(f'  Exit velo fetch failed: {str(e)[:120]}')
        df_ev = None

    if df is None and df_ev is None:
        return 0

    with conn.cursor() as cur:
        cur.execute('SELECT mlbam_id, player_id FROM player_ids WHERE mlbam_id IS NOT NULL')
        mlbam_to_pid = dict(cur.fetchall())

    records = {}
    if df is not None:
        for _, row in df.iterrows():
            mlbam = safe_int(row.get('player_id'))
            pid = mlbam_to_pid.get(mlbam)
            if not pid: continue
            records.setdefault(pid, {}).update({
                'xba_against':   safe_float(row.get('est_ba')),
                'xwoba_against': safe_float(row.get('est_woba')),
            })

    if df_ev is not None:
        for _, row in df_ev.iterrows():
            mlbam = safe_int(row.get('player_id'))
            pid = mlbam_to_pid.get(mlbam)
            if not pid: continue
            records.setdefault(pid, {}).update({
                'barrel_pct_against':  safe_float(row.get('brl_percent')),
                'hardhit_pct_against': safe_float(row.get('ev95percent')),
            })

    if not records:
        return 0

    rows_to_insert = []
    for pid, stats in records.items():
        rows_to_insert.append((
            pid, CURRENT_SEASON,
            None, None, None, None, None, None,
            None, None, None, None,
            None, None, None,
            None, None, None, None, None, None, None,
            None, None, None, None, None,
            None, None, None,
            stats.get('barrel_pct_against'), stats.get('hardhit_pct_against'),
            stats.get('xwoba_against'), stats.get('xba_against'),
            None, None, None, None,
            'savant',
        ))

    log.info(f'  Writing {len(rows_to_insert)} pitcher rows from Savant')
    with conn.cursor() as cur:
        player_ids = [r[0] for r in rows_to_insert]
        cur.execute(
            'DELETE FROM pitcher_stats WHERE season = %s AND player_id = ANY(%s) AND data_source = %s',
            (CURRENT_SEASON, player_ids, 'savant')
        )
        execute_batch(cur, """
            INSERT INTO pitcher_stats (
                player_id, season, games, games_started, wins, losses, saves, holds,
                quality_starts, innings_pitched, hits_allowed, earned_runs,
                walks_allowed, strikeouts_pitched, homeruns_allowed,
                era, whip, k_per_9, bb_per_9, k_rate, bb_rate, k_minus_bb,
                fip, x_fip, siera, x_era, war,
                avg_fastball_velo, max_fastball_velo, spin_rate,
                barrel_pct_against, hard_hit_pct_against, xwoba_against, xba_against,
                csw_pct, sw_strike_pct, chase_pct_induced, zone_pct,
                data_source, fetched_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, NOW()
            )
        """, rows_to_insert)
    conn.commit()
    return len(rows_to_insert)


# ── Main ─────────────────────────────────────────────────────────────────
def main():
    log.info(f'Starting stats pull for season {CURRENT_SEASON}')
    start = datetime.now()

    conn = get_db()
    totals = {'fg_batters': 0, 'fg_pitchers': 0, 'sv_batters': 0, 'sv_pitchers': 0}

    try:
        build_player_id_map(conn)

        try: totals['fg_batters']  = pull_fangraphs_batters(conn)
        except Exception as e: log.error(f'FanGraphs batters crashed: {e}')

        try: totals['fg_pitchers'] = pull_fangraphs_pitchers(conn)
        except Exception as e: log.error(f'FanGraphs pitchers crashed: {e}')

        try: totals['sv_batters']  = pull_savant_batters(conn)
        except Exception as e: log.error(f'Savant batters crashed: {e}')

        try: totals['sv_pitchers'] = pull_savant_pitchers(conn)
        except Exception as e: log.error(f'Savant pitchers crashed: {e}')

    finally:
        conn.close()

    elapsed = (datetime.now() - start).total_seconds()
    log.info('=' * 50)
    log.info('Summary:')
    log.info(f'  FanGraphs batters: {totals["fg_batters"]} rows')
    log.info(f'  FanGraphs pitchers: {totals["fg_pitchers"]} rows')
    log.info(f'  Savant batters: {totals["sv_batters"]} rows')
    log.info(f'  Savant pitchers: {totals["sv_pitchers"]} rows')
    log.info(f'  Completed in {elapsed:.1f}s')

    if sum(totals.values()) == 0:
        log.error('Zero rows written from any source')
        sys.exit(1)


if __name__ == '__main__':
    main()
