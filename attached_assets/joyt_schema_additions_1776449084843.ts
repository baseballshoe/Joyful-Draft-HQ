// ── ADD THESE TO THE BOTTOM OF shared/schema.ts ──────────────────────────
//
// These two new tables store Yahoo OAuth tokens and the user's
// connected league. Paste this block at the end of your existing
// shared/schema.ts file (before the last export lines).
//
// Then run:  npm run db:push
// to apply the schema changes to your Postgres database.

import { pgTable, text, serial, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";

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
