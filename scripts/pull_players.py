"""
scripts/pull_players.py
───────────────────────
Nightly active-MLB-player roster seed for JOYT.

WHY THIS EXISTS:
  Our `players` table was originally seeded from a static CSV from draft
  prep. Players who debut in MLB AFTER that seed (e.g., Parker Messick,
  August 2025 callup) never get added unless Yahoo's roster sync picks
  them up — and even then, the stats pipeline can't match them because
  their MLBAM/FG IDs aren't in `player_ids` (Chadwick Register lags
  behind for recent debuts).

WHAT THIS DOES:
  1. Pulls the complete active MLB player roster from MLB Stats API
     (one cheap, stable API call — no scraping)
  2. For each player:
     a. Match by MLBAM ID (via player_ids or player_status), OR by
        normalized name fallback.
     b. If no match → INSERT a fresh row into `players`. Don't disturb
        existing rows.
     c. UPSERT player_ids with the MLBAM ID (this is the key fix —
        Savant matching works off MLBAM IDs, so once player_ids is
        populated, the stats pipeline can find them).
     d. UPSERT player_status with current team, position, MLBAM ID.
  3. The existing pull_stats.py Chadwick step still runs and fills in
     fangraphs_id / bbref_id afterward (best-effort).

⚠️ COMMERCIAL LICENSING:
  MLB Stats API is non-commercial-only per their TOS. This script is
  fine for personal-use phase but MUST be replaced before charging users
  (Phase 3). See 02_COMPLIANCE_FRAMEWORK.md for the licensed-provider
  migration plan (recommended: SportsDataIO at $500-1500/mo).

ENV vars required:
  DATABASE_URL  — Postgres connection string (Neon production)

Usage (local dev or GitHub Actions):
  python scripts/pull_players.py
"""
import os
import sys
import logging
import re
import unicodedata
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

# Map MLB Stats API position abbreviation → fantasy posDisplay.
# Falls back to the API's abbreviation if not in the map (rare, e.g.
# 'TWP' for two-way players gets passed through).
FANTASY_POS_MAP = {
    'P':  'P',   'SP': 'SP',  'RP': 'RP',
    'C':  'C',
    '1B': '1B',  '2B': '2B',  '3B': '3B', 'SS': 'SS',
    'LF': 'OF',  'CF': 'OF',  'RF': 'OF',  'OF': 'OF',
    'DH': 'DH',  'IF': 'IF',
}


# ── Helpers ──────────────────────────────────────────────────────────────
def get_db():
    return psycopg2.connect(DATABASE_URL)


def normalize_name(name: str) -> str:
    """Normalize a name for matching. Mirrors the logic in pull_stats.py."""
    if not name:
        return ''
    n = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    n = re.sub(r'\s+(jr|sr|iii|ii|iv)\.?$', '', n.lower().strip())
    n = re.sub(r'[^a-z0-9]', '', n)
    return n


def fantasy_pos(api_pos: str) -> str:
    if not api_pos:
        return 'UTIL'
    return FANTASY_POS_MAP.get(api_pos.upper(), api_pos.upper())


# ── Step 1: Pull active MLB player roster from MLB Stats API ─────────────
def fetch_active_mlb_players() -> list[dict]:
    """
    Returns a list of player dicts. Each dict has:
      - mlbam_id (int)
      - full_name (str)
      - active (bool)
      - team_abbr (str, may be empty for FA/minors)
      - position_abbr (str, primary fielding position)
    """
    url = f'{MLB_API_BASE}/sports/1/players'
    params = {'season': CURRENT_SEASON, 'gameType': 'R'}

    log.info(f'Fetching MLB players for {CURRENT_SEASON}...')
    res = requests.get(url, params=params, timeout=60)
    res.raise_for_status()
    payload = res.json()

    raw = payload.get('people', [])
    log.info(f'  Got {len(raw)} player records')

    out = []
    for p in raw:
        mlbam = p.get('id')
        if not mlbam:
            continue
        full_name = p.get('fullName') or ''
        if not full_name:
            continue
        active = bool(p.get('active', False))
        team_abbr = ((p.get('currentTeam') or {}).get('abbreviation')) or ''
        pos_abbr  = ((p.get('primaryPosition') or {}).get('abbreviation')) or ''
        out.append({
            'mlbam_id':     int(mlbam),
            'full_name':    full_name,
            'active':       active,
            'team_abbr':    team_abbr.upper(),
            'position_abbr': pos_abbr.upper(),
        })
    log.info(f'  Filtered to {len(out)} valid players')
    return out


