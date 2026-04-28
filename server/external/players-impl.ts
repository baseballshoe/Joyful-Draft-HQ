// server/external/players-impl.ts
// ─────────────────────────────────────────────────────────────────────
// MLB Stats API implementation of the PlayersProvider interface.
//
// ⚠️ COMMERCIAL LICENSING:
//   MLB Stats API is non-commercial-only per their TOS. Fine for
//   personal use; MUST be replaced before charging users.
//   TODO(commercial): replace before public launch.
//
// The bulk nightly seed runs in scripts/pull_players.py (Python, on
// GitHub Actions). This file is for RUNTIME lookups when the app
// encounters a player it doesn't recognize.
//
// Endpoints used:
//   GET /api/v1/people/{mlbamId}                   — single player lookup
//   GET /api/v1/sports/1/players?season=YYYY       — full active list (search)
//
// Caching: leverages yahoo_cache via the existing cache layer with
// the new mlb:player:* prefix.
// ─────────────────────────────────────────────────────────────────────
import * as yahooCache from '../yahoo-cache';
import type { PlayersProvider, PlayerInfo } from './players';

const MLB_STATS_BASE = 'https://statsapi.mlb.com/api/v1';
const CURRENT_SEASON = new Date().getFullYear();

// ── Raw fetch types ──────────────────────────────────────────────────────

interface MlbPersonResponse {
  people: Array<{
    id: number;
    fullName: string;
    active?: boolean;
    currentTeam?: { abbreviation?: string };
    primaryPosition?: { abbreviation?: string };
    birthDate?: string;
    batSide?: { code?: string };
    pitchHand?: { code?: string };
    primaryNumber?: string;
  }>;
}

// ── Provider implementation ──────────────────────────────────────────────

export const mlbPlayersProvider: PlayersProvider = {
  async getPlayerByMlbamId(mlbamId: number): Promise<PlayerInfo | null> {
    const cacheKey = `mlb:player:${mlbamId}`;

    try {
      const result = await yahooCache.getCached<PlayerInfo | null>(
        cacheKey,
        async () => {
          const url = `${MLB_STATS_BASE}/people/${mlbamId}`;
          const res = await fetch(url);
          if (!res.ok) return null;
          const data = (await res.json()) as MlbPersonResponse;
          const p = data.people?.[0];
          if (!p) return null;
          return parsePerson(p);
        },
      );
      return result.data;
    } catch (e) {
      console.error('[players-impl] getPlayerByMlbamId failed:', e);
      return null;
    }
  },

  async searchPlayersByName(query: string): Promise<PlayerInfo[]> {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 2) return [];

    // Use a long-lived cache for the full-roster fetch — this list
    // is the same for every search query in the same day.
    const allPlayers = await getActiveRosterCached();

    // Simple containment + score-by-position match for ranking
    const scored: { p: PlayerInfo; score: number }[] = [];
    for (const p of allPlayers) {
      const name = p.fullName.toLowerCase();
      if (!name.includes(trimmed)) continue;
      // Earlier matches rank higher; exact match is best
      const idx = name.indexOf(trimmed);
      const exact = name === trimmed ? -1000 : idx;
      scored.push({ p, score: exact });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 5).map(s => s.p);
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function parsePerson(p: MlbPersonResponse['people'][0]): PlayerInfo {
  return {
    mlbamId:      p.id,
    fullName:     p.fullName,
    active:       p.active ?? false,
    teamAbbr:     (p.currentTeam?.abbreviation ?? '').toUpperCase(),
    positionAbbr: (p.primaryPosition?.abbreviation ?? '').toUpperCase(),
    birthDate:    p.birthDate,
    bats:         normaliseHand(p.batSide?.code),
    throws:       normaliseHand(p.pitchHand?.code) as ('R' | 'L' | undefined),
    jerseyNumber: p.primaryNumber,
  };
}

function normaliseHand(code: string | undefined): 'R' | 'L' | 'S' | undefined {
  if (!code) return undefined;
  const c = code.toUpperCase();
  if (c === 'R' || c === 'L' || c === 'S') return c;
  return undefined;
}

async function getActiveRosterCached(): Promise<PlayerInfo[]> {
  const cacheKey = `mlb:players:active:${CURRENT_SEASON}`;
  const result = await yahooCache.getCached<PlayerInfo[]>(
    cacheKey,
    async () => {
      const url = `${MLB_STATS_BASE}/sports/1/players?season=${CURRENT_SEASON}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`MLB Stats API ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as MlbPersonResponse;
      return (data.people ?? []).map(parsePerson).filter(p => !!p.fullName);
    },
  );
  return result.data;
}
