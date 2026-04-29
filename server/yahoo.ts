// server/yahoo.ts
// ─────────────────────────────────────────────────────────────────────
// Yahoo Fantasy Sports API client.
//
// PHASE 2 ADDITIONS (this file is a full replacement):
//   - getAllTeamRosters()           — all 12 teams' rosters in one shot
//   - getParsedStandings()          — clean standings shape (not raw Yahoo)
//   - getParsedScoreboard()         — clean current-matchup shape
//   - getParsedLeagueSettings()     — categories + roster positions, parsed
//   - getRecentTransactions()       — recent adds/drops/trades
//
// The original endpoints (getMyRoster, getWaiverWire, getStandings,
// getScoreboard) are preserved for backward compatibility.
//
// Yahoo's JSON-from-XML format is famously cursed. The "parsed" helpers
// pull out only what we actually need and return a clean TypeScript
// shape that's easy for Coach to read and pages to render.
// ─────────────────────────────────────────────────────────────────────
import { db } from './db';
import { yahooTokens } from '@shared/schema';
import { eq } from 'drizzle-orm';

const CLIENT_ID     = process.env.YAHOO_CLIENT_ID!;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET!;
const APP_BASE_URL  = process.env.APP_BASE_URL ?? 'http://localhost:5000';
const REDIRECT_URI  = `${APP_BASE_URL}/api/auth/yahoo/callback`;

const YAHOO_AUTH_URL  = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API_BASE  = 'https://fantasysports.yahooapis.com/fantasy/v2';

// ── Token storage ─────────────────────────────────────────────────────────

export async function saveTokens(tokens: {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    Date;
  yahooGuid?:   string;
}) {
  await db
    .insert(yahooTokens)
    .values({ id: 1, ...tokens })
    .onConflictDoUpdate({
      target: yahooTokens.id,
      set: {
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt:    tokens.expiresAt,
        yahooGuid:    tokens.yahooGuid,
        updatedAt:    new Date(),
      },
    });
}

export async function getTokens() {
  const [row] = await db.select().from(yahooTokens).where(eq(yahooTokens.id, 1));
  return row ?? null;
}

export async function clearTokens() {
  await db.delete(yahooTokens).where(eq(yahooTokens.id, 1));
}

// ── OAuth flow ────────────────────────────────────────────────────────────

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'fspt-r',
  });
  return `${YAHOO_AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo token exchange failed: ${text}`);
  }

  const data = await res.json() as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
    xoauth_yahoo_guid?: string;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await saveTokens({
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    yahooGuid:    data.xoauth_yahoo_guid,
  });
  return data;
}

