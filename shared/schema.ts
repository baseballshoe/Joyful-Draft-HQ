import { pgTable, text, serial, integer, timestamp, real } from "drizzle-orm/pg-core";
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
  top5: EnrichedPlayer[];
  bestByPos: Record<string, EnrichedPlayer | null>;
  roundData: Record<number, EnrichedPlayer[]>;
  nextBest: EnrichedPlayer | null;
};
