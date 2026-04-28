"""
scripts/pull_basic_stats.py
───────────────────────────
Nightly basic-stats backfill for JOYT, sourced from MLB Stats API.

WHY THIS EXISTS:
  v1.3's pull_players.py got every active MLB player into our DB with
  their MLBAM IDs. Savant + FanGraphs scraping (via pybaseball) layer
  on advanced metrics — but pybaseball's coverage of recently-debuted
  players is incomplete (Statcast tables backfill on different
  schedules). Result: rookies like Parker Messick had zero or near-zero
  basic stats (ERA, WHIP, IP, GS, K, BB, QS) in our DB.

  This script fills that gap by pulling season stats from MLB Stats API
  directly. MLB Stats API is the source of truth — every active player
  has every basic stat as soon as they appear in a game.

WHAT THIS DOES:
  1. Fetches season pitching stats for ALL active MLB pitchers in one call
  2. Fetches season batting stats for ALL active MLB batters in one call
  3. For each split, looks up player_id by mlbam_id (via player_ids table)
  4. Writes rows to pitcher_stats / batter_stats with data_source='mlb-stats-api'
  5. Coach's context layer merges these with Savant + FanGraphs rows so
     the model sees the full picture per player

ORDER IN THE DAILY WORKFLOWS:
  06:00 UTC — pull-players.yml      (seeds player roster + MLBAM IDs)
  06:15 UTC — pull-basic-stats.yml  (this script — fills basic stats)
  06:30 UTC — pull-stats.yml        (existing — Savant + FanGraphs advanced)

⚠️ COMMERCIAL LICENSING:
  MLB Stats API is non-commercial-only. Replace before charging users.
  TODO(commercial): swap to SportsDataIO/Sportradar before Phase 3.

ENV vars required:
  DATABASE_URL  — Postgres connection string (Neon production)

Usage:
  python scripts/pull_basic_stats.py
"""
import os
import sys
import logging
from datetime import datetime
from typing import Optional

import psycopg2
from psycopg2.extras import execute_batch
import requests

# ── Setup ────────────────────────────────────────────────────────────────
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
MLB_API_BASE   = 'https://statsapi.mlb.com/api/v1'
DATA_SOURCE    = 'mlb-stats-api'


# ── Helpers ──────────────────────────────────────────────────────────────
def get_db():
    return psycopg2.connect(DATABASE_URL)


def safe_int(v) -> Optional[int]:
    if v is None or v == '': return None
    try:
        f = float(v)
        if f != f: return None  # NaN
        return int(f)
    except (ValueError, TypeError):
        return None


def safe_float(v) -> Optional[float]:
    if v is None or v == '': return None
    try:
        f = float(v)
        if f != f: return None
        return f
    except (ValueError, TypeError):
        return None


def parse_innings(ip_str) -> Optional[float]:
    """
    MLB Stats API returns inningsPitched as a string like '30.2'.
    In baseball notation, .1 = 1/3 and .2 = 2/3 of an inning. We store
    as decimal float matching the convention used by FanGraphs scrape
    (which also stores '30.2' as 30.2 decimal — slightly imprecise but
    consistent across sources).
    """
    return safe_float(ip_str)


# ── Step 1: Fetch the bulk stats from MLB Stats API ──────────────────────
def fetch_season_stats(group: str) -> list[dict]:
    """
    group: 'pitching' or 'hitting'
    Returns a list of split dicts, each containing player + team + stat.
    """
    url = f'{MLB_API_BASE}/stats'
    params = {
        'stats':       'season',
        'season':      CURRENT_SEASON,
        'group':       group,
        'sportIds':    1,
        'playerPool':  'All',
        'limit':       2000,
    }
    log.info(f'Fetching {group} stats for {CURRENT_SEASON}...')
    res = requests.get(url, params=params, timeout=60)
    res.raise_for_status()
    payload = res.json()

    splits = []
    for stat_block in payload.get('stats', []):
        splits.extend(stat_block.get('splits', []) or [])
    log.info(f'  Got {len(splits)} {group} splits')
    return splits


# ── Step 2: Map MLBAM IDs to our player_id ───────────────────────────────
def build_mlbam_to_pid(conn) -> dict[int, int]:
    """
    Reads player_ids + player_status to build the mlbam_id → player_id map.
    Both are populated by pull_players.py from the v1.3 release.
    """
    out: dict[int, int] = {}
    with conn.cursor() as cur:
        cur.execute('SELECT player_id, mlbam_id FROM player_ids WHERE mlbam_id IS NOT NULL')
        for pid, mlbam in cur.fetchall():
            out[int(mlbam)] = int(pid)
        cur.execute('SELECT player_id, mlbam_id FROM player_status WHERE mlbam_id IS NOT NULL')
        for pid, mlbam in cur.fetchall():
            out.setdefault(int(mlbam), int(pid))
    log.info(f'  {len(out)} player_id mappings available')
    return out