async function refreshAccessToken(refreshToken: string) {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      redirect_uri:  REDIRECT_URI,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo token refresh failed: ${text}`);
  }

  const data = await res.json() as {
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await saveTokens({
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt,
  });
  return data.access_token;
}

// ── Authenticated fetcher ─────────────────────────────────────────────────

export async function yahooFetch(path: string): Promise<any> {
  const tokens = await getTokens();
  if (!tokens) throw new Error('Not connected to Yahoo — please authenticate first');

  let accessToken = tokens.accessToken;
  if (new Date(tokens.expiresAt).getTime() < Date.now() + 60_000) {
    accessToken = await refreshAccessToken(tokens.refreshToken);
  }

  const url = `${YAHOO_API_BASE}${path}?format=json`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Yahoo array helper ────────────────────────────────────────────────────
//
// Yahoo returns objects-with-numeric-keys as if they were arrays, but with
// a `count` property and sometimes mixed in extra metadata. This helper
// iterates over the numeric-keyed entries and yields them.
//
function* yahooEach(obj: any): Generator<any, void, unknown> {
  if (!obj) return;
  const count = obj.count ?? 0;
  for (let i = 0; i < count; i++) yield obj[i];
}

/**
 * Yahoo player[0] is an array of single-key objects. To find the value for
 * a given key, we iterate through and find the matching one.
 */
function findAttr(obj: any, key: string): any {
  if (!Array.isArray(obj)) return obj?.[key];
  for (const item of obj) {
    if (item && typeof item === 'object' && key in item) return item[key];
  }
  return undefined;
}

// ── League discovery & connection ─────────────────────────────────────────

export async function getLeagues(): Promise<YahooLeague[]> {
  const gamesData = await yahooFetch('/users;use_login=1/games;game_codes=mlb/leagues');

  try {
    const user  = gamesData.fantasy_content?.users?.[0]?.user;
    const games = user?.[1]?.games;
    const leagues: YahooLeague[] = [];

    for (let g = 0; g < (games?.count ?? 0); g++) {
      const game = games?.[g]?.game;
      if (!game) continue;
      const gameName: string = game[0]?.name ?? '';
      const gameKey:  string = game[0]?.game_key ?? '';
      const leaguesObj = game[1]?.leagues;

      for (let l = 0; l < (leaguesObj?.count ?? 0); l++) {
        const league = leaguesObj?.[l]?.league?.[0];
        if (!league) continue;
        leagues.push({
          leagueKey:   league.league_key,
          leagueId:    league.league_id,
          name:        league.name,
          season:      league.season,
          numTeams:    league.num_teams,
          scoringType: league.scoring_type,
          gameKey,
          gameName,
        });
      }
    }
    return leagues;
  } catch (e) {
    console.error('Error parsing leagues response:', e);
    return [];
  }
}

export async function getLeagueTeams(leagueKey: string): Promise<YahooTeam[]> {
  const data = await yahooFetch(`/league/${leagueKey}/teams`);
  const teamsData = data.fantasy_content?.league?.[1]?.teams;
  const teams: YahooTeam[] = [];

  for (let i = 0; i < (teamsData?.count ?? 0); i++) {
    const t = teamsData?.[i]?.team?.[0];
    if (!t || !Array.isArray(t)) continue;

    teams.push({
      teamKey:  findAttr(t, 'team_key') ?? '',
      teamId:   String(findAttr(t, 'team_id') ?? ''),
      name:     findAttr(t, 'name') ?? '',
      isOwnedByCurrentLogin: Number(findAttr(t, 'is_owned_by_current_login')) === 1,
      managerName: (() => {
        const managers = findAttr(t, 'managers');
        const m = managers?.[0]?.manager ?? managers?.manager;
        return m?.nickname ?? null;
      })(),
    });
  }
  console.log(`[Yahoo] getLeagueTeams(${leagueKey}): ${teams.length} teams, mine=${teams.find(t=>t.isOwnedByCurrentLogin)?.name ?? 'not found'}`);
  return teams;
}

// ── Roster fetching ───────────────────────────────────────────────────────

export async function getMyRoster(teamKey: string): Promise<YahooRosterPlayer[]> {
  const data = await yahooFetch(`/team/${teamKey}/roster/players`);
  return parseRosterFromTeam(data.fantasy_content?.team);
}

/**
 * Parse a roster from a Yahoo team payload. Used by getMyRoster and
 * getAllTeamRosters since the shape is the same once you reach into team[].
 */
function parseRosterFromTeam(teamPayload: any): YahooRosterPlayer[] {
  const playersData = teamPayload?.[1]?.roster?.['0']?.players;
  const roster: YahooRosterPlayer[] = [];

  for (let i = 0; i < (playersData?.count ?? 0); i++) {
    const p = playersData?.[i]?.player;
    if (!p) continue;
    const info   = p[0];
    const status = p[1];

    roster.push({
      playerKey:         findAttr(info, 'player_key'),
      playerId:          String(findAttr(info, 'player_id') ?? ''),
      name:              findAttr(info, 'name')?.full ?? '',
      editorialTeam:     findAttr(info, 'editorial_team_abbr') ?? '',
      displayPosition:   findAttr(info, 'display_position') ?? '',
      eligiblePositions: (findAttr(info, 'eligible_positions') ?? []).map((e: any) => e.position),
      selectedPosition:  status?.selected_position?.[1]?.position ?? null,
      injuryStatus:      findAttr(info, 'status') ?? null,
    });
  }
  return roster;
}

/**
 * Fetch all teams' rosters in a league. This is the foundation of the
 * Coach's "what does the rest of the league look like" awareness.
 *
 * Strategy: Yahoo allows fetching multiple teams' subresources via
 * /league/{key}/teams/roster/players, which returns ALL teams' rosters
 * in a single round-trip. Falls back to per-team requests on parse fail.
 */
export async function getAllTeamRosters(leagueKey: string): Promise<YahooTeamWithRoster[]> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/teams/roster/players`);
    const teamsData = data.fantasy_content?.league?.[1]?.teams;
    const result: YahooTeamWithRoster[] = [];

    for (let i = 0; i < (teamsData?.count ?? 0); i++) {
      const teamWrap = teamsData?.[i]?.team;
      if (!teamWrap) continue;

      const meta = teamWrap[0];
      const teamKey  = findAttr(meta, 'team_key') ?? '';
      const teamId   = String(findAttr(meta, 'team_id') ?? '');
      const name     = findAttr(meta, 'name') ?? '';
      const isOwnedByCurrentLogin = Number(findAttr(meta, 'is_owned_by_current_login')) === 1;
      const managers = findAttr(meta, 'managers');
      const managerName = managers?.[0]?.manager?.nickname ?? null;

      // The roster lives at teamWrap[1] in the all-teams response shape.
      const roster = parseRosterFromTeam(teamWrap);

      result.push({
        teamKey, teamId, name, isOwnedByCurrentLogin, managerName,
        roster,
      });
    }

    if (result.length > 0) return result;
    throw new Error('No teams parsed from bulk roster response');
  } catch (e) {
    console.warn('[Yahoo] Bulk roster fetch failed, falling back to per-team:', e);
    const teams = await getLeagueTeams(leagueKey);
    const out: YahooTeamWithRoster[] = [];
    for (const t of teams) {
      try {
        const roster = await getMyRoster(t.teamKey);
        out.push({ ...t, roster });
      } catch (err) {
        console.warn(`[Yahoo] Failed roster fetch for ${t.name}:`, err);
        out.push({ ...t, roster: [] });
      }
    }
    return out;
  }
}

