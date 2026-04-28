import { pgTable, text, serial, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  team: text("team"),
  positions: text("positions").notNull(),
  posDisplay: text("pos_display").notNull(),
  fpRank: integer("fp_rank"),
  espnRank: integer("espn_rank"),
  yahooRank: integer("yahoo_rank"),
  espnAuction: real("espn_auction"),
  consensusRank: real("consensus_rank"),
  myRank: integer("my_rank"),
  myPosRank: integer("my_pos_rank"),
  roundOverride: integer("round_override"),
  tags: text("tags").default(''),
  status: text("status").default('available'),
  rosterSlot: text("roster_slot"),
  notes: text("notes").default(''),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const roundStrategy = pgTable("round_strategy", {
  id: serial("id").primaryKey(),
  roundNum: integer("round_num").notNull().unique(),
  picksRange: text("picks_range"),
  targetPositions: text("target_positions").default(''),
  tier: text("tier").default(''),
  targetNames: text("target_names").default(''),
  notes: text("notes").default(''),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const cheatSheet = pgTable("cheat_sheet", {
  id: serial("id").primaryKey(),
  section: text("section").notNull().unique(),
  content: text("content").default(''),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const draftState = pgTable("draft_state", {
  id: integer("id").primaryKey(),
  currentRound: integer("current_round").default(1),
  currentPick: integer("current_pick").default(1),
  rankMode: text("rank_mode").default('priority'),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const insertPlayerSchema = createInsertSchema(players).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRoundStrategySchema = createInsertSchema(roundStrategy).omit({ id: true, updatedAt: true });
export const insertCheatSheetSchema = createInsertSchema(cheatSheet).omit({ id: true, updatedAt: true });
export const insertDraftStateSchema = createInsertSchema(draftState).omit({ updatedAt: true });

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type RoundStrategy = typeof roundStrategy.$inferSelect;
export type InsertRoundStrategy = z.infer<typeof insertRoundStrategySchema>;
export type CheatSheet = typeof cheatSheet.$inferSelect;
export type InsertCheatSheet = z.infer<typeof insertCheatSheetSchema>;
export type DraftState = typeof draftState.$inferSelect;
export type InsertDraftState = z.infer<typeof insertDraftStateSchema>;

// API request types
export type UpdatePlayerRequest = Partial<InsertPlayer>;
export type UpdateRoundStrategyRequest = Partial<InsertRoundStrategy>;
export type UpdateDraftStateRequest = Partial<InsertDraftState>;

export type EnrichedPlayer = Player & { tagsArray: string[], priorityRank: number };

export type DashboardData = {
  state: DraftState;
  myRoster: EnrichedPlayer[];
  top10Targets: EnrichedPlayer[];
  sleepers: EnrichedPlayer[];
  breakout: EnrichedPlayer[];
  top5: EnrichedPlayer[];
  bestByPos: Record<string, EnrichedPlayer | null>;
  roundData: Record<number, EnrichedPlayer[]>;
  nextBest: EnrichedPlayer | null;
  totalDrafted: number;
  dynamicRound: number;
};

// Yahoo OAuth token storage (single-user for now, id always = 1)
export const yahooTokens = pgTable("yahoo_tokens", {
  id:           integer("id").primaryKey(),        // always 1 for single-user
  accessToken:  text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt:    timestamp("expires_at").notNull(),
  yahooGuid:    text("yahoo_guid"),                // Yahoo user GUID
  updatedAt:    timestamp("updated_at").defaultNow(),
});

// The user's selected Yahoo fantasy league
export const yahooLeague = pgTable("yahoo_league", {
  id:           integer("id").primaryKey(),        // always 1
  leagueKey:    text("league_key").notNull(),       // e.g. "423.l.12345"
  leagueId:     text("league_id").notNull(),
  name:         text("name").notNull(),
  season:       text("season").notNull(),
  numTeams:     integer("num_teams"),
  scoringType:  text("scoring_type"),
  myTeamKey:    text("my_team_key"),               // e.g. "423.l.12345.t.3"
  myTeamName:   text("my_team_name"),
  lastSyncedAt: timestamp("last_synced_at"),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export type YahooTokens = typeof yahooTokens.$inferSelect;
export type YahooLeagueRow = typeof yahooLeague.$inferSelect;

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

// ── AI Conversations (chat history) ─────────────────────────────────────
export const aiConversations = pgTable("ai_conversations", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").default(1),
  sessionId:   text("session_id").notNull(),
  role:        text("role").notNull(),
  content:     text("content").notNull(),
  pageContext: text("page_context"),
  modelUsed:   text("model_used"),
  tokensIn:    integer("tokens_in"),
  tokensOut:   integer("tokens_out"),
  createdAt:   timestamp("created_at").defaultNow(),
});

// ── AI Usage Tracking (privacy-safe metadata) ───────────────────────────
export const aiUsage = pgTable("ai_usage", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").default(1),
  sessionId:    text("session_id"),
  pageContext:  text("page_context"),
  modelUsed:    text("model_used"),
  tokensIn:     integer("tokens_in").default(0),
  tokensOut:    integer("tokens_out").default(0),
  costEstimate: real("cost_estimate"),
  responseMs:   integer("response_ms"),
  success:      boolean("success").default(true),
  errorType:    text("error_type"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export type AiConversation = typeof aiConversations.$inferSelect;
export type AiUsage         = typeof aiUsage.$inferSelect;

// ── Player status: injuries, role, current team info ──────────────────────
export const playerStatus = pgTable("player_status", {
  id:             serial("id").primaryKey(),
  playerId:       integer("player_id").notNull().unique(),
  mlbamId:        integer("mlbam_id"),
  isActive:       boolean("is_active").default(true),
  injuryStatus:   text("injury_status"),
  injuryNotes:    text("injury_notes"),
  injuryReturnDate: text("injury_return_date"),
  currentTeam:    text("current_team"),
  currentLeague:  text("current_league"),
  currentPosition: text("current_position"),
  jerseyNumber:   text("jersey_number"),
  battingHand:    text("batting_hand"),
  throwingHand:   text("throwing_hand"),
  rosterStatus:   text("roster_status"),
  positionType:   text("position_type"),
  birthDate:      text("birth_date"),
  age:            integer("age"),
  heightInches:   integer("height_inches"),
  weightLbs:      integer("weight_lbs"),
  dataSource:     text("data_source").default('mlb-stats-api'),
  fetchedAt:      timestamp("fetched_at").defaultNow(),
});

export type PlayerStatus = typeof playerStatus.$inferSelect;
