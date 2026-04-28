// server/external/schedule.ts
// ─────────────────────────────────────────────────────────────────────
// External schedule provider — abstraction layer.
//
// COMMERCIAL-READINESS PATTERN:
//   Internal code (Coach context, pages) imports `scheduleProvider`
//   from this file. The implementation lives in `schedule-impl.ts`.
//
//   When going commercial (Phase 3), swap which impl is exported below.
//   No internal code changes. One file, one line.
//
// CURRENT IMPLEMENTATION: MLB Stats API (statsapi.mlb.com)
//   - ✅ Free
//   - ✅ Comprehensive (schedules + probable pitchers + game state)
//   - ❌ Non-commercial only per MLB's TOS
//   - 🔁 PRE-COMMERCIAL SWAP: rewrite schedule-impl.ts against
//        SportsDataIO ($500-1500/mo) or Sportradar ($1,500-5,000/mo)
//        before charging users.
//
// See 02_COMPLIANCE_FRAMEWORK.md for full provider comparison.
// ─────────────────────────────────────────────────────────────────────
import { mlbScheduleProvider } from './schedule-impl';

// ── Public interface — internal code imports this and only this ─────────

export interface ScheduleProvider {
  /**
   * Fetch the schedule for a date range.
   * @param startDate ISO "YYYY-MM-DD"
   * @param endDate   ISO "YYYY-MM-DD" (inclusive)
   */
  getWeekSchedule(startDate: string, endDate: string): Promise<WeekSchedule>;

  /**
   * Fetch probable starters for each game in a date range.
   * Returns a map keyed by team abbreviation: how many starts each
   * pitcher has across the range, indexed by their player ID.
   *
   * @param startDate ISO "YYYY-MM-DD"
   * @param endDate   ISO "YYYY-MM-DD" (inclusive)
   */
  getProbableStarts(startDate: string, endDate: string): Promise<ProbableStartsMap>;
}

export interface WeekSchedule {
  startDate: string;
  endDate:   string;
  fetchedAt: Date;
  /** team abbreviation → array of games in the range, in chronological order */
  gamesByTeam: Record<string, GameInfo[]>;
  /** team abbreviation → game count in the range */
  gameCountByTeam: Record<string, number>;
  /** All MLB team abbreviations seen in the range (the ~30 active teams) */
  allTeams: string[];
}

export interface GameInfo {
  /** Provider-native game ID (string for portability — MLB returns ints) */
  gamePk:    string;
  /** ISO date YYYY-MM-DD */
  date:      string;
  homeTeam:  string;
  awayTeam:  string;
  /** True if it's part of a doubleheader */
  doubleHeader: boolean;
}

export interface ProbableStartsMap {
  startDate: string;
  endDate:   string;
  fetchedAt: Date;
  /**
   * Player ID → number of starts in the range.
   * Player IDs are MLBAM IDs in the MLB Stats API impl. When swapping
   * providers, document the ID system in the impl.
   */
  startCountByPlayerId: Record<string, number>;
  /**
   * Player ID → display name (cheap convenience for debugging / logging)
   */
  nameByPlayerId: Record<string, string>;
}

// ── Provider binding — swap this line at commercial launch ──────────────

export const scheduleProvider: ScheduleProvider = mlbScheduleProvider;