// ── Waiver wire ───────────────────────────────────────────────────────────

export async function getWaiverWire(leagueKey: string, position = 'B', count = 25): Promise<YahooRosterPlayer[]> {
  const data = await yahooFetch(
    `/league/${leagueKey}/players;status=FA;position=${position};count=${count}/ownership`
  );
  const playersData = data.fantasy_content?.league?.[1]?.players;
  const players: YahooRosterPlayer[] = [];

  for (let i = 0; i < (playersData?.count ?? 0); i++) {
    const p = playersData?.[i]?.player;
    if (!p) continue;
    const info = p[0];
    players.push({
      playerKey:         findAttr(info, 'player_key'),
      playerId:          String(findAttr(info, 'player_id') ?? ''),
      name:              findAttr(info, 'name')?.full ?? '',
      editorialTeam:     findAttr(info, 'editorial_team_abbr') ?? '',
      displayPosition:   findAttr(info, 'display_position') ?? '',
      eligiblePositions: (findAttr(info, 'eligible_positions') ?? []).map((e: any) => e.position),
      selectedPosition:  null,
      injuryStatus:      findAttr(info, 'status') ?? null,
    });
  }
  return players;
}



// ── Player stats (bulk, chunked at 25/request) ────────────────────────────

/** Get season stats for players by player keys (chunked at 25/request). */
export async function getPlayerStats(
  playerKeys: string[],
  leagueKey:  string,
): Promise<YahooPlayerStats[]> {
  if (playerKeys.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < playerKeys.length; i += 25) {
    chunks.push(playerKeys.slice(i, i + 25));
  }

  const allStats: YahooPlayerStats[] = [];
  for (const chunk of chunks) {
    const keys = chunk.join(',');
    const data = await yahooFetch(
      `/league/${leagueKey}/players;player_keys=${keys}/stats`
    );
    const playersData = data.fantasy_content?.league?.[1]?.players;
    for (let i = 0; i < (playersData?.count ?? 0); i++) {
      const p = playersData?.[i]?.player;
      if (!p) continue;
      const info  = p[0];
      const stats = p[1]?.player_stats?.stats ?? [];
      const statMap: Record<string, string> = {};
      stats.forEach((s: any) => {
        statMap[s.stat.stat_id] = s.stat.value;
      });
      allStats.push({
        playerKey: info?.[0]?.player_key,
        playerId:  info?.[1]?.player_id,
        name:      info?.[2]?.name?.full,
        stats:     statMap,
      });
    }
  }
  return allStats;
}
// ── Settings (parsed) ─────────────────────────────────────────────────────

