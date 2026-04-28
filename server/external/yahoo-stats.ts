// server/external/yahoo-stats.ts
// ─────────────────────────────────────────────────────────────────────
// Yahoo Fantasy stats orchestrator (v1.5).
//
// PURPOSE:
//   Pull authoritative season stats from Yahoo for every player in the
//   user's league universe — rostered + available + waivers. Yahoo's
//   numbers match the user's league page exactly, which makes Coach
//   pixel-perfect on the categories the user actually scores (AVG, HR,
//   SB, RBI, R, QS, SAVE, ERA, WHIP, K).
//
// ARCHITECTURE:
//   - Uses existing yahoo.ts for OAuth, token refresh, chunked
//     getPlayerStats. NO duplicated auth logic.
//   - This module owns: pagination through all league players,
//     stat-id-to-schema-column mapping, DB writes via Drizzle.
//   - Intended to be called from scripts/pull_yahoo_stats.ts (nightly
//     workflow) or from a future in-app refresh route.
//
// DATA SCOPE:
//   "All players in the league universe" = Yahoo's full player set for
//   this league, which includes:
//     - Currently rostered players (status=T)
//     - Available free agents and waivers (status=A)
//   We paginate through both and merge by player_key.
//
// COMMERCIAL NOTE:
//   Yahoo's API requires commercial license approval before charging
//   users publicly. The Yahoo stats pipeline is still the right
//   architecture — just file the application before launching paid
//   tiers. See 02_COMPLIANCE_FRAMEWORK.md.
// ─────────────────────────────────────────────────────────────────────
import { db } from '../db';
import {
  players, batterStats, pitcherStats, yahooLeague,
} from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import {
  yahooFetch, getPlayerStats, getParsedLeagueSettings,
  type ParsedLeagueSettings,
} from '../yahoo';

const CURRENT_SEASON = new Date().getFullYear();
const DATA_SOURCE    = 'yahoo';

const PLAYERS_PER_PAGE = 25;
const MAX_PLAYER_PAGES = 100;        // safety cap (~2,500 players)
const RETRY_MAX        = 3;
const RETRY_BASE_MS    = 1000;

// ── Stat-display-name → schema-field mapping ─────────────────────────────
//
// We don't hardcode Yahoo stat_id values directly. Instead we use the
// league_settings cached payload to get the user's actual
// stat_id ↔ display_name mapping, then map display_name → schema field
// via stable conventions Yahoo uses across all MLB leagues.
//
// This auto-adapts to any league configuration (OPS leagues, K-BB%
// leagues, etc.) as long as Yahoo's display_name conventions hold.
//
// IMPORTANT: keys are camelCase to match Drizzle schema fields.

const PITCHER_DISPLAY_TO_FIELD: Record<string, string> = {
  // counting
  'W':    'wins',
  'L':    'losses',
  'SV':   'saves',
  'HLD':  'holds',
  'QS':   'qualityStarts',
  'IP':   'inningsPitched',
  'K':    'strikeoutsPitched',
  'SO':   'strikeoutsPitched',
  'BB':   'walksAllowed',
  'H':    'hitsAllowed',
  'ER':   'earnedRuns',
  'HR':   'homerunsAllowed',
  'G':    'games',
  'GS':   'gamesStarted',
  // rate
  'ERA':  'era',
  'WHIP': 'whip',
  'K/9':  'kPer9',
  'BB/9': 'bbPer9',
};

const BATTER_DISPLAY_TO_FIELD: Record<string, string> = {
  // rate
  'AVG':  'avg',
  'OBP':  'obp',
  'SLG':  'slg',
  'OPS':  'ops',
  // counting
  'AB':   'atBats',
  'PA':   'plateApps',
  'R':    'runs',
  'H':    'hits',
  '2B':   'doubles',
  '3B':   'triples',
  'HR':   'homeRuns',
  'RBI':  'rbi',
  'SB':   'stolenBases',
  'CS':   'caughtStealing',
  'BB':   'walks',
  'K':    'strikeouts',
  'SO':   'strikeouts',
  'G':    'games',
};

// ── Position classifier ──────────────────────────────────────────────────
const PITCHER_POSITIONS = new Set(['P', 'SP', 'RP']);

function isPitcherPosition(displayPosition: string | null | undefined): boolean {
  if (!displayPosition) return false;
  // Yahoo can return comma-separated multi-position strings like
  // "1B,3B" or single positions like "SP". Treat as pitcher if ANY
  // position is a pitcher position.
  const positions = displayPosition.split(',').map(p => p.trim());
  return positions.some(p => PITCHER_POSITIONS.has(p));
}

// ── Page-through-all-players ─────────────────────────────────────────────
export interface YahooLeaguePlayer {
  playerKey:       string;
  playerId:        string;
  name:            string;
  editorialTeam:   string;
  displayPosition: string;
  isPitcher:       boolean;
}

