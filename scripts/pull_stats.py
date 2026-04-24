"""
scripts/pull_stats.py
─────────────────────
Nightly stats puller for JOYT. Fetches advanced stats from pybaseball
(Baseball Savant + FanGraphs) and writes to Postgres.

Triggered by GitHub Actions on a schedule.

ENV vars required:
  DATABASE_URL  — Postgres connection string

Local dev usage:
  export DATABASE_URL="postgresql://user:pass@host:5432/db"
  python scripts/pull_stats.py

It does three things:
  1. Finds active MLB players
  2. Maps them to our DB players (player_ids table)
  3. Pulls season stats and writes to batter_stats / pitcher_stats
"""
import os
import sys
import logging
from datetime import datetime
import re

import psycopg2
from psycopg2.extras import execute_batch
import pybaseball as pb

# Quiet pybaseball down
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

CURRENT_SEASON = datetime.now().year


# ── Helpers ──────────────────────────────────────────────────────────────
def normalize_name(name: str) -> str:
    """Lowercase, strip accents, remove punctuation for fuzzy matching."""
    if not name:
        return ''
    import unicodedata
    n = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    n = re.sub(r'\s+(jr|sr|iii|ii|iv)\.?$', '', n.lower().strip())
    n = re.sub(r'[^a-z0-9]', '', n)
    return n


def get_db():
    return psycopg2.connect(DATABASE_URL)


# ── Step 1: Match our DB players to MLBAM / FanGraphs IDs ───────────────
def build_player_id_map(conn):
    """
    For each player in our DB, look up their MLBAM and FanGraphs IDs
    using pybaseball's playerid_lookup and store in player_ids table.
    """
    log.info('Building player ID map…')

    with conn.cursor() as cur:
        cur.execute('SELECT id, name FROM players')
        our_players = cur.fetchall()

    log.info(f'  {len(our_players)} players in our DB')

    # Get existing mappings so we don't re-lookup
    with conn.cursor() as cur:
        cur.execute('SELECT player_id FROM player_ids WHERE mlbam_id IS NOT NULL')
        already_mapped = {row[0] for row in cur.fetchall()}

    to_lookup = [(pid, name) for pid, name in our_players if pid not in already_mapped]
    log.info(f'  {len(to_lookup)} players need ID lookup')

    if not to_lookup:
        return

    # Use Chadwick register (built-in to pybaseball) — efficient single lookup
    try:
        chadwick = pb.chadwick_register()
    except Exception as e:
        log.error(f'Failed to load Chadwick register: {e}')
        return

    # Build a name index
    chadwick['name_full_normalized'] = chadwick.apply(
        lambda row: normalize_name(f"{row['name_first']} {row['name_last']}"),
        axis=1
    )

    records = []
    unmatched = []
    for pid, name in to_lookup:
        norm = normalize_name(name)
        matches = chadwick[chadwick['name_full_normalized'] == norm]

        if len(matches) == 0:
            unmatched.append(name)
            continue

        # Prefer most recent player if multiple
        if len(matches) > 1:
            matches = matches.sort_values('mlb_played_last', ascending=False)

        row = matches.iloc[0]
        records.append((
            pid,
            int(row['key_mlbam']) if row['key_mlbam'] > 0 else None,
            int(row['key_fangraphs']) if row['key_fangraphs'] > 0 else None,
            str(row['key_bbref']) if row['key_bbref'] else None,
            norm,
        ))

    log.info(f'  Matched {len(records)}, unmatched {len(unmatched)}')
    if unmatched[:10]:
        log.info(f'  Unmatched sample: {unmatched[:10]}')

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