export async function getLeagueSettings(leagueKey: string) {
  const data = await yahooFetch(`/league/${leagueKey}/settings`);
  return data.fantasy_content?.league ?? null;
}

/**
 * Parsed league settings — pulls out scoring categories and roster
 * positions in a clean shape Coach can reason about.
 */
export async function getParsedLeagueSettings(leagueKey: string): Promise<ParsedLeagueSettings> {
  const data = await yahooFetch(`/league/${leagueKey}/settings`);
  const league = data.fantasy_content?.league;
  const meta     = league?.[0] ?? {};
  const settings = league?.[1]?.settings?.[0] ?? {};

  const statCategories = settings?.stat_categories?.stats ?? [];
  const categories: ScoringCategory[] = [];
  for (const wrapper of statCategories) {
    const stat = wrapper?.stat;
    if (!stat) continue;
    categories.push({
      statId:        String(stat.stat_id),
      name:          stat.name ?? '',
      displayName:   stat.display_name ?? stat.name ?? '',
      sortOrder:     stat.sort_order === '1' ? 'asc' : 'desc',
      positionType:  stat.position_type ?? '',
      isDisplayOnly: String(stat.is_only_display_stat) === '1'
                  || String(stat.is_excluded_from_display) === '1',
    });
  }

  const rosterPositionsRaw = settings?.roster_positions ?? [];
  const rosterPositions: RosterSlot[] = [];
  for (const wrapper of rosterPositionsRaw) {
    const rp = wrapper?.roster_position;
    if (!rp) continue;
    rosterPositions.push({
      position:    rp.position ?? '',
      count:       Number(rp.count ?? 0),
      positionType: rp.position_type ?? '',
    });
  }

  return {
    leagueKey,
    name:        Array.isArray(meta) ? findAttr(meta, 'name') : meta.name,
    season:      Array.isArray(meta) ? findAttr(meta, 'season') : meta.season,
    numTeams:    Number(Array.isArray(meta) ? findAttr(meta, 'num_teams') : meta.num_teams) || null,
    scoringType: settings.scoring_type ?? null,
    weekly:      settings.weekly_deadline ?? null,
    currentWeek: Array.isArray(meta) ? findAttr(meta, 'current_week') : meta.current_week,
    startWeek:   Array.isArray(meta) ? findAttr(meta, 'start_week')   : meta.start_week,
    endWeek:     Array.isArray(meta) ? findAttr(meta, 'end_week')     : meta.end_week,
    categories,
    rosterPositions,
  };
}

// ── Standings (parsed) ────────────────────────────────────────────────────

export async function getStandings(leagueKey: string) {
  const data = await yahooFetch(`/league/${leagueKey}/standings`);
  return data.fantasy_content?.league ?? null;
}