async function fetchPlayersPage(
  leagueKey: string,
  status:    'T' | 'A',
  start:     number,
): Promise<YahooLeaguePlayer[]> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const path =
        `/league/${leagueKey}/players;status=${status};start=${start};count=${PLAYERS_PER_PAGE}`;
      const data = await yahooFetch(path);
      const playersData = data.fantasy_content?.league?.[1]?.players;
      const out: YahooLeaguePlayer[] = [];

      if (!playersData || playersData.count === 0) return out;

      for (let i = 0; i < (playersData.count ?? 0); i++) {
        const p    = playersData[i]?.player;
        if (!p) continue;
        const info = p[0];

        const playerKey       = info?.[0]?.player_key as string | undefined;
        const playerId        = info?.[1]?.player_id  as string | undefined;
        const name            = info?.[2]?.name?.full as string | undefined;
        const editorialTeam   = info?.[6]?.editorial_team_abbr as string | undefined;
        const displayPosition = info?.[4]?.display_position    as string | undefined;

        if (!playerKey || !name) continue;

        out.push({
          playerKey,
          playerId:        playerId ?? '',
          name,
          editorialTeam:   editorialTeam ?? '',
          displayPosition: displayPosition ?? '',
          isPitcher:       isPitcherPosition(displayPosition),
        });
      }
      return out;
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error(`fetchPlayersPage failed after ${RETRY_MAX} attempts: ${lastErr}`);
}

/**
 * Fetch every player Yahoo considers part of this league's universe.
 *
 * Two pagination loops, one per status (T = taken, A = available).
 * Merged and de-duplicated by player_key.
 */
export async function fetchAllLeaguePlayers(leagueKey: string): Promise<YahooLeaguePlayer[]> {
  const seen = new Map<string, YahooLeaguePlayer>();

  for (const status of ['T', 'A'] as const) {
    let start = 0;
    let pages = 0;
    while (pages < MAX_PLAYER_PAGES) {
      const page = await fetchPlayersPage(leagueKey, status, start);
      if (page.length === 0) break;
      for (const p of page) {
        if (!seen.has(p.playerKey)) seen.set(p.playerKey, p);
      }
      if (page.length < PLAYERS_PER_PAGE) break;
      start += PLAYERS_PER_PAGE;
      pages++;
    }
  }

  return Array.from(seen.values());
}

// ── Map Yahoo player → our DB player_id ──────────────────────────────────
function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '')
          .replace(/[^a-z0-9]/g, '');
}

interface PlayerLookup {
  byName:     Map<string, number>;
  byNameTeam: Map<string, number>;
}

async function buildPlayerLookup(): Promise<PlayerLookup> {
  const rows = await db.select({
    id:   players.id,
    name: players.name,
    team: players.team,
  }).from(players);

  const byName = new Map<string, number>();
  const byNameTeam = new Map<string, number>();
  for (const r of rows) {
    if (!r.name) continue;
    const n = normalizeName(r.name);
    if (!byName.has(n)) byName.set(n, r.id);
    if (r.team) byNameTeam.set(`${n}|${r.team.toLowerCase()}`, r.id);
  }
  return { byName, byNameTeam };
}

function resolvePlayerId(
  yp:     YahooLeaguePlayer,
  lookup: PlayerLookup,
): number | null {
  const n = normalizeName(yp.name);
  if (yp.editorialTeam) {
    const fromTeam = lookup.byNameTeam.get(`${n}|${yp.editorialTeam.toLowerCase()}`);
    if (fromTeam) return fromTeam;
  }
  return lookup.byName.get(n) ?? null;
}

// ── Stat parser ──────────────────────────────────────────────────────────
function parseStatsForPlayer(
  yahooStats:      Record<string, string>,
  statIdToDisplay: Map<string, string>,
  isPitcher:       boolean,
): Record<string, number | null> {
  const fieldMap = isPitcher ? PITCHER_DISPLAY_TO_FIELD : BATTER_DISPLAY_TO_FIELD;
  const out: Record<string, number | null> = {};

  for (const [statId, rawValue] of Object.entries(yahooStats)) {
    const displayName = statIdToDisplay.get(statId);
    if (!displayName) continue;

    const field = fieldMap[displayName];
    if (!field) continue;

    if (rawValue === '-' || rawValue === '' || rawValue == null) {
      out[field] = null;
      continue;
    }

    const num = Number(rawValue);
    out[field] = Number.isFinite(num) ? num : null;
  }

  return out;
}

function buildStatIdMap(settings: ParsedLeagueSettings): Map<string, string> {
  const m = new Map<string, string>();
  for (const cat of settings.categories) {
    if (cat.statId && cat.displayName) {
      m.set(String(cat.statId), cat.displayName);
    }
  }
  return m;
}

// ── DB write (Drizzle native) ────────────────────────────────────────────
interface ParsedRow {
  playerId: number;
  fields:   Record<string, number | null>;
}