# ── Step 2: Pull batter stats from FanGraphs ─────────────────────────────
def pull_batter_stats(conn):
    log.info('Pulling batter stats from FanGraphs…')
    try:
        df = pb.batting_stats(CURRENT_SEASON, qual=1)  # qual=1 means anyone with at least 1 PA
    except Exception as e:
        log.error(f'batting_stats failed: {e}')
        return

    log.info(f'  {len(df)} batter-seasons returned')

    # Get our player mappings
    with conn.cursor() as cur:
        cur.execute('SELECT fangraphs_id, player_id FROM player_ids WHERE fangraphs_id IS NOT NULL')
        fg_to_pid = dict(cur.fetchall())

    records = []
    for _, row in df.iterrows():
        fg_id = int(row.get('IDfg', 0))
        pid = fg_to_pid.get(fg_id)
        if not pid:
            continue

        records.append((
            pid, CURRENT_SEASON,
            # Basic counting
            int(row.get('G', 0) or 0),
            int(row.get('AB', 0) or 0),
            int(row.get('PA', 0) or 0),
            int(row.get('R', 0) or 0),
            int(row.get('H', 0) or 0),
            int(row.get('2B', 0) or 0),
            int(row.get('3B', 0) or 0),
            int(row.get('HR', 0) or 0),
            int(row.get('RBI', 0) or 0),
            int(row.get('SB', 0) or 0),
            int(row.get('CS', 0) or 0),
            int(row.get('BB', 0) or 0),
            int(row.get('SO', 0) or 0),
            # Rate
            float(row.get('AVG') or 0) or None,
            float(row.get('OBP') or 0) or None,
            float(row.get('SLG') or 0) or None,
            float(row.get('OPS') or 0) or None,
            float(row.get('ISO') or 0) or None,
            float(row.get('BABIP') or 0) or None,
            float(row.get('wOBA') or 0) or None,
            float(row.get('wRC+') or 0) or None,
            # Advanced / Statcast
            float(row.get('Barrel%') or 0) or None,
            float(row.get('HardHit%') or 0) or None,
            float(row.get('EV') or 0) or None,
            float(row.get('maxEV') or 0) or None,
            float(row.get('LA') or 0) or None,
            float(row.get('xBA') or 0) or None,
            float(row.get('xSLG') or 0) or None,
            float(row.get('xwOBA') or 0) or None,
            # Plate discipline
            float(row.get('O-Swing%') or 0) or None,
            float(row.get('SwStr%') or 0) or None,
            float(row.get('Contact%') or 0) or None,
            float(row.get('Z-Contact%') or 0) or None,
            # Speed
            float(row.get('Spd') or 0) or None,
            'fangraphs',
        ))

    if not records:
        log.warning('  No batter records matched any of our players')
        return

    log.info(f'  Writing {len(records)} batter rows')
    with conn.cursor() as cur:
        # Clear this season's data for these players, then insert
        player_ids = [r[0] for r in records]
        cur.execute(
            'DELETE FROM batter_stats WHERE season = %s AND player_id = ANY(%s)',
            (CURRENT_SEASON, player_ids)
        )
        execute_batch(cur, """
            INSERT INTO batter_stats (
                player_id, season,
                games, at_bats, plate_apps, runs, hits, doubles, triples,
                home_runs, rbi, stolen_bases, caught_stealing, walks, strikeouts,
                avg, obp, slg, ops, iso, babip, w_oba, wrc_plus,
                barrel_pct, hard_hit_pct, avg_exit_velo, max_exit_velo, avg_launch_angle,
                xba, xslg, xwoba,
                chase_pct, whiff_pct, contact_pct, zone_contact_pct,
                sprint_speed,
                data_source, fetched_at
            ) VALUES (
                %s, %s,
                %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s,
                %s, NOW()
            )
        """, records)
    conn.commit()