export async function getParsedStandings(leagueKey: string): Promise<ParsedStandings> {
  const data = await yahooFetch(`/league/${leagueKey}/standings`);
  const league   = data.fantasy_content?.league;
  const teamsObj = league?.[1]?.standings?.[0]?.teams;

  const standings: TeamStanding[] = [];
  for (let i = 0; i < (teamsObj?.count ?? 0); i++) {
    const team = teamsObj?.[i]?.team;
    if (!team) continue;
    const meta    = team[0];
    const standing = team[2]?.team_standings;

    standings.push({
      teamKey:     findAttr(meta, 'team_key') ?? '',
      teamId:      String(findAttr(meta, 'team_id') ?? ''),
      name:        findAttr(meta, 'name') ?? '',
      managerName: (() => {
        const managers = findAttr(meta, 'managers');
        return managers?.[0]?.manager?.nickname ?? null;
      })(),
      isOwnedByCurrentLogin: Number(findAttr(meta, 'is_owned_by_current_login')) === 1,
      rank:        Number(standing?.rank ?? 0) || null,
      wins:        Number(standing?.outcome_totals?.wins ?? 0),
      losses:      Number(standing?.outcome_totals?.losses ?? 0),
      ties:        Number(standing?.outcome_totals?.ties ?? 0),
      winPct:      Number(standing?.outcome_totals?.percentage ?? 0) || null,
      gamesBack:   standing?.games_back ?? null,
      pointsFor:   Number(standing?.points_for ?? 0) || null,
      pointsAgainst: Number(standing?.points_against ?? 0) || null,
    });
  }
  return { leagueKey, standings };
}

// ── Scoreboard (parsed) ───────────────────────────────────────────────────

export async function getScoreboard(leagueKey: string) {
  const data = await yahooFetch(`/league/${leagueKey}/scoreboard`);
  return data.fantasy_content?.league ?? null;
}

export async function getParsedScoreboard(leagueKey: string): Promise<ParsedScoreboard> {
  const data = await yahooFetch(`/league/${leagueKey}/scoreboard`);
  const league = data.fantasy_content?.league;
  const sb = league?.[1]?.scoreboard;
  const week = Number(sb?.week ?? 0) || null;
  const matchupsObj = sb?.['0']?.matchups;

  const matchups: Matchup[] = [];
  for (let i = 0; i < (matchupsObj?.count ?? 0); i++) {
    const m = matchupsObj?.[i]?.matchup;
    if (!m) continue;

    const teamsObj = m['0']?.teams;
    const sides: MatchupSide[] = [];
    for (let j = 0; j < (teamsObj?.count ?? 0); j++) {
      const team = teamsObj?.[j]?.team;
      if (!team) continue;
      const meta  = team[0];
      const stats = team[1]?.team_stats?.stats ?? [];
      const points = team[1]?.team_points;

      const statMap: Record<string, string> = {};
      for (const wrapper of stats) {
        const s = wrapper?.stat;
        if (s?.stat_id != null) statMap[String(s.stat_id)] = String(s.value ?? '');
      }

      sides.push({
        teamKey:     findAttr(meta, 'team_key') ?? '',
        name:        findAttr(meta, 'name') ?? '',
        isOwnedByCurrentLogin: Number(findAttr(meta, 'is_owned_by_current_login')) === 1,
        totalPoints: points?.total != null ? Number(points.total) : null,
        statsByStatId: statMap,
      });
    }

    matchups.push({
      week:    Number(m.week ?? week ?? 0) || null,
      status:  m.status ?? null,
      isPlayoffs: m.is_playoffs === '1',
      isConsolation: m.is_consolation === '1',
      sides,
    });
  }
  return { leagueKey, week, matchups };
}

// ── Transactions (recent league activity) ─────────────────────────────────

