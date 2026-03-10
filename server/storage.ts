import { db } from "./db";
import { eq, asc, inArray, and, or, sql } from "drizzle-orm";
import {
  players,
  roundStrategy,
  cheatSheet,
  draftState,
  type Player,
  type InsertPlayer,
  type UpdatePlayerRequest,
  type RoundStrategy,
  type UpdateRoundStrategyRequest,
  type CheatSheet,
  type DraftState,
  type UpdateDraftStateRequest,
  type EnrichedPlayer,
  type DashboardData
} from "@shared/schema";
import { type ParsedImportData, calcConsensus, normalizeName } from "./import-service";

function enrichPlayer(p: Player): EnrichedPlayer {
  return {
    ...p,
    tagsArray: p.tags ? p.tags.split(',').filter(Boolean) : [],
    priorityRank: p.myRank ?? p.consensusRank ?? 9999,
  };
}

export interface IStorage {
  // Draft State
  getDraftState(): Promise<DraftState>;
  updateDraftState(updates: UpdateDraftStateRequest): Promise<DraftState>;

  // Players
  getPlayers(filters?: { status?: string; pos?: string; tag?: string; search?: string }): Promise<EnrichedPlayer[]>;
  getPlayer(id: number): Promise<EnrichedPlayer | undefined>;
  updatePlayer(id: number, updates: UpdatePlayerRequest): Promise<EnrichedPlayer>;
  resetPlayer(id: number): Promise<EnrichedPlayer>;

  // Dashboard
  getDashboardData(): Promise<DashboardData>;

  // Round Strategy
  getRoundStrategies(): Promise<RoundStrategy[]>;
  updateRoundStrategy(id: number, updates: UpdateRoundStrategyRequest): Promise<RoundStrategy>;

  // Cheat Sheet
  getCheatSheet(): Promise<Record<string, string>>;
  updateCheatSheet(section: string, content: string): Promise<void>;

  // Import Rankings
  importRankings(data: ParsedImportData): Promise<{ updated: number; inserted: number; total: number }>;
}

export class DatabaseStorage implements IStorage {
  async getDraftState(): Promise<DraftState> {
    const [state] = await db.select().from(draftState).where(eq(draftState.id, 1));
    if (!state) {
      const [newState] = await db.insert(draftState).values({ id: 1 }).returning();
      return newState;
    }
    return state;
  }

