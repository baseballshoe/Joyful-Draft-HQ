// server/external/schedule-impl.ts
// ─────────────────────────────────────────────────────────────────────
// MLB Stats API implementation of the ScheduleProvider interface.
//
// ⚠️ COMMERCIAL LICENSING:
//   MLB Stats API (statsapi.mlb.com) is NON-COMMERCIAL ONLY per their
//   copyright notice. This file is fine for personal-use phase but
//   MUST be rewritten against a licensed provider before charging
//   users (Phase 3). See 02_COMPLIANCE_FRAMEWORK.md for migration plan.
//
//   TODO(commercial): replace before public launch.
//
// Endpoints used:
//   GET /api/v1/schedule?sportId=1&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//       hydrate=probablePitcher
//
// Caches results in the existing yahoo_cache table via the cache layer.
// ─────────────────────────────────────────────────────────────────────
import * as yahooCache from '../yahoo-cache';
import type {
  ScheduleProvider, WeekSchedule, GameInfo, ProbableStartsMap,
} from './schedule';

const MLB_STATS_BASE = 'https://statsapi.mlb.com/api/v1';

// ── Raw fetch helpers ────────────────────────────────────────────────────

interface MlbScheduleResponse {
  dates: Array<{
    date: string; // YYYY-MM-DD
    games: Array<{
      gamePk: number;
      gameDate: string;
      doubleHeader?: string; // 'N' / 'Y' / 'S'
      teams: {
        home: {
          team: { id: number; name: string; abbreviation?: string };
          probablePitcher?: { id: number; fullName: string };
        };
        away: {
          team: { id: number; name: string; abbreviation?: string };
          probablePitcher?: { id: number; fullName: string };
        };
      };
    }>;
  }>;
}

async function fetchScheduleRaw(
  startDate: string,
  endDate: string,
): Promise<MlbScheduleResponse> {
  const url = `${MLB_STATS_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher,team`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<MlbScheduleResponse>;
}

// ── Team abbreviation lookup ─────────────────────────────────────────────
// MLB Stats API doesn't always return team.abbreviation in every endpoint.
// This map is the canonical fallback. Keyed by MLB team ID.

const TEAM_ABBR_BY_ID: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

function abbrFor(team: { id: number; abbreviation?: string }): string {
  return team.abbreviation ?? TEAM_ABBR_BY_ID[team.id] ?? `T${team.id}`;
}

// ── Provider implementation ──────────────────────────────────────────────

export const mlbScheduleProvider: ScheduleProvider = {
  async getWeekSchedule(startDate: string, endDate: string): Promise<WeekSchedule> {
    const cacheKey = `mlb:schedule:${startDate}:${endDate}`;

    const result = await yahooCache.getCached(
      cacheKey,
      async () => parseSchedule(await fetchScheduleRaw(startDate, endDate), startDate, endDate),
    );

    return result.data;
  },

  async getProbableStarts(startDate: string, endDate: string): Promise<ProbableStartsMap> {
    const cacheKey = `mlb:probables:${startDate}:${endDate}`;

    const result = await yahooCache.getCached(
      cacheKey,
      async () => parseProbables(await fetchScheduleRaw(startDate, endDate), startDate, endDate),
    );

    return result.data;
  },
};

// ── Parsers ──────────────────────────────────────────────────────────────

function parseSchedule(
  raw: MlbScheduleResponse,
  startDate: string,
  endDate: string,
): WeekSchedule {
  const gamesByTeam: Record<string, GameInfo[]> = {};
  const allTeams = new Set<string>();

  for (const day of raw.dates ?? []) {
    for (const g of day.games ?? []) {
      const home = abbrFor(g.teams.home.team);
      const away = abbrFor(g.teams.away.team);
      allTeams.add(home);
      allTeams.add(away);

      const isDH = g.doubleHeader === 'Y' || g.doubleHeader === 'S';

      const game: GameInfo = {
        gamePk:       String(g.gamePk),
        date:         day.date,
        homeTeam:     home,
        awayTeam:     away,
        doubleHeader: isDH,
      };

      (gamesByTeam[home] ??= []).push(game);
      (gamesByTeam[away] ??= []).push(game);
    }
  }

  // Sort each team's games chronologically (already roughly in order, but be safe)
  for (const team of Object.keys(gamesByTeam)) {
    gamesByTeam[team].sort((a, b) => a.date.localeCompare(b.date));
  }

  const gameCountByTeam: Record<string, number> = {};
  for (const [team, games] of Object.entries(gamesByTeam)) {
    gameCountByTeam[team] = games.length;
  }

  return {
    startDate,
    endDate,
    fetchedAt: new Date(),
    gamesByTeam,
    gameCountByTeam,
    allTeams: Array.from(allTeams).sort(),
  };
}

function parseProbables(
  raw: MlbScheduleResponse,
  startDate: string,
  endDate: string,
): ProbableStartsMap {
  const startCountByPlayerId: Record<string, number> = {};
  const nameByPlayerId: Record<string, string> = {};

  for (const day of raw.dates ?? []) {
    for (const g of day.games ?? []) {
      const homeP = g.teams.home.probablePitcher;
      const awayP = g.teams.away.probablePitcher;

      if (homeP?.id) {
        const id = String(homeP.id);
        startCountByPlayerId[id] = (startCountByPlayerId[id] ?? 0) + 1;
        nameByPlayerId[id] = homeP.fullName ?? nameByPlayerId[id] ?? '';
      }
      if (awayP?.id) {
        const id = String(awayP.id);
        startCountByPlayerId[id] = (startCountByPlayerId[id] ?? 0) + 1;
        nameByPlayerId[id] = awayP.fullName ?? nameByPlayerId[id] ?? '';
      }
    }
  }

  return {
    startDate,
    endDate,
    fetchedAt: new Date(),
    startCountByPlayerId,
    nameByPlayerId,
  };
}