export async function getRecentTransactions(leagueKey: string, count = 25): Promise<YahooTransaction[]> {
  const data = await yahooFetch(`/league/${leagueKey}/transactions;count=${count}`);
  const txObj = data.fantasy_content?.league?.[1]?.transactions;

  const out: YahooTransaction[] = [];
  for (let i = 0; i < (txObj?.count ?? 0); i++) {
    const t = txObj?.[i]?.transaction;
    if (!t) continue;
    const meta = t[0];

    const transactionKey  = findAttr(meta, 'transaction_key') ?? '';
    const type            = findAttr(meta, 'type') ?? '';
    const status          = findAttr(meta, 'status') ?? '';
    const timestamp       = Number(findAttr(meta, 'timestamp') ?? 0) || null;

    // Players involved
    const playersObj = t[1]?.players;
    const players: YahooTransactionPlayer[] = [];
    for (let j = 0; j < (playersObj?.count ?? 0); j++) {
      const p = playersObj?.[j]?.player;
      if (!p) continue;
      const info = p[0];
      const tx   = p[1]?.transaction_data?.[0] ?? p[1]?.transaction_data;
      players.push({
        playerKey: findAttr(info, 'player_key') ?? '',
        name:      findAttr(info, 'name')?.full ?? '',
        position:  findAttr(info, 'display_position') ?? '',
        team:      findAttr(info, 'editorial_team_abbr') ?? '',
        action:    tx?.type ?? null,                         // 'add' | 'drop' | 'trade'
        sourceTeamName: tx?.source_team_name ?? null,
        destTeamName:   tx?.destination_team_name ?? null,
      });
    }

    out.push({ transactionKey, type, status, timestamp, players });
  }
  return out;
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface YahooLeague {
  leagueKey:   string;
  leagueId:    string;
  name:        string;
  season:      string;
  numTeams:    number;
  scoringType: string;
  gameKey:     string;
  gameName:    string;
}

export interface YahooTeam {
  teamKey:  string;
  teamId:   string;
  name:     string;
  isOwnedByCurrentLogin: boolean;
  managerName?: string | null;
}

export interface YahooRosterPlayer {
  playerKey:         string;
  playerId:          string;
  name:              string;
  editorialTeam:     string;
  displayPosition:   string;
  eligiblePositions: string[];
  selectedPosition:  string | null;
  injuryStatus:      string | null;
}

export interface YahooTeamWithRoster extends YahooTeam {
  roster: YahooRosterPlayer[];
}

export interface ScoringCategory {
  statId:       string;
  name:         string;
  displayName:  string;
  sortOrder:    'asc' | 'desc';   // asc = lower is better (ERA, WHIP)
  positionType: string;           // "B" batter, "P" pitcher
  isDisplayOnly: boolean;
}

export interface RosterSlot {
  position:     string;
  count:        number;
  positionType: string;
}

export interface ParsedLeagueSettings {
  leagueKey:    string;
  name:         string;
  season:       string;
  numTeams:     number | null;
  scoringType:  string | null;
  weekly:       string | null;
  currentWeek:  string | undefined;
  startWeek:    string | undefined;
  endWeek:      string | undefined;
  categories:   ScoringCategory[];
  rosterPositions: RosterSlot[];
}

export interface TeamStanding {
  teamKey:     string;
  teamId:      string;
  name:        string;
  managerName: string | null;
  isOwnedByCurrentLogin: boolean;
  rank:        number | null;
  wins:        number;
  losses:      number;
  ties:        number;
  winPct:      number | null;
  gamesBack:   string | null;
  pointsFor:   number | null;
  pointsAgainst: number | null;
}

export interface ParsedStandings {
  leagueKey: string;
  standings: TeamStanding[];
}

export interface MatchupSide {
  teamKey:     string;
  name:        string;
  isOwnedByCurrentLogin: boolean;
  totalPoints: number | null;
  statsByStatId: Record<string, string>;
}

export interface Matchup {
  week:    number | null;
  status:  string | null;
  isPlayoffs:    boolean;
  isConsolation: boolean;
  sides:   MatchupSide[];
}

export interface ParsedScoreboard {
  leagueKey: string;
  week:      number | null;
  matchups:  Matchup[];
}

export interface YahooTransactionPlayer {
  playerKey:      string;
  name:           string;
  position:       string;
  team:           string;
  action:         string | null;       // 'add', 'drop', 'trade'
  sourceTeamName: string | null;
  destTeamName:   string | null;
}

export interface YahooTransaction {
  transactionKey: string;
  type:           string;
  status:         string;
  timestamp:      number | null;
  players:        YahooTransactionPlayer[];
}

export interface YahooPlayerStats {
  playerKey: string;
  playerId:  string;
  name:      string;
  stats:     Record<string, string>;
}