  async updateDraftState(updates: UpdateDraftStateRequest): Promise<DraftState> {
    const [state] = await db.update(draftState)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(draftState.id, 1))
      .returning();
    return state;
  }

  async getPlayers(filters?: { status?: string; pos?: string; tag?: string; search?: string }): Promise<EnrichedPlayer[]> {
    let query = db.select().from(players).$dynamic();
    let conditions = [];

    if (filters?.status && filters.status !== 'all') {
      conditions.push(eq(players.status, filters.status));
    }
    if (filters?.pos && filters.pos !== 'all') {
      conditions.push(eq(players.posDisplay, filters.pos));
    }
    if (filters?.tag && filters.tag !== 'all') {
      // Tags are comma separated
      conditions.push(sql`',' || ${players.tags} || ',' LIKE '%,' || ${filters.tag} || ',%'`);
    }
    if (filters?.search) {
      conditions.push(
        or(
          sql`LOWER(${players.name}) LIKE LOWER('%' || ${filters.search} || '%')`,
          sql`LOWER(${players.team}) LIKE LOWER('%' || ${filters.search} || '%')`
        )
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query.orderBy(asc(players.consensusRank));
    return results.map(enrichPlayer);
  }

  async getPlayer(id: number): Promise<EnrichedPlayer | undefined> {
    const [p] = await db.select().from(players).where(eq(players.id, id));
    if (!p) return undefined;
    return enrichPlayer(p);
  }

  async updatePlayer(id: number, updates: UpdatePlayerRequest): Promise<EnrichedPlayer> {
    const [updated] = await db.update(players)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning();
    return enrichPlayer(updated);
  }

  async resetPlayer(id: number): Promise<EnrichedPlayer> {
    const [updated] = await db.update(players)
      .set({ status: 'available', myRank: null, myPosRank: null, roundOverride: null, tags: '', notes: '', updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning();
    return enrichPlayer(updated);
  }

  async getDashboardData(): Promise<DashboardData> {
    const state = await this.getDraftState();
    const mode = state.rankMode ?? 'priority';
    const round = state.currentRound ?? 1;

    // We can fetch everything directly or do multiple queries. Let's do multiple simple queries.
    const myRosterRaw = await db.select().from(players).where(eq(players.status, 'mine')).orderBy(asc(players.updatedAt));
    const myRoster = myRosterRaw.map(enrichPlayer);

    const orderByMode = mode === 'consensus'
      ? asc(players.consensusRank)
      : sql`COALESCE(${players.myRank}, ${players.consensusRank}) ASC`;

    const availAndTarget = await db.select().from(players)
      .where(and(eq(players.status, 'available'), sql`',' || ${players.tags} || ',' LIKE '%,target,%'`))
      .orderBy(orderByMode)
      .limit(10);
    const top10Targets = availAndTarget.map(enrichPlayer);

    const availAndSleeper = await db.select().from(players)
      .where(and(eq(players.status, 'available'), sql`',' || ${players.tags} || ',' LIKE '%,sleeper,%'`))
      .orderBy(orderByMode)
      .limit(10);
    const sleepers = availAndSleeper.map(enrichPlayer);

    const availTop5 = await db.select().from(players)
      .where(eq(players.status, 'available'))
      .orderBy(orderByMode)
      .limit(5);
    const top5 = availTop5.map(enrichPlayer);

    const positions = ['C','1B','2B','3B','SS','OF','SP','RP','DH'];
    const bestByPos: Record<string, EnrichedPlayer | null> = {};

    for (const pos of positions) {
      const [best] = await db.select().from(players)
        .where(and(eq(players.status, 'available'), eq(players.posDisplay, pos)))
        .orderBy(sql`COALESCE(${players.myPosRank}, 9999) ASC`, sql`COALESCE(${players.myRank}, ${players.consensusRank}) ASC`)
        .limit(1);
      bestByPos[pos] = best ? enrichPlayer(best) : null;
    }

    const roundData: Record<number, EnrichedPlayer[]> = {};
    for (const r of [round - 1, round, round + 1].filter(x => x >= 1)) {
      const pickStart = (r - 1) * 12 + 1;
      const pickEnd = r * 12;

      const forcedRaw = await db.select().from(players)
        .where(and(eq(players.status, 'available'), eq(players.roundOverride, r)))
        .orderBy(orderByMode);
      const forced = forcedRaw.map(enrichPlayer);

      const naturalRaw = await db.select().from(players)
        .where(and(
          eq(players.status, 'available'),
          or(sql`${players.roundOverride} IS NULL`, sql`${players.roundOverride} != ${r}`),
          sql`${players.consensusRank} >= ${pickStart}`,
          sql`${players.consensusRank} <= ${pickEnd}`
        ))
        .orderBy(orderByMode)
        .limit(Math.max(0, 5 - forced.length));
      const natural = naturalRaw.map(enrichPlayer);

      roundData[r] = [...forced, ...natural].slice(0, 5);
    }

    const [nextBestRaw] = await db.select().from(players)
      .where(eq(players.status, 'available'))
      .orderBy(orderByMode)
      .limit(1);

    return {
      state,
      myRoster,
      top10Targets,
      sleepers,
      top5,
      bestByPos,
      roundData,
      nextBest: nextBestRaw ? enrichPlayer(nextBestRaw) : null
    };
  }

  async getRoundStrategies(): Promise<RoundStrategy[]> {
    return await db.select().from(roundStrategy).orderBy(asc(roundStrategy.roundNum));
  }

  async updateRoundStrategy(id: number, updates: UpdateRoundStrategyRequest): Promise<RoundStrategy> {
    const [updated] = await db.update(roundStrategy)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(roundStrategy.id, id))
      .returning();
    return updated;
  }

  async getCheatSheet(): Promise<Record<string, string>> {
    const rows = await db.select().from(cheatSheet);
    const result: Record<string, string> = {};
    const defaultSections = ['strategy', 'avoid', 'sleepers', 'scratchpad'];
    defaultSections.forEach(s => result[s] = '');
    rows.forEach(r => result[r.section] = r.content || '');
    return result;
  }

  async updateCheatSheet(section: string, content: string): Promise<void> {
    const existing = await db.select().from(cheatSheet).where(eq(cheatSheet.section, section));
    if (existing.length > 0) {
      await db.update(cheatSheet)
        .set({ content, updatedAt: new Date() })
        .where(eq(cheatSheet.section, section));
    } else {
      await db.insert(cheatSheet)
        .values({ section, content });
    }
  }

  async importRankings(data: ParsedImportData): Promise<{ updated: number; inserted: number; total: number }> {
    const { fp, espn, yahoo } = data;
    const maxRank = fp.size || 300;

    // Load all existing players
    const existing = await db.select().from(players);
    const byName = new Map<string, Player>();
    for (const p of existing) {
      byName.set(normalizeName(p.name), p);
    }

    let updated = 0;
    let inserted = 0;

    // Process every player from the FP list (master source)
    for (const [key, fpPlayer] of fp.entries()) {
      const espnPlayer = espn.get(key);
      const yahooPlayer = yahoo.get(key);

      const fpRank = fpPlayer.rank;
      const espnRank = espnPlayer?.rank ?? null;
      const yahooRank = yahooPlayer?.rank ?? null;
      const consensus = calcConsensus(fpRank, espnRank, yahooRank, maxRank);

      const existing = byName.get(key);
      if (existing) {
        await db.update(players)
          .set({
            fpRank,
            espnRank,
            yahooRank,
            consensusRank: consensus,
            team: fpPlayer.team || existing.team,
            posDisplay: fpPlayer.posDisplay !== "UTIL" ? fpPlayer.posDisplay : existing.posDisplay,
            updatedAt: new Date(),
          })
          .where(eq(players.id, existing.id));
        updated++;
      } else {
        await db.insert(players).values({
          name: fpPlayer.name,
          team: fpPlayer.team || espnPlayer?.team || yahooPlayer?.team || "",
          positions: fpPlayer.posDisplay,
          posDisplay: fpPlayer.posDisplay,
          fpRank,
          espnRank,
          yahooRank,
          consensusRank: consensus,
          status: "available",
        });
        inserted++;
      }
    }

    // Also update ESPN-only and Yahoo-only players that exist in our DB
    for (const [key, espnPlayer] of espn.entries()) {
      if (fp.has(key)) continue; // already handled above
      const existing = byName.get(key);
      if (existing) {
        const yahooPlayer = yahoo.get(key);
        const consensus = calcConsensus(existing.fpRank, espnPlayer.rank, yahooPlayer?.rank ?? existing.yahooRank, maxRank);
        await db.update(players)
          .set({ espnRank: espnPlayer.rank, yahooRank: yahooPlayer?.rank ?? existing.yahooRank, consensusRank: consensus, updatedAt: new Date() })
          .where(eq(players.id, existing.id));
        updated++;
      }
    }

    for (const [key, yahooPlayer] of yahoo.entries()) {
      if (fp.has(key) || espn.has(key)) continue; // already handled above
      const existing = byName.get(key);
      if (existing) {
        const consensus = calcConsensus(existing.fpRank, existing.espnRank, yahooPlayer.rank, maxRank);
        await db.update(players)
          .set({ yahooRank: yahooPlayer.rank, consensusRank: consensus, updatedAt: new Date() })
          .where(eq(players.id, existing.id));
        updated++;
      }
    }

    return { updated, inserted, total: updated + inserted };
  }
}

export const storage = new DatabaseStorage();