# ── Step 3: Transform splits into row tuples ─────────────────────────────
def split_to_pitcher_row(split: dict, pid: int) -> Optional[tuple]:
    s = split.get('stat') or {}
    if not s:
        return None

    return (
        pid,                                       CURRENT_SEASON,
        # Sample
        safe_int(s.get('gamesPlayed')),            safe_int(s.get('gamesStarted')),
        safe_int(s.get('wins')),                   safe_int(s.get('losses')),
        safe_int(s.get('saves')),                  safe_int(s.get('holds')),
        safe_int(s.get('qualityStarts')),
        parse_innings(s.get('inningsPitched')),
        # Counting against
        safe_int(s.get('hits')),                   safe_int(s.get('earnedRuns')),
        safe_int(s.get('baseOnBalls')),            safe_int(s.get('strikeOuts')),
        safe_int(s.get('homeRuns')),
        # Rate
        safe_float(s.get('era')),                  safe_float(s.get('whip')),
        safe_float(s.get('strikeoutsPer9Inn')),
        safe_float(s.get('walksPer9Inn')),
        # Source / timestamp
        DATA_SOURCE,
    )


def split_to_batter_row(split: dict, pid: int) -> Optional[tuple]:
    s = split.get('stat') or {}
    if not s:
        return None

    avg = safe_float(s.get('avg'))
    slg = safe_float(s.get('slg'))
    iso = (slg - avg) if (slg is not None and avg is not None) else None

    return (
        pid,                                       CURRENT_SEASON,
        # Sample
        safe_int(s.get('gamesPlayed')),            safe_int(s.get('atBats')),
        safe_int(s.get('plateAppearances')),
        # Counting
        safe_int(s.get('runs')),                   safe_int(s.get('hits')),
        safe_int(s.get('doubles')),                safe_int(s.get('triples')),
        safe_int(s.get('homeRuns')),               safe_int(s.get('rbi')),
        safe_int(s.get('stolenBases')),            safe_int(s.get('caughtStealing')),
        safe_int(s.get('baseOnBalls')),            safe_int(s.get('strikeOuts')),
        # Rate
        avg,                                       safe_float(s.get('obp')),
        slg,                                       safe_float(s.get('ops')),
        iso,                                       safe_float(s.get('babip')),
        DATA_SOURCE,
    )


