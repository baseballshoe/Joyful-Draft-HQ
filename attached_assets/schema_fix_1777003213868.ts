// ── SCHEMA FIX FOR STATS TABLES ─────────────────────────────────────────
//
// This is a REPLACEMENT for the existing player_ids, batter_stats, and
// pitcher_stats table definitions in shared/schema.ts.
//
// Find your existing `playerIds`, `batterStats`, `pitcherStats` exports
// in shared/schema.ts and replace them with this block.
//
// The change: playerId now has .unique() which was missing before.
//
// After replacing, the existing constraint we just added via psql
// will already satisfy this. If you ever recreate the DB from scratch,
// this schema will now correctly create the constraint.

import { pgTable, text, integer, real, timestamp, serial } from "drizzle-orm/pg-core";

// ── Player IDs across systems (FIXED: added .unique() to player_id) ──────
export const playerIds = pgTable("player_ids", {
  id:             serial("id").primaryKey(),
  playerId:       integer("player_id").notNull().unique(),  // ← THE FIX
  mlbamId:        integer("mlbam_id"),
  fangraphsId:    integer("fangraphs_id"),
  bbrefId:        text("bbref_id"),
  yahooPlayerKey: text("yahoo_player_key"),
  nameNormalized: text("name_normalized"),
  updatedAt:      timestamp("updated_at").defaultNow(),
});

// ── Batter stats (unchanged) ────────────────────────────────────────────
export const batterStats = pgTable("batter_stats", {
  id:          serial("id").primaryKey(),
  playerId:    integer("player_id").notNull(),
  season:      integer("season").notNull(),

  games:       integer("games"),
  atBats:      integer("at_bats"),
  plateApps:   integer("plate_apps"),
  runs:        integer("runs"),
  hits:        integer("hits"),
  doubles:     integer("doubles"),
  triples:     integer("triples"),
  homeRuns:    integer("home_runs"),
  rbi:         integer("rbi"),
  stolenBases: integer("stolen_bases"),
  caughtStealing: integer("caught_stealing"),
  walks:       integer("walks"),
  strikeouts:  integer("strikeouts"),

  avg:         real("avg"),
  obp:         real("obp"),
  slg:         real("slg"),
  ops:         real("ops"),
  iso:         real("iso"),
  babip:       real("babip"),
  wOBA:        real("w_oba"),
  wRCplus:     real("wrc_plus"),

  barrelPct:   real("barrel_pct"),
  hardHitPct:  real("hard_hit_pct"),
  avgExitVelo: real("avg_exit_velo"),
  maxExitVelo: real("max_exit_velo"),
  avgLaunchAngle: real("avg_launch_angle"),
  xBA:         real("xba"),
  xSLG:        real("xslg"),
  xwOBA:       real("xwoba"),

  chasePct:    real("chase_pct"),
  whiffPct:    real("whiff_pct"),
  contactPct:  real("contact_pct"),
  zoneContactPct: real("zone_contact_pct"),
  sprintSpeed: real("sprint_speed"),

  dataSource:  text("data_source"),
  fetchedAt:   timestamp("fetched_at").defaultNow(),
});

// ── Pitcher stats (unchanged) ───────────────────────────────────────────
export const pitcherStats = pgTable("pitcher_stats", {
  id:          serial("id").primaryKey(),
  playerId:    integer("player_id").notNull(),
  season:      integer("season").notNull(),

  games:       integer("games"),
  gamesStarted: integer("games_started"),
  wins:        integer("wins"),
  losses:      integer("losses"),
  saves:       integer("saves"),
  holds:       integer("holds"),
  qualityStarts: integer("quality_starts"),
  inningsPitched: real("innings_pitched"),
  hitsAllowed: integer("hits_allowed"),
  earnedRuns:  integer("earned_runs"),
  walksAllowed: integer("walks_allowed"),
  strikeoutsPitched: integer("strikeouts_pitched"),
  homerunsAllowed: integer("homeruns_allowed"),

  era:         real("era"),
  whip:        real("whip"),
  kPer9:       real("k_per_9"),
  bbPer9:      real("bb_per_9"),
  kRate:       real("k_rate"),
  bbRate:      real("bb_rate"),
  kMinusBB:    real("k_minus_bb"),

  fip:         real("fip"),
  xFIP:        real("x_fip"),
  siera:       real("siera"),
  xERA:        real("x_era"),
  war:         real("war"),

  avgFastballVelo: real("avg_fastball_velo"),
  maxFastballVelo: real("max_fastball_velo"),
  spinRate:    real("spin_rate"),

  barrelPctAgainst: real("barrel_pct_against"),
  hardHitPctAgainst: real("hard_hit_pct_against"),
  xwOBAagainst: real("xwoba_against"),
  xBAagainst:  real("xba_against"),

  cswPct:      real("csw_pct"),
  swStrikePct: real("sw_strike_pct"),
  chasePctInduced: real("chase_pct_induced"),
  zonePct:     real("zone_pct"),

  dataSource:  text("data_source"),
  fetchedAt:   timestamp("fetched_at").defaultNow(),
});

export type PlayerIds    = typeof playerIds.$inferSelect;
export type BatterStats  = typeof batterStats.$inferSelect;
export type PitcherStats = typeof pitcherStats.$inferSelect;
