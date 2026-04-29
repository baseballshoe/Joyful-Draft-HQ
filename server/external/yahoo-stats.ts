// server/external/yahoo-stats.ts
// ─────────────────────────────────────────────────────────────────────
// Yahoo Fantasy stats orchestrator.
//
// v1.5:    initial implementation — used fixed array indexing
// v1.5.1:  fix position routing + stats parsing using findAttr walker
//
// THE BUG WE FIXED:
//   The Yahoo /league/{key}/players;status=X endpoint returns each
//   player as an array of single-key objects. The position of any
//   given key in that array varies per-endpoint. v1.5 used fixed
//   indices (info[4] for display_position, info[6] for editorial_team)
//   which worked for the roster endpoint but NOT for the league
//   players endpoint — every pitcher was mis-classified as a batter
//   and ~70% of stats columns came back NULL.
//
// THE FIX:
//   Use a findAttr() walker that iterates the array looking for the
//   matching key — same pattern server/yahoo.ts uses for its other
//   endpoints. This is robust to Yahoo reshuffling field order.
//
//   Also: switched position detection from parsing display_position
//   strings to reading the canonical position_type field ("P" or "B").
//   Yahoo's own definitive classifier — no string parsing needed.
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
const MAX_PLAYER_PAGES = 100;
const RETRY_MAX        = 3;
const RETRY_BASE_MS    = 1000;

// ── Yahoo array helper (mirrors yahoo.ts findAttr) ───────────────────────
//
// Yahoo returns objects-with-numeric-keys as if they were arrays. To find
// a value by key, walk the array looking for an item that contains it.
// This is the canonical pattern in yahoo.ts; we duplicate here to avoid
// adding an export to the existing file.
function findAttr(obj: any, key: string): any {
  if (!Array.isArray(obj)) return obj?.[key];
  for (const item of obj) {
    if (item && typeof item === 'object' && key in item) return item[key];
  }
  return undefined;
}

// ── Stat-display-name → schema-field mapping ─────────────────────────────
const PITCHER_DISPLAY_TO_FIELD: Record<string, string> = {
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
  'ERA':  'era',
  'WHIP': 'whip',
  'K/9':  'kPer9',
  'BB/9': 'bbPer9',
};

const BATTER_DISPLAY_TO_FIELD: Record<string, string> = {
  'AVG':  'avg',
  'OBP':  'obp',
  'SLG':  'slg',
  'OPS':  'ops',
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

// ── Page-through-all-players (v1.5.1: findAttr-based parsing) ────────────
export interface YahooLeaguePlayer {
  playerKey:       string;
  playerId:        string;
  name:            string;
  editorialTeam:   string;
  displayPosition: string;
  positionType:    string;       // 'P' | 'B' (Yahoo canonical)
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

        // ── v1.5.1: use findAttr walker, not fixed indices ──
        const playerKey       = findAttr(info, 'player_key')          as string | undefined;
        const playerId        = findAttr(info, 'player_id')           as string | undefined;
        const nameObj         = findAttr(info, 'name');
        const name            = nameObj?.full as string | undefined;
        const editorialTeam   = findAttr(info, 'editorial_team_abbr') as string | undefined;
        const displayPosition = findAttr(info, 'display_position')    as string | undefined;
        const positionType    = findAttr(info, 'position_type')       as string | undefined;

        if (!playerKey || !name) continue;

        // Use Yahoo's canonical position_type ("P" / "B") for routing
        // rather than parsing display_position strings.
        const isPitcher = positionType === 'P';

        out.push({
          playerKey,
          playerId:        playerId ?? '',
          name,
          editorialTeam:   editorialTeam ?? '',
          displayPosition: displayPosition ?? '',
          positionType:    positionType ?? '',
          isPitcher,
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
 * Fetch every player Yahoo lists for this league (rostered + available).
 * De-duplicated by player_key.
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
  // v1.5.1: routing diagnostics
  classifiedAsPitcher: number;
  classifiedAsBatter:  number;
  classifiedUnknown:   number;
  elapsedMs:           number;
  errorMessage?:       string;
}

export async function pullAllYahooStats(leagueKey: string): Promise<YahooStatsResult> {
  const start = Date.now();

  const settings  = await getParsedLeagueSettings(leagueKey);
  const statIdMap = buildStatIdMap(settings);

  const allYahooPlayers = await fetchAllLeaguePlayers(leagueKey);

  // v1.5.1: classification diagnostics — we want to see if position_type
  // is reliably populated for everyone.
  let classifiedAsPitcher = 0;
  let classifiedAsBatter  = 0;
  let classifiedUnknown   = 0;
  for (const yp of allYahooPlayers) {
    if (yp.positionType === 'P')      classifiedAsPitcher++;
    else if (yp.positionType === 'B') classifiedAsBatter++;
    else                               classifiedUnknown++;
  }

  const lookup = await buildPlayerLookup();

  const matched: { yahoo: YahooLeaguePlayer; pid: number }[] = [];
  let unmatched = 0;
  for (const yp of allYahooPlayers) {
    const pid = resolvePlayerId(yp, lookup);
    if (pid) matched.push({ yahoo: yp, pid });
    else     unmatched++;
  }

  const playerKeys = matched.map(m => m.yahoo.playerKey);
  const allStats   = await getPlayerStats(playerKeys, leagueKey);
  const statsByKey = new Map(allStats.map(s => [s.playerKey, s.stats]));

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

  let qsTotal = 0;
  for (const r of pitcherRows) {
    const qs = r.fields['qualityStarts'];
    if (typeof qs === 'number') qsTotal += qs;
  }

  const pitchersWritten = await writePitcherRows(pitcherRows);
  const battersWritten  = await writeBatterRows(batterRows);

  return {
    totalPlayers:        allYahooPlayers.length,
    matchedPlayers:      matched.length,
    unmatchedPlayers:    unmatched,
    pitchersWritten,
    battersWritten,
    qualityStartsTotal:  qsTotal,
    classifiedAsPitcher,
    classifiedAsBatter,
    classifiedUnknown,
    elapsedMs:           Date.now() - start,
  };
}

export async function pullAllYahooStatsForCurrentLeague(): Promise<YahooStatsResult> {
  const [league] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
  if (!league) {
    return {
      totalPlayers:        0,
      matchedPlayers:      0,
      unmatchedPlayers:    0,
      pitchersWritten:     0,
      battersWritten:      0,
      qualityStartsTotal:  0,
      classifiedAsPitcher: 0,
      classifiedAsBatter:  0,
      classifiedUnknown:   0,
      elapsedMs:           0,
      errorMessage:        'No Yahoo league connected — run /yahoo flow first',
    };
  }
  return pullAllYahooStats(league.leagueKey);
}
