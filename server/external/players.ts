// server/external/players.ts
// ─────────────────────────────────────────────────────────────────────
// External player provider — abstraction layer.
//
// Used for RUNTIME player lookups (e.g., "Yahoo just gave us a
// player_key we don't recognize, who is this?"). The bulk nightly
// roster seed is handled by scripts/pull_players.py running on
// GitHub Actions — it does NOT go through this interface.
//
// COMMERCIAL-READINESS PATTERN:
//   Internal code imports `playersProvider` from this file. The impl
//   in `players-impl.ts` swaps when going commercial — same pattern
//   as schedule.ts.
//
// CURRENT IMPLEMENTATION: MLB Stats API (statsapi.mlb.com)
//   - ✅ Free, no key required
//   - ❌ Non-commercial only per MLB's TOS
//   - 🔁 Pre-Phase-3 swap: rewrite players-impl.ts against
//        SportsDataIO ($500-1500/mo) or Sportradar ($1,500-5,000/mo)
//
// See 02_COMPLIANCE_FRAMEWORK.md for full provider comparison.
// ─────────────────────────────────────────────────────────────────────
import { mlbPlayersProvider } from './players-impl';

// ── Public interface ─────────────────────────────────────────────────────

export interface PlayersProvider {
  /**
   * Look up a single player by their MLBAM ID. Returns null if not found.
   * Cached internally (24h TTL — player metadata rarely changes).
   */
  getPlayerByMlbamId(mlbamId: number): Promise<PlayerInfo | null>;

  /**
   * Search for active MLB players by name. Useful when Yahoo gives us
   * a player_key we don't recognize. Returns up to 5 candidates ranked
   * by name similarity. Returns empty array if none found.
   */
  searchPlayersByName(query: string): Promise<PlayerInfo[]>;
}

export interface PlayerInfo {
  /** Provider-native player ID. MLBAM ID for the MLB Stats API impl. */
  mlbamId:        number;
  fullName:       string;
  active:         boolean;
  /** Team abbreviation (e.g. "NYY"). May be empty for free agents. */
  teamAbbr:       string;
  /** Primary fielding position abbreviation. */
  positionAbbr:   string;
  birthDate?:     string;
  bats?:          'R' | 'L' | 'S';
  throws?:        'R' | 'L';
  jerseyNumber?:  string;
}

// ── Provider binding — swap this line at commercial launch ──────────────

export const playersProvider: PlayersProvider = mlbPlayersProvider;