# ── Step 4: Write to pitcher_stats / batter_stats ────────────────────────
def write_pitcher_rows(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    log.info(f'  Writing {len(rows)} pitcher rows...')
    with conn.cursor() as cur:
        # Replace all MLB Stats API rows for this season
        cur.execute("""
            DELETE FROM pitcher_stats
            WHERE season = %s AND data_source = %s
        """, (CURRENT_SEASON, DATA_SOURCE))
        execute_batch(cur, """
            INSERT INTO pitcher_stats (
                player_id, season,
                games, games_started, wins, losses, saves, holds,
                quality_starts, innings_pitched,
                hits_allowed, earned_runs, walks_allowed,
                strikeouts_pitched, homeruns_allowed,
                era, whip, k_per_9, bb_per_9,
                data_source, fetched_at
            ) VALUES (
                %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s, NOW()
            )
        """, rows)
    conn.commit()
    return len(rows)


def write_batter_rows(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    log.info(f'  Writing {len(rows)} batter rows...')
    with conn.cursor() as cur:
        cur.execute("""
            DELETE FROM batter_stats
            WHERE season = %s AND data_source = %s
        """, (CURRENT_SEASON, DATA_SOURCE))
        execute_batch(cur, """
            INSERT INTO batter_stats (
                player_id, season,
                games, at_bats, plate_apps,
                runs, hits, doubles, triples,
                home_runs, rbi, stolen_bases, caught_stealing,
                walks, strikeouts,
                avg, obp, slg, ops, iso, babip,
                data_source, fetched_at
            ) VALUES (
                %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, NOW()
            )
        """, rows)
    conn.commit()
    return len(rows)


# ── Step 5: Aggregate splits per player (handles mid-season trades) ──────
def aggregate_splits_per_player(splits: list[dict]) -> dict[int, dict]:
    """
    A traded player has multiple splits (one per team). We sum counting
    stats and recompute rate stats from the aggregated counting. For
    players with one split, this is a no-op.

    Returns: dict[mlbam_id → aggregated split dict]
    """
    by_mlbam: dict[int, dict] = {}
    for sp in splits:
        player = sp.get('player') or {}
        pid = player.get('id')
        if not pid:
            continue

        if pid not in by_mlbam:
            # First split for this player — start with a copy
            by_mlbam[pid] = sp
            continue

        # Subsequent split — aggregate. We sum counting stats and let
        # the rate stats be recomputed below.
        existing = by_mlbam[pid]
        e_stat = existing.get('stat') or {}
        n_stat = sp.get('stat') or {}

        for k in ['gamesPlayed', 'gamesStarted', 'wins', 'losses', 'saves',
                  'holds', 'qualityStarts', 'hits', 'earnedRuns', 'baseOnBalls',
                  'strikeOuts', 'homeRuns', 'atBats', 'plateAppearances',
                  'runs', 'doubles', 'triples', 'rbi', 'stolenBases',
                  'caughtStealing']:
            if k in e_stat or k in n_stat:
                e_stat[k] = (safe_int(e_stat.get(k)) or 0) + (safe_int(n_stat.get(k)) or 0)

        # Innings pitched aggregation (decimal sum is "good enough")
        if 'inningsPitched' in e_stat or 'inningsPitched' in n_stat:
            e_ip = safe_float(e_stat.get('inningsPitched')) or 0
            n_ip = safe_float(n_stat.get('inningsPitched')) or 0
            e_stat['inningsPitched'] = str(e_ip + n_ip)

        # Recompute rate stats from aggregated counting
        ip = safe_float(e_stat.get('inningsPitched')) or 0
        if ip > 0:
            er = safe_int(e_stat.get('earnedRuns')) or 0
            h = safe_int(e_stat.get('hits')) or 0
            bb = safe_int(e_stat.get('baseOnBalls')) or 0
            so = safe_int(e_stat.get('strikeOuts')) or 0
            e_stat['era']  = round((er * 9.0) / ip, 2)
            e_stat['whip'] = round((h + bb) / ip, 3)
            e_stat['strikeoutsPer9Inn'] = round((so * 9.0) / ip, 2)
            e_stat['walksPer9Inn']      = round((bb * 9.0) / ip, 2)

        # Recompute batting rate stats
        ab = safe_int(e_stat.get('atBats')) or 0
        if ab > 0:
            h = safe_int(e_stat.get('hits')) or 0
            doubles = safe_int(e_stat.get('doubles')) or 0
            triples = safe_int(e_stat.get('triples')) or 0
            hr = safe_int(e_stat.get('homeRuns')) or 0
            bb = safe_int(e_stat.get('baseOnBalls')) or 0
            so = safe_int(e_stat.get('strikeOuts')) or 0
            pa = safe_int(e_stat.get('plateAppearances')) or 0
            tb = h + doubles + (2 * triples) + (3 * hr)
            e_stat['avg'] = round(h / ab, 3)
            if pa > 0:
                # Approximate OBP — accurate calc needs HBP+SF which
                # the bulk endpoint may not include. Good enough for
                # newly-debuted players.
                e_stat['obp'] = round((h + bb) / pa, 3)
            e_stat['slg'] = round(tb / ab, 3)
            avg = e_stat.get('avg') or 0
            obp = e_stat.get('obp') or 0
            slg = e_stat.get('slg') or 0
            e_stat['ops'] = round(obp + slg, 3)

        existing['stat'] = e_stat
        by_mlbam[pid] = existing
    return by_mlbam


# ── Main ─────────────────────────────────────────────────────────────────
def main():
    log.info(f'Starting basic stats pull for season {CURRENT_SEASON}')
    start = datetime.now()
    conn = get_db()

    try:
        mlbam_to_pid = build_mlbam_to_pid(conn)
        if not mlbam_to_pid:
            log.error('No MLBAM mappings — run pull_players.py first')
            sys.exit(1)

        # ── Pitchers ────────────────────────────────────────────────────
        pitching_splits = fetch_season_stats('pitching')
        pitching_by_mlbam = aggregate_splits_per_player(pitching_splits)

        pitcher_rows = []
        unmatched_pitchers = 0
        for mlbam, sp in pitching_by_mlbam.items():
            pid = mlbam_to_pid.get(mlbam)
            if not pid:
                unmatched_pitchers += 1
                continue
            row = split_to_pitcher_row(sp, pid)
            if row:
                pitcher_rows.append(row)
        log.info(f'  Pitchers: matched {len(pitcher_rows)}, unmatched {unmatched_pitchers}')

        # ── Batters ─────────────────────────────────────────────────────
        batting_splits = fetch_season_stats('hitting')
        batting_by_mlbam = aggregate_splits_per_player(batting_splits)

        batter_rows = []
        unmatched_batters = 0
        for mlbam, sp in batting_by_mlbam.items():
            pid = mlbam_to_pid.get(mlbam)
            if not pid:
                unmatched_batters += 1
                continue
            row = split_to_batter_row(sp, pid)
            if row:
                batter_rows.append(row)
        log.info(f'  Batters: matched {len(batter_rows)}, unmatched {unmatched_batters}')

        # ── Write ───────────────────────────────────────────────────────
        n_p = write_pitcher_rows(conn, pitcher_rows)
        n_b = write_batter_rows(conn, batter_rows)

    finally:
        conn.close()

    elapsed = (datetime.now() - start).total_seconds()
    log.info('━' * 60)
    log.info(f'Done in {elapsed:.1f}s')
    log.info(f'  Pitcher rows written: {n_p}')
    log.info(f'  Batter rows written:  {n_b}')
    log.info('━' * 60)


if __name__ == '__main__':
    main()
