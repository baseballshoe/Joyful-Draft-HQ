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

// ── Roster slot assignment ──────────────────────────────────────────────────
const SLOT_LIMITS: Record<string, number> = {
  C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 4,
  Util: 1, SP: 4, RP: 2, P: 3, BN: 5,
};
const HITTER_POS = new Set(['C', '1B', '2B', '3B', 'SS', 'OF', 'DH']);
const PITCHER_POS = new Set(['SP', 'RP', 'P']);

function computeRosterSlot(posDisplay: string, currentSlots: string[]): string {
  const counts: Record<string, number> = {};
  currentSlots.forEach((s) => { counts[s] = (counts[s] ?? 0) + 1; });
  const avail = (slot: string) => (counts[slot] ?? 0) < (SLOT_LIMITS[slot] ?? 0);

  // 1. Primary position slots
  if (posDisplay === 'C'  && avail('C'))  return 'C';
  if (posDisplay === '1B' && avail('1B')) return '1B';
  if (posDisplay === '2B' && avail('2B')) return '2B';
  if (posDisplay === '3B' && avail('3B')) return '3B';
  if (posDisplay === 'SS' && avail('SS')) return 'SS';
  if (posDisplay === 'OF' && avail('OF')) return 'OF';
  if (posDisplay === 'SP' && avail('SP')) return 'SP';
  if (posDisplay === 'RP' && avail('RP')) return 'RP';

  // 2. SP/RP overflow → P slot
  if ((posDisplay === 'SP' || posDisplay === 'RP') && avail('P')) return 'P';

  // 3. Hitters (including DH) → Util
  if (HITTER_POS.has(posDisplay) && avail('Util')) return 'Util';

  // 4. Any remaining pitchers → P overflow
  if (PITCHER_POS.has(posDisplay) && avail('P')) return 'P';

  // 5. Bench
  return 'BN';
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
  recalculateConsensusRanks(): Promise<void>;

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

    const results = await query.orderBy(
      sql`${players.consensusRank} ASC NULLS LAST, ${players.fpRank} ASC NULLS LAST, ${players.espnRank} ASC NULLS LAST, ${players.id} ASC`
    );
    return results.map(enrichPlayer);
  }

  async getPlayer(id: number): Promise<EnrichedPlayer | undefined> {
    const [p] = await db.select().from(players).where(eq(players.id, id));
    if (!p) return undefined;
    return enrichPlayer(p);
  }

  async updatePlayer(id: number, updates: UpdatePlayerRequest): Promise<EnrichedPlayer> {
    let finalUpdates: UpdatePlayerRequest & { rosterSlot?: string | null } = { ...updates };

    if (updates.status === 'mine') {
      // Get current roster slots (excluding this player)
      const roster = await db.select({ rosterSlot: players.rosterSlot })
        .from(players)
        .where(and(eq(players.status, 'mine'), sql`${players.id} != ${id}`));
      const currentSlots = roster.map((r) => r.rosterSlot).filter(Boolean) as string[];

      // Get this player's posDisplay
      const [current] = await db.select({ posDisplay: players.posDisplay }).from(players).where(eq(players.id, id));
      if (current) {
        finalUpdates.rosterSlot = computeRosterSlot(current.posDisplay, currentSlots);
      }
    } else if (updates.status && updates.status !== 'mine') {
      finalUpdates.rosterSlot = null;
    }

    const [updated] = await db.update(players)
      .set({ ...finalUpdates, updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning();
    return enrichPlayer(updated);
  }

  async resetPlayer(id: number): Promise<EnrichedPlayer> {
    const [updated] = await db.update(players)
      .set({ status: 'available', rosterSlot: null, myRank: null, myPosRank: null, roundOverride: null, tags: '', notes: '', updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning();
    return enrichPlayer(updated);
  }

  async getDashboardData(): Promise<DashboardData> {
    const state = await this.getDraftState();
    const mode = state.rankMode ?? 'priority';

    const [{ count: draftedCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(players)
      .where(sql`${players.status} != 'available'`);
    const totalDrafted = draftedCount ?? 0;
    const dynamicRound = Math.max(1, Math.ceil(totalDrafted / 12));
    const round = dynamicRound;

    // We can fetch everything directly or do multiple queries. Let's do multiple simple queries.
    const myRosterRaw = await db.select().from(players).where(eq(players.status, 'mine')).orderBy(asc(players.updatedAt));
    const myRoster = myRosterRaw.map(enrichPlayer);

    const orderByMode = mode === 'consensus'
      ? sql`${players.consensusRank} ASC NULLS LAST, ${players.fpRank} ASC NULLS LAST, ${players.espnRank} ASC NULLS LAST, ${players.id} ASC`
      : sql`COALESCE(${players.myRank}, ${players.consensusRank}) ASC NULLS LAST, ${players.fpRank} ASC NULLS LAST, ${players.espnRank} ASC NULLS LAST, ${players.id} ASC`;

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

    // Bulk-fetch all 20 rounds in 2 queries instead of 40
    const allForcedRaw = await db.select().from(players)
      .where(and(
        eq(players.status, 'available'),
        sql`${players.roundOverride} >= 1`,
        sql`${players.roundOverride} <= 20`
      ))
      .orderBy(orderByMode);
    const allForced = allForcedRaw.map(enrichPlayer);

    const allNaturalRaw = await db.select().from(players)
      .where(and(
        eq(players.status, 'available'),
        sql`${players.roundOverride} IS NULL`,
        sql`COALESCE(${players.myRank}, ${players.consensusRank}) >= 1`,
        sql`COALESCE(${players.myRank}, ${players.consensusRank}) <= 240`
      ))
      .orderBy(orderByMode)
      .limit(240);
    const allNatural = allNaturalRaw.map(enrichPlayer);

    const roundData: Record<number, EnrichedPlayer[]> = {};
    for (let r = 1; r <= 20; r++) {
      const pickStart = (r - 1) * 12 + 1;
      const pickEnd = r * 12;
      const forced = allForced.filter(p => p.roundOverride === r);
      const needed = Math.max(0, 12 - forced.length);
      const natural = allNatural
        .filter(p => p.priorityRank >= pickStart && p.priorityRank <= pickEnd)
        .slice(0, needed);
      const all = [...forced, ...natural].sort((a, b) => a.priorityRank - b.priorityRank);
      roundData[r] = all.slice(0, 12);
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
      nextBest: nextBestRaw ? enrichPlayer(nextBestRaw) : null,
      totalDrafted,
      dynamicRound,
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

    // Track which sources actually had data so we never null-out
    // ranks for a source that wasn't uploaded in this batch.
    const hasFP    = fp.size > 0;
    const hasESPN  = espn.size > 0;
    const hasYahoo = yahoo.size > 0;

    const maxRank = fp.size || espn.size || 300;

    // Load all existing players
    const existingRows = await db.select().from(players);
    const byName = new Map<string, Player>();
    for (const p of existingRows) {
      byName.set(normalizeName(p.name), p);
    }

    console.log(`[Import] DB has ${existingRows.length} players. Sources: FP=${fp.size} ESPN=${espn.size} Yahoo=${yahoo.size}`);

    let updated = 0;
    let inserted = 0;

    // Process every player from the FP list (master source)
    for (const [key, fpPlayer] of fp.entries()) {
      const espnPlayer  = espn.get(key);
      const yahooPlayer = yahoo.get(key);
      const existing    = byName.get(key);

      const newFpRank    = fpPlayer.rank;
      // Only overwrite ESPN/Yahoo if that source was actually uploaded;
      // otherwise keep whatever is already in the DB for that player.
      const newEspnRank  = hasESPN  ? (espnPlayer?.rank ?? null)  : (existing?.espnRank  ?? null);
      const newYahooRank = hasYahoo ? (yahooPlayer?.rank ?? null) : (existing?.yahooRank ?? null);
      const consensus    = calcConsensus(newFpRank, newEspnRank, newYahooRank, maxRank);

      if (existing) {
        await db.update(players)
          .set({
            fpRank:       newFpRank,
            espnRank:     newEspnRank,
            yahooRank:    newYahooRank,
            consensusRank: consensus,
            team:         fpPlayer.team || existing.team,
            posDisplay:   fpPlayer.posDisplay !== "UTIL" ? fpPlayer.posDisplay : existing.posDisplay,
            updatedAt:    new Date(),
          })
          .where(eq(players.id, existing.id));
        updated++;
      } else {
        await db.insert(players).values({
          name:          fpPlayer.name,
          team:          fpPlayer.team || espnPlayer?.team || yahooPlayer?.team || "",
          positions:     fpPlayer.posDisplay,
          posDisplay:    fpPlayer.posDisplay,
          fpRank:        newFpRank,
          espnRank:      newEspnRank,
          yahooRank:     newYahooRank,
          consensusRank: consensus,
          status:        "available",
        });
        inserted++;
      }
    }

    // Also update ESPN-only players that exist in our DB
    if (hasESPN) {
      for (const [key, espnPlayer] of espn.entries()) {
        if (fp.has(key)) continue; // already handled above
        const existing = byName.get(key);
        if (existing) {
          const yahooPlayer  = yahoo.get(key);
          const newYahooRank = hasYahoo ? (yahooPlayer?.rank ?? null) : existing.yahooRank;
          const consensus    = calcConsensus(existing.fpRank, espnPlayer.rank, newYahooRank, maxRank);
          await db.update(players)
            .set({ espnRank: espnPlayer.rank, yahooRank: newYahooRank, consensusRank: consensus, updatedAt: new Date() })
            .where(eq(players.id, existing.id));
          updated++;
        }
      }
    }

    // Also update Yahoo-only players that exist in our DB
    if (hasYahoo) {
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
    }

    console.log(`[Import] done — updated: ${updated}, inserted: ${inserted}`);
    await this.uniquifyConsensusRanks();
    return { updated, inserted, total: updated + inserted };
  }

  async recalculateConsensusRanks(): Promise<void> {
    // Recompute consensus = avg(fpRank, espnRank) — Yahoo is excluded
    await db.execute(sql`
      UPDATE players
      SET consensus_rank = CASE
        WHEN fp_rank IS NOT NULL AND espn_rank IS NOT NULL
          THEN ROUND((fp_rank::numeric + espn_rank::numeric) / 2)
        WHEN fp_rank IS NOT NULL  THEN fp_rank
        WHEN espn_rank IS NOT NULL THEN espn_rank
        ELSE 9999
      END
    `);
    await this.uniquifyConsensusRanks();
  }

  private async uniquifyConsensusRanks(): Promise<void> {
    await db.execute(sql`
      UPDATE players
      SET consensus_rank = ranks.new_rank
      FROM (
        SELECT id, ROW_NUMBER() OVER (
          ORDER BY
            consensus_rank ASC NULLS LAST,
            espn_rank ASC NULLS LAST,
            fp_rank ASC NULLS LAST,
            id ASC
        ) AS new_rank
        FROM players
        WHERE consensus_rank IS NOT NULL AND consensus_rank < 9000
      ) AS ranks
      WHERE players.id = ranks.id
    `);
  }
}

export const storage = new DatabaseStorage();