# ── Step 3: Pull pitcher stats from FanGraphs ────────────────────────────
def pull_pitcher_stats(conn):
    log.info('Pulling pitcher stats from FanGraphs…')
    try:
        df = pb.pitching_stats(CURRENT_SEASON, qual=1)
    except Exception as e:
        log.error(f'pitching_stats failed: {e}')
        return

    log.info(f'  {len(df)} pitcher-seasons returned')

    with conn.cursor() as cur:
        cur.execute('SELECT fangraphs_id, player_id FROM player_ids WHERE fangraphs_id IS NOT NULL')
        fg_to_pid = dict(cur.fetchall())

    records = []
    for _, row in df.iterrows():
        fg_id = int(row.get('IDfg', 0))
        pid = fg_to_pid.get(fg_id)
        if not pid:
            continue

        records.append((
            pid, CURRENT_SEASON,
            # Basic
            int(row.get('G', 0) or 0),
            int(row.get('GS', 0) or 0),
            int(row.get('W', 0) or 0),
            int(row.get('L', 0) or 0),
            int(row.get('SV', 0) or 0),
            int(row.get('HLD', 0) or 0),
            int(row.get('QS', 0) or 0),
            float(row.get('IP', 0) or 0),
            int(row.get('H', 0) or 0),
            int(row.get('ER', 0) or 0),
            int(row.get('BB', 0) or 0),
            int(row.get('SO', 0) or 0),
            int(row.get('HR', 0) or 0),
            # Rate
            float(row.get('ERA') or 0) or None,
            float(row.get('WHIP') or 0) or None,
            float(row.get('K/9') or 0) or None,
            float(row.get('BB/9') or 0) or None,
            float(row.get('K%') or 0) or None,
            float(row.get('BB%') or 0) or None,
            float(row.get('K-BB%') or 0) or None,
            # Advanced
            float(row.get('FIP') or 0) or None,
            float(row.get('xFIP') or 0) or None,
            float(row.get('SIERA') or 0) or None,
            float(row.get('xERA') or 0) or None,
            float(row.get('WAR') or 0) or None,
            # Pitch profile
            float(row.get('FBv') or 0) or None,
            float(row.get('maxFBv') or 0) or None,
            float(row.get('SpinRate') or 0) or None,
            # Against
            float(row.get('Barrel%') or 0) or None,
            float(row.get('HardHit%') or 0) or None,
            float(row.get('xwOBA') or 0) or None,
            float(row.get('xBA') or 0) or None,
            # Discipline
            float(row.get('CSW%') or 0) or None,
            float(row.get('SwStr%') or 0) or None,
            float(row.get('O-Swing%') or 0) or None,
            float(row.get('Zone%') or 0) or None,
            'fangraphs',
        ))

    if not records:
        log.warning('  No pitcher records matched any of our players')
        return

    log.info(f'  Writing {len(records)} pitcher rows')
    with conn.cursor() as cur:
        player_ids = [r[0] for r in records]
        cur.execute(
            'DELETE FROM pitcher_stats WHERE season = %s AND player_id = ANY(%s)',
            (CURRENT_SEASON, player_ids)
        )
        execute_batch(cur, """
            INSERT INTO pitcher_stats (
                player_id, season,
                games, games_started, wins, losses, saves, holds,
                quality_starts, innings_pitched, hits_allowed, earned_runs,
                walks_allowed, strikeouts_pitched, homeruns_allowed,
                era, whip, k_per_9, bb_per_9, k_rate, bb_rate, k_minus_bb,
                fip, x_fip, siera, x_era, war,
                avg_fastball_velo, max_fastball_velo, spin_rate,
                barrel_pct_against, hard_hit_pct_against, xwoba_against, xba_against,
                csw_pct, sw_strike_pct, chase_pct_induced, zone_pct,
                data_source, fetched_at
            ) VALUES (
                %s, %s,
                %s, %s, %s, %s, %s, %s,
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


# ── Main ─────────────────────────────────────────────────────────────────
def main():
    log.info(f'Starting stats pull for {CURRENT_SEASON}')
    start = datetime.now()

    conn = get_db()
    try:
        build_player_id_map(conn)
        pull_batter_stats(conn)
        pull_pitcher_stats(conn)
    finally:
        conn.close()

    elapsed = (datetime.now() - start).total_seconds()
    log.info(f'Done in {elapsed:.1f}s')


if __name__ == '__main__':
    main()