# ── Step 2: Build matching maps from existing DB state ───────────────────
def build_existing_maps(conn) -> tuple[dict, dict]:
    """
    Returns (mlbam_to_pid, name_to_pid):
      mlbam_to_pid: dict[int, int]   — existing MLBAM ID → players.id
      name_to_pid:  dict[str, int]   — normalized name   → players.id
    """
    mlbam_to_pid: dict[int, int] = {}
    name_to_pid:  dict[str, int] = {}

    with conn.cursor() as cur:
        # MLBAM IDs from player_ids (canonical) and player_status (backup)
        cur.execute('SELECT player_id, mlbam_id FROM player_ids WHERE mlbam_id IS NOT NULL')
        for pid, mlbam in cur.fetchall():
            mlbam_to_pid[int(mlbam)] = int(pid)

        cur.execute('SELECT player_id, mlbam_id FROM player_status WHERE mlbam_id IS NOT NULL')
        for pid, mlbam in cur.fetchall():
            mlbam_to_pid.setdefault(int(mlbam), int(pid))

        # Normalized name → player_id (for fallback when no MLBAM match)
        cur.execute('SELECT id, name FROM players')
        for pid, name in cur.fetchall():
            n = normalize_name(name)
            if n:
                # First-write wins. Duplicate names: stick with whoever
                # we matched first; the MLBAM path catches the right one
                # if it differs.
                name_to_pid.setdefault(n, int(pid))

    log.info(f'  Existing: {len(mlbam_to_pid)} MLBAM-mapped, {len(name_to_pid)} name-mapped')
    return mlbam_to_pid, name_to_pid


