/**
 * server/yahoo.ts
 * ───────────────
 * Yahoo Fantasy Sports OAuth 2.0 + API service.
 *
 * Env vars required (add to Replit Secrets):
 *   YAHOO_CLIENT_ID      — from developer.yahoo.com
 *   YAHOO_CLIENT_SECRET  — from developer.yahoo.com
 *   APP_BASE_URL         — https://drafthq.replit.app (no trailing slash)
 */

import { db } from './db';
import { yahooTokens } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ── Config ────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.YAHOO_CLIENT_ID!;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET!;
const BASE_URL      = process.env.APP_BASE_URL ?? 'https://drafthq.replit.app';
const REDIRECT_URI  = `${BASE_URL}/api/auth/yahoo/callback`;

const YAHOO_AUTH_URL  = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API_BASE  = 'https://fantasysports.yahooapis.com/fantasy/v2';

// ── Token storage helpers ─────────────────────────────────────────────────
export async function saveTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  yahooGuid?: string;
}) {
  // We use id=1 as the single-user token row (extend to multi-user later)
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
  const [row] = await db
    .select()
    .from(yahooTokens)
    .where(eq(yahooTokens.id, 1));
  return row ?? null;
}

export async function clearTokens() {
  await db.delete(yahooTokens).where(eq(yahooTokens.id, 1));
}

// ── OAuth flow ────────────────────────────────────────────────────────────
/** Returns the Yahoo authorization URL to redirect the user to */
export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'fspt-r',   // Fantasy Sports read
  });
  return `${YAHOO_AUTH_URL}?${params}`;
}

/** Exchanges auth code for access + refresh tokens */
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

/** Refreshes an expired access token */
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

// ── Authenticated API fetcher ──────────────────────────────────────────────
async function yahooFetch(path: string): Promise<any> {
  const tokens = await getTokens();
  if (!tokens) throw new Error('Not connected to Yahoo — please authenticate first');

  // Auto-refresh if expired (with 60s buffer)
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

// ── Yahoo API methods ─────────────────────────────────────────────────────

/** Get all fantasy baseball leagues for the current user */
export async function getLeagues(): Promise<YahooLeague[]> {
  // Games endpoint — get current MLB fantasy game key
  const gamesData = await yahooFetch('/users;use_login=1/games;game_codes=mlb/leagues');

  try {
    const users = gamesData.fantasy_content?.users;
    const user  = users?.[0]?.user;
    const games = user?.[1]?.games;

    const leagues: YahooLeague[] = [];

    // Iterate over games (could be multiple seasons)
    for (let g = 0; g < (games?.count ?? 0); g++) {
      const game = games?.[g]?.game;
      if (!game) continue;

      const gameName: string  = game[0]?.name ?? '';
      const gameKey:  string  = game[0]?.game_key ?? '';
      const leaguesObj = game[1]?.leagues;

      for (let l = 0; l < (leaguesObj?.count ?? 0); l++) {
        const league = leaguesObj?.[l]?.league?.[0];
        if (!league) continue;
        leagues.push({
          leagueKey:  league.league_key,
          leagueId:   league.league_id,
          name:       league.name,
          season:     league.season,
          numTeams:   league.num_teams,
          scoringType:league.scoring_type,
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

/** Get teams in a league */
export async function getLeagueTeams(leagueKey: string): Promise<YahooTeam[]> {
  const data = await yahooFetch(`/league/${leagueKey}/teams`);
  const teamsData = data.fantasy_content?.league?.[1]?.teams;
  const teams: YahooTeam[] = [];

  for (let i = 0; i < (teamsData?.count ?? 0); i++) {
    const t = teamsData?.[i]?.team?.[0];
    if (!t || !Array.isArray(t)) continue;

    // Yahoo team[0] is an array of attribute objects — search through all of them
    const findAttr = (key: string) => {
      for (const item of t) {
        if (item && typeof item === 'object' && key in item) return item[key];
      }
      return undefined;
    };

    teams.push({
      teamKey:  findAttr('team_key') ?? '',
      teamId:   String(findAttr('team_id') ?? ''),
      name:     findAttr('name') ?? '',
      // Yahoo returns 1 (number) for the current user's team; also guard string "1"
      isOwnedByCurrentLogin: Number(findAttr('is_owned_by_current_login')) === 1,
    });
  }
  console.log(`[Yahoo] getLeagueTeams(${leagueKey}): found ${teams.length} teams, mine=${teams.find(t=>t.isOwnedByCurrentLogin)?.name ?? 'not found'}`);
  return teams;
}

/** Get my roster for a specific team */
export async function getMyRoster(teamKey: string): Promise<YahooRosterPlayer[]> {
  const data = await yahooFetch(`/team/${teamKey}/roster/players`);
  const playersData = data.fantasy_content?.team?.[1]?.roster?.['0']?.players;
  const roster: YahooRosterPlayer[] = [];

  for (let i = 0; i < (playersData?.count ?? 0); i++) {
    const p = playersData?.[i]?.player;
    if (!p) continue;
    const info    = p[0];
    const status  = p[1];
    roster.push({
      playerKey:       info?.[0]?.player_key,
      playerId:        info?.[1]?.player_id,
      name:            info?.[2]?.name?.full,
      editorialTeam:   info?.[6]?.editorial_team_abbr,
      displayPosition: info?.[4]?.display_position,
      eligiblePositions: info?.[4]?.eligible_positions?.map((e: any) => e.position) ?? [],
      selectedPosition: status?.[0]?.selected_position?.[1]?.position,
      injuryStatus:     info?.[10]?.status ?? null,
    });
  }
  return roster;
}

/** Get season stats for players by player keys */
export async function getPlayerStats(playerKeys: string[], leagueKey: string): Promise<YahooPlayerStats[]> {
  if (playerKeys.length === 0) return [];

  // Yahoo allows up to 25 players per request
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

/** Get free agents / waiver wire for a league */
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
      playerKey:         info?.[0]?.player_key,
      playerId:          info?.[1]?.player_id,
      name:              info?.[2]?.name?.full,
      editorialTeam:     info?.[6]?.editorial_team_abbr,
      displayPosition:   info?.[4]?.display_position,
      eligiblePositions: info?.[4]?.eligible_positions?.map((e: any) => e.position) ?? [],
      selectedPosition:  null,
      injuryStatus:      info?.[10]?.status ?? null,
    });
  }
  return players;
}

/** Get league settings (scoring categories, roster positions) */
export async function getLeagueSettings(leagueKey: string) {
  const data = await yahooFetch(`/league/${leagueKey}/settings`);
  return data.fantasy_content?.league ?? null;
}

/** Get current standings */
export async function getStandings(leagueKey: string) {
  const data = await yahooFetch(`/league/${leagueKey}/standings`);
  return data.fantasy_content?.league ?? null;
}

/** Get current scoreboard / matchups */
export async function getScoreboard(leagueKey: string) {
  const data = await yahooFetch(`/league/${leagueKey}/scoreboard`);
  return data.fantasy_content?.league ?? null;
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

export interface YahooPlayerStats {
  playerKey: string;
  playerId:  string;
  name:      string;
  stats:     Record<string, string>; // stat_id → value
}