async function writePitcherRows(rows: ParsedRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  await db.execute(sql`
    DELETE FROM pitcher_stats
    WHERE season = ${CURRENT_SEASON} AND data_source = ${DATA_SOURCE}
  `);

  const values = rows
    .filter(r => Object.keys(r.fields).length > 0)
    .map(r => ({
      playerId:   r.playerId,
      season:     CURRENT_SEASON,
      dataSource: DATA_SOURCE,
      fetchedAt:  new Date(),
      ...r.fields,
    } as any));

  if (values.length === 0) return 0;

  // Drizzle batched insert
  const CHUNK = 100;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await db.insert(pitcherStats).values(chunk);
  }

  return values.length;
}

async function writeBatterRows(rows: ParsedRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  await db.execute(sql`
    DELETE FROM batter_stats
    WHERE season = ${CURRENT_SEASON} AND data_source = ${DATA_SOURCE}
  `);

  const values = rows
    .filter(r => Object.keys(r.fields).length > 0)
    .map(r => ({
      playerId:   r.playerId,
      season:     CURRENT_SEASON,
      dataSource: DATA_SOURCE,
      fetchedAt:  new Date(),
      ...r.fields,
    } as any));

  if (values.length === 0) return 0;

  const CHUNK = 100;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    await db.insert(batterStats).values(chunk);
  }

  return values.length;
}

// ── Main orchestrator ────────────────────────────────────────────────────
export interface YahooStatsResult {
  totalPlayers:        number;
  matchedPlayers:      number;
  unmatchedPlayers:    number;
  pitchersWritten:     number;
  battersWritten:      number;
  qualityStartsTotal:  number;
  elapsedMs:           number;
  errorMessage?:       string;
}

/**
 * Top-level: fetch every league player, get their stats from Yahoo,
 * parse, write to pitcher_stats / batter_stats with data_source='yahoo'.
 *
 * Idempotent — DELETE-and-INSERT pattern means re-runs overwrite cleanly.
 */
export async function pullAllYahooStats(leagueKey: string): Promise<YahooStatsResult> {
  const start = Date.now();

  // 1. League settings → stat_id → display_name map
  const settings  = await getParsedLeagueSettings(leagueKey);
  const statIdMap = buildStatIdMap(settings);

  // 2. Fetch every player Yahoo lists for this league
  const allYahooPlayers = await fetchAllLeaguePlayers(leagueKey);

  // 3. Build name+team → pid lookup
  const lookup = await buildPlayerLookup();

  // 4. Resolve each Yahoo player → DB player_id
  const matched: { yahoo: YahooLeaguePlayer; pid: number }[] = [];
  let unmatched = 0;
  for (const yp of allYahooPlayers) {
    const pid = resolvePlayerId(yp, lookup);
    if (pid) matched.push({ yahoo: yp, pid });
    else     unmatched++;
  }

  // 5. Bulk-fetch stats (chunked at 25 inside getPlayerStats)
  const playerKeys = matched.map(m => m.yahoo.playerKey);
  const allStats   = await getPlayerStats(playerKeys, leagueKey);
  const statsByKey = new Map(allStats.map(s => [s.playerKey, s.stats]));

  // 6. Parse + split by pitcher/batter
  const pitcherRows: ParsedRow[] = [];
  const batterRows:  ParsedRow[] = [];

  for (const m of matched) {
    const stats = statsByKey.get(m.yahoo.playerKey);
    if (!stats || Object.keys(stats).length === 0) continue;

    const fields = parseStatsForPlayer(stats, statIdMap, m.yahoo.isPitcher);
    if (Object.keys(fields).length === 0) continue;

    const row: ParsedRow = { playerId: m.pid, fields };
    if (m.yahoo.isPitcher) pitcherRows.push(row);
    else                   batterRows.push(row);
  }

  // 7. QS sanity total
  let qsTotal = 0;
  for (const r of pitcherRows) {
    const qs = r.fields['qualityStarts'];
    if (typeof qs === 'number') qsTotal += qs;
  }

  // 8. Write
  const pitchersWritten = await writePitcherRows(pitcherRows);
  const battersWritten  = await writeBatterRows(batterRows);

  return {
    totalPlayers:       allYahooPlayers.length,
    matchedPlayers:     matched.length,
    unmatchedPlayers:   unmatched,
    pitchersWritten,
    battersWritten,
    qualityStartsTotal: qsTotal,
    elapsedMs:          Date.now() - start,
  };
}

/**
 * Helper: load league_key from yahoo_league row and run.
 * Returns a result with `errorMessage` set if no league connected —
 * caller should treat that as a soft failure.
 */
export async function pullAllYahooStatsForCurrentLeague(): Promise<YahooStatsResult> {
  const [league] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
  if (!league) {
    return {
      totalPlayers:       0,
      matchedPlayers:     0,
      unmatchedPlayers:   0,
      pitchersWritten:    0,
      battersWritten:     0,
      qualityStartsTotal: 0,
      elapsedMs:          0,
      errorMessage:       'No Yahoo league connected — run /yahoo flow first',
    };
  }
  return pullAllYahooStats(league.leagueKey);
}