# ── Step 3: Insert missing players + upsert player_ids/player_status ─────
def reconcile_players(conn, api_players: list[dict]) -> dict:
    """
    For each player from MLB Stats API:
      - Look up existing player_id via MLBAM, then via normalized name
      - If neither matches → INSERT new row into `players`
      - UPSERT player_ids and player_status with MLBAM ID + current team/pos

    Returns counts: {inserted, name_matched, mlbam_matched}.
    """
    mlbam_to_pid, name_to_pid = build_existing_maps(conn)

    inserted = 0
    mlbam_matched = 0
    name_matched = 0

    # Buffers for batched writes
    new_player_rows: list[tuple] = []  # for `players` insert
    pending_for_post_insert: list[dict] = []  # need pid after insert

    # ── Pass 1: classify each API player ────────────────────────────────
    for ap in api_players:
        mlbam = ap['mlbam_id']
        name  = ap['full_name']
        norm  = normalize_name(name)

        existing_pid = mlbam_to_pid.get(mlbam)
        if existing_pid:
            mlbam_matched += 1
            ap['_pid'] = existing_pid
            continue

        existing_pid = name_to_pid.get(norm) if norm else None
        if existing_pid:
            name_matched += 1
            ap['_pid'] = existing_pid
            # Cache the MLBAM mapping so duplicate API rows in this run
            # don't re-trigger insertion logic.
            mlbam_to_pid[mlbam] = existing_pid
            continue

        # No match — needs INSERT
        ap['_pid'] = None
        pending_for_post_insert.append(ap)
        new_player_rows.append((
            name,
            ap['team_abbr'] or '',
            fantasy_pos(ap['position_abbr']),
            fantasy_pos(ap['position_abbr']),
            'available',
        ))

    # ── Pass 2: bulk insert new players, capture their generated IDs ────
    if new_player_rows:
        log.info(f'  Inserting {len(new_player_rows)} new players...')
        with conn.cursor() as cur:
            for ap, row in zip(pending_for_post_insert, new_player_rows):
                cur.execute("""
                    INSERT INTO players
                        (name, team, positions, pos_display, status, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                """, row)
                new_pid = cur.fetchone()[0]
                ap['_pid'] = new_pid
                mlbam_to_pid[ap['mlbam_id']] = new_pid
                inserted += 1
        conn.commit()

    # ── Pass 3: batch upsert player_ids ─────────────────────────────────
    pid_rows = [
        (
            ap['_pid'],
            ap['mlbam_id'],
            normalize_name(ap['full_name']),
        )
        for ap in api_players
        if ap.get('_pid') is not None
    ]
    if pid_rows:
        log.info(f'  Upserting {len(pid_rows)} player_ids rows...')
        with conn.cursor() as cur:
            execute_batch(cur, """
                INSERT INTO player_ids (player_id, mlbam_id, name_normalized, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (player_id) DO UPDATE SET
                    mlbam_id        = EXCLUDED.mlbam_id,
                    name_normalized = COALESCE(player_ids.name_normalized, EXCLUDED.name_normalized),
                    updated_at      = NOW()
            """, pid_rows)
        conn.commit()

    # ── Pass 4: batch upsert player_status ──────────────────────────────
    status_rows = [
        (
            ap['_pid'],
            ap['mlbam_id'],
            ap['active'],
            ap['team_abbr'] or None,
            ap['position_abbr'] or None,
        )
        for ap in api_players
        if ap.get('_pid') is not None
    ]
    if status_rows:
        log.info(f'  Upserting {len(status_rows)} player_status rows...')
        with conn.cursor() as cur:
            execute_batch(cur, """
                INSERT INTO player_status
                    (player_id, mlbam_id, is_active, current_team, current_position,
                     data_source, fetched_at)
                VALUES (%s, %s, %s, %s, %s, 'mlb-stats-api', NOW())
                ON CONFLICT (player_id) DO UPDATE SET
                    mlbam_id         = EXCLUDED.mlbam_id,
                    is_active        = EXCLUDED.is_active,
                    current_team     = EXCLUDED.current_team,
                    current_position = EXCLUDED.current_position,
                    fetched_at       = NOW()
            """, status_rows)
        conn.commit()

    return {
        'inserted':      inserted,
        'mlbam_matched': mlbam_matched,
        'name_matched':  name_matched,
        'total_api':     len(api_players),
    }


# ── Main ─────────────────────────────────────────────────────────────────
def main():
    log.info(f'Starting MLB player roster pull for season {CURRENT_SEASON}')
    start = datetime.now()

    try:
        api_players = fetch_active_mlb_players()
    except Exception as e:
        log.error(f'MLB Stats API fetch failed: {e}')
        sys.exit(1)

    if not api_players:
        log.error('No players returned from MLB Stats API — aborting (won\'t mutate DB)')
        sys.exit(1)

    conn = get_db()
    try:
        counts = reconcile_players(conn, api_players)
    finally:
        conn.close()

    elapsed = (datetime.now() - start).total_seconds()
    log.info('━' * 60)
    log.info(f'Done in {elapsed:.1f}s')
    log.info(f'  Total from API:     {counts["total_api"]}')
    log.info(f'  Matched by MLBAM:   {counts["mlbam_matched"]}')
    log.info(f'  Matched by name:    {counts["name_matched"]}')
    log.info(f'  Newly inserted:     {counts["inserted"]}')
    log.info('━' * 60)


if __name__ == '__main__':
    main()
