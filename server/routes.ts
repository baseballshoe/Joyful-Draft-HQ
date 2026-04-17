import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import { parseFPBuffer, parseESPNBuffer, parseYahooBuffer, type ESPNParseResult } from "./import-service";
import * as yahoo from './yahoo';
import { yahooLeague } from '@shared/schema';
import { db } from './db';
import { eq } from 'drizzle-orm';

// Seed function to populate some initial players if empty
async function seedDatabase() {
  const playersData = await storage.getPlayers();
  if (playersData.length === 0) {
    console.log("Seeding database with default players...");
    
    // Some initial realistic mock data for draft HQ
    const initialPlayers = [
      { name: "Shohei Ohtani", team: "LAD", positions: "DH,SP", posDisplay: "DH", consensusRank: 1, fpRank: 1, espnRank: 1, yahooRank: 1 },
      { name: "Ronald Acuna Jr.", team: "ATL", positions: "OF", posDisplay: "OF", consensusRank: 2, fpRank: 2, espnRank: 2, yahooRank: 2 },
      { name: "Aaron Judge", team: "ATL", positions: "OF", posDisplay: "OF", consensusRank: 3, fpRank: 3, espnRank: 3, yahooRank: 3 },
      { name: "Bobby Witt Jr.", team: "NYY", positions: "OF", posDisplay: "OF", consensusRank: 4, fpRank: 4, espnRank: 4, yahooRank: 4 },
      { name: "Corbin Carroll", team: "KC", positions: "SS", posDisplay: "SS", consensusRank: 5, fpRank: 5, espnRank: 5, yahooRank: 5 },
      { name: "Spencer Strider", team: "ATL", positions: "SP", posDisplay: "SP", consensusRank: 6, fpRank: 6, espnRank: 6, yahooRank: 6 },
      { name: "Gerrit Cole", team: "NYY", positions: "SP", posDisplay: "SP", consensusRank: 7, fpRank: 8, espnRank: 7, yahooRank: 7 },
      { name: "Mookie Betts", team: "ARI", positions: "OF", posDisplay: "OF", consensusRank: 8, fpRank: 7, espnRank: 8, yahooRank: 8 },
      { name: "Juan Soto", team: "NYY", positions: "OF", posDisplay: "OF", consensusRank: 9, fpRank: 9, espnRank: 9, yahooRank: 9 },
      { name: "Kyle Tucker", team: "NYY", positions: "OF", posDisplay: "OF", consensusRank: 10, fpRank: 10, espnRank: 10, yahooRank: 10 },
      { name: "Adley Rutschman", team: "BAL", positions: "C", posDisplay: "C", consensusRank: 11, fpRank: 11, espnRank: 11, yahooRank: 11 },
      { name: "Will Smith", team: "LAD", positions: "C", posDisplay: "C", consensusRank: 35, fpRank: 35, espnRank: 35, yahooRank: 35 },
      { name: "Freddie Freeman", team: "LAD", positions: "1B", posDisplay: "1B", consensusRank: 12, fpRank: 12, espnRank: 12, yahooRank: 12 },
      { name: "Matt Olson", team: "HOU", positions: "OF", posDisplay: "OF", consensusRank: 13, fpRank: 13, espnRank: 13, yahooRank: 13 },
      { name: "Jose Ramirez", team: "HOU", positions: "3B", posDisplay: "3B", consensusRank: 14, fpRank: 14, espnRank: 14, yahooRank: 14 },
      { name: "Rafael Devers", team: "ATL", positions: "3B", posDisplay: "3B", consensusRank: 15, fpRank: 15, espnRank: 15, yahooRank: 15 },
      { name: "Zack Wheeler", team: "NYY", positions: "SP", posDisplay: "SP", consensusRank: 16, fpRank: 16, espnRank: 16, yahooRank: 16 },
      { name: "Trea Turner", team: "LAD", positions: "SS", posDisplay: "SS", consensusRank: 17, fpRank: 17, espnRank: 17, yahooRank: 17 },
      { name: "Pete Alonso", team: "ATL", positions: "1B", posDisplay: "1B", consensusRank: 18, fpRank: 18, espnRank: 18, yahooRank: 18 },
      { name: "Ozzie Albies", team: "ATL", positions: "2B", posDisplay: "2B", consensusRank: 19, fpRank: 19, espnRank: 19, yahooRank: 19 },
      { name: "Marcus Semien", team: "TEX", positions: "2B", posDisplay: "2B", consensusRank: 20, fpRank: 20, espnRank: 20, yahooRank: 20 },
    ];
    
    const { db } = await import('./db');
    const { players, roundStrategy } = await import('@shared/schema');
    
    // Insert players
    await db.insert(players).values(initialPlayers);
    
    // Seed default round strategy
    const defaultTiers = [
      'ELITE TIER','TIER 1','TIER 1-2','TIER 2','TIER 2-3',
      'TIER 3','TIER 3','TIER 3-4','TIER 4','SLEEPER RD',
      'DEPTH','DEPTH','DEPTH','DEPTH','DEPTH',
      'LOTTERY PICKS','LOTTERY PICKS','LOTTERY PICKS','LOTTERY PICKS','LOTTERY PICKS',
    ];
    
    const strategies = [];
    for (let r = 1; r <= 20; r++) {
      strategies.push({
        roundNum: r,
        picksRange: `${(r-1)*12+1}-${r*12}`,
        targetPositions: '',
        tier: defaultTiers[r-1] ?? 'DEPTH',
        targetNames: '',
        notes: ''
      });
    }
    
    await db.insert(roundStrategy).values(strategies);
    console.log("Database seeded successfully");
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Active session tracking — expires after 45 seconds of no heartbeat
const activeSessions = new Map<string, number>();
const SESSION_TTL_MS = 45_000;

function pruneExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, ts] of activeSessions) {
    if (ts < cutoff) activeSessions.delete(id);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Run seed then recalculate consensus (FP+ESPN avg, Yahoo excluded)
  seedDatabase()
    .then(() => storage.recalculateConsensusRanks())
    .catch(console.error);

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  function broadcast(message: any) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  wss.on("connection", (ws) => {
    // We don't necessarily need to handle incoming messages if all mutations are via REST,
    // but the template mentions websockets for real-time broadcast.
  });

  // Active users heartbeat
  app.post('/api/heartbeat', (req, res) => {
    const { sessionId } = req.body ?? {};
    if (sessionId && typeof sessionId === 'string') {
      activeSessions.set(sessionId, Date.now());
    }
    pruneExpiredSessions();
    res.json({ activeUsers: activeSessions.size });
  });

  app.get('/api/active-users', (req, res) => {
    pruneExpiredSessions();
    res.json({ activeUsers: activeSessions.size });
  });

  // Draft State
  app.get(api.draftState.get.path, async (req, res) => {
    const state = await storage.getDraftState();
    res.json(state);
  });

  app.patch(api.draftState.update.path, async (req, res) => {
    try {
      const input = api.draftState.update.input.parse(req.body);
      const updated = await storage.updateDraftState(input);
      broadcast({ type: 'draft_state', data: updated });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal Error" });
    }
  });

  // Players
  app.get(api.players.list.path, async (req, res) => {
    try {
      const queryParams = req.query as { status?: string; pos?: string; tag?: string; search?: string };
      const players = await storage.getPlayers(queryParams);
      res.json(players);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.get(api.players.get.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    
    const player = await storage.getPlayer(id);
    if (!player) return res.status(404).json({ message: "Not found" });
    res.json(player);
  });

  app.patch(api.players.update.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const input = api.players.update.input.parse(req.body);
      const updated = await storage.updatePlayer(id, input);
      broadcast({ type: 'player_updated', data: updated });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.post(api.players.reset.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const updated = await storage.resetPlayer(id);
      broadcast({ type: 'player_updated', data: updated });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  // Dashboard
  app.get(api.dashboard.get.path, async (req, res) => {
    try {
      const data = await storage.getDashboardData();
      res.json(data);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  // Round Strategy
  app.get(api.roundStrategy.list.path, async (req, res) => {
    try {
      const strategies = await storage.getRoundStrategies();
      res.json(strategies);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.patch(api.roundStrategy.update.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const input = api.roundStrategy.update.input.parse(req.body);
      const updated = await storage.updateRoundStrategy(id, input);
      broadcast({ type: 'round_strategy_updated', data: updated });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal Error" });
    }
  });

  // Cheat Sheet
  app.get(api.cheatSheet.list.path, async (req, res) => {
    try {
      const data = await storage.getCheatSheet();
      res.json(data);
    } catch (err) {
      res.status(500).json({ message: "Internal Error" });
    }
  });

  app.patch(api.cheatSheet.update.path, async (req, res) => {
    const section = req.params.section;
    try {
      const input = api.cheatSheet.update.input.parse(req.body);
      await storage.updateCheatSheet(section, input.content);
      broadcast({ type: 'cheat_sheet_updated', section, content: input.content });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal Error" });
    }
  });

  // Preview Import (diagnose without saving)
  app.post("/api/import/preview", upload.fields([
    { name: "fpFile", maxCount: 1 },
    { name: "espnFile", maxCount: 1 },
    { name: "yahooFile", maxCount: 1 },
  ]), async (req, res) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const espnBuffer  = files?.espnFile?.[0]?.buffer;
      const fpBuffer    = files?.fpFile?.[0]?.buffer;
      const yahooBuffer = files?.yahooFile?.[0]?.buffer;

      const result: Record<string, any> = {};

      if (espnBuffer) {
        // Also grab raw rows directly so we can see exactly what the file contains
        const XLSX2 = await import("xlsx");
        const wb2 = XLSX2.read(espnBuffer, { type: "buffer", raw: false });
        const ws2 = wb2.Sheets[wb2.SheetNames[0]];
        const rawRows = XLSX2.utils.sheet_to_json<Record<string, any>>(ws2, { defval: null }).slice(0, 20);

        const espnResult = parseESPNBuffer(espnBuffer);
        const rows = [...espnResult.map.entries()].map(([key, v]) => ({
          normalizedKey: key, name: v.name, rank: v.rank, team: v.team, pos: v.posDisplay,
        }));
        // Sort by rank asc so top-ranked are first, THEN slice top 30
        rows.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
        rows.splice(30);
        result.espn = {
          rankCol: espnResult.rankCol,
          rankColExists: espnResult.rankColExists,
          fileColumns: espnResult.fileColumns,
          totalParsed: espnResult.map.size,
          top30: rows,
          rawRows,   // first 20 raw rows straight from XLSX — shows exactly what ESPN sent
        };
      }

      if (fpBuffer) {
        const fpMap = parseFPBuffer(fpBuffer);
        const rows = [...fpMap.entries()].slice(0, 20).map(([key, v]) => ({
          normalizedKey: key, name: v.name, rank: v.rank, team: v.team,
        }));
        result.fp = { totalParsed: fpMap.size, top20: rows };
      }

      if (yahooBuffer) {
        const yahooMap = parseYahooBuffer(yahooBuffer);
        result.yahoo = { totalParsed: yahooMap.size };
      }

      res.json(result);
    } catch (err: any) {
      console.error("Preview error:", err);
      res.status(500).json({ message: err?.message ?? "Preview failed" });
    }
  });

  // Import Rankings
  app.post("/api/import", upload.fields([
    { name: "fpFile", maxCount: 1 },
    { name: "espnFile", maxCount: 1 },
    { name: "yahooFile", maxCount: 1 },
  ]), async (req, res) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;

      const fpBuffer   = files?.fpFile?.[0]?.buffer;
      const espnBuffer = files?.espnFile?.[0]?.buffer;
      const yahooBuffer = files?.yahooFile?.[0]?.buffer;

      if (!fpBuffer && !espnBuffer && !yahooBuffer) {
        return res.status(400).json({ message: "No files uploaded. Provide at least one ranking file." });
      }

      const fp         = fpBuffer    ? parseFPBuffer(fpBuffer)       : new Map();
      const espnResult = espnBuffer  ? parseESPNBuffer(espnBuffer)   : null;
      const espn       = espnResult  ? espnResult.map                : new Map();
      const yahoo      = yahooBuffer ? parseYahooBuffer(yahooBuffer) : new Map();

      console.log(`[Import] parsed rows — FP: ${fp.size}, ESPN: ${espn.size}, Yahoo: ${yahoo.size}`);

      const result = await storage.importRankings({ fp, espn, yahoo });

      broadcast({ type: 'rankings_imported', data: result });
      res.json({
        ok: true, ...result,
        parsed: { fp: fp.size, espn: espn.size, yahoo: yahoo.size },
        espnRankCol: espnResult ? (espnResult.rankColExists ? espnResult.rankCol : `ROW_INDEX (no "${espnResult.rankCol}" col — file cols: ${espnResult.fileColumns.slice(0,8).join(', ')})`) : null,
        unmatchedEspn: result.unmatched.espn,
      });
    } catch (err: any) {
      console.error("Import error:", err);
      res.status(500).json({ message: err?.message ?? "Import failed" });
    }
  });

  // ── Yahoo Auth: Step 1 — redirect user to Yahoo login ────────────────────
  app.get('/api/auth/yahoo', (_req, res) => {
    const authUrl = yahoo.getAuthUrl();
    res.redirect(authUrl);
  });

  // ── Yahoo Auth: Step 2 — handle callback from Yahoo ──────────────────────
  app.get('/api/auth/yahoo/callback', async (req, res) => {
    const { code, error } = req.query as Record<string, string>;

    if (error || !code) {
      return res.redirect('/?yahoo_error=access_denied');
    }

    try {
      await yahoo.exchangeCode(code);
      res.redirect('/?yahoo_connected=1');
    } catch (err: any) {
      console.error('Yahoo OAuth callback error:', err);
      res.redirect(`/?yahoo_error=${encodeURIComponent(err.message)}`);
    }
  });

  // ── Yahoo Auth: disconnect ────────────────────────────────────────────────
  app.delete('/api/auth/yahoo', async (_req, res) => {
    await yahoo.clearTokens();
    res.json({ ok: true });
  });

  // ── Yahoo: connection status ──────────────────────────────────────────────
  app.get('/api/yahoo/status', async (_req, res) => {
    try {
      const tokens = await yahoo.getTokens();
      if (!tokens) return res.json({ connected: false });

      const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));

      res.json({
        connected:    true,
        yahooGuid:    tokens.yahooGuid,
        expiresAt:    tokens.expiresAt,
        league:       leagueRow ?? null,
      });
    } catch {
      res.json({ connected: false });
    }
  });

  // ── Yahoo: get user's leagues ─────────────────────────────────────────────
  app.get('/api/yahoo/leagues', async (_req, res) => {
    try {
      const leagues = await yahoo.getLeagues();
      res.json(leagues);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Yahoo: select/save a league ───────────────────────────────────────────
  app.post('/api/yahoo/league', async (req, res) => {
    const { leagueKey, leagueId, name, season, numTeams, scoringType } = req.body;
    if (!leagueKey) return res.status(400).json({ message: 'leagueKey required' });

    try {
      const teams = await yahoo.getLeagueTeams(leagueKey);
      const myTeam = teams.find(t => t.isOwnedByCurrentLogin);

      await db
        .insert(yahooLeague)
        .values({
          id: 1, leagueKey, leagueId, name, season,
          numTeams, scoringType,
          myTeamKey:  myTeam?.teamKey  ?? null,
          myTeamName: myTeam?.name     ?? null,
        })
        .onConflictDoUpdate({
          target: yahooLeague.id,
          set: {
            leagueKey, leagueId, name, season,
            numTeams, scoringType,
            myTeamKey:  myTeam?.teamKey  ?? null,
            myTeamName: myTeam?.name     ?? null,
            updatedAt:  new Date(),
          },
        });

      broadcast({ type: 'yahoo_league_saved', data: { leagueKey, name } });
      res.json({ ok: true, myTeam: myTeam ?? null });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Yahoo: sync my roster → mark players as mine in DB ───────────────────
  app.post('/api/yahoo/sync-roster', async (_req, res) => {
    try {
      const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
      if (!leagueRow?.leagueKey) {
        return res.status(400).json({ message: 'No league selected. Please connect a league first.' });
      }

      // If myTeamKey wasn't captured during league selection, re-fetch teams now
      let myTeamKey = leagueRow.myTeamKey;
      if (!myTeamKey) {
        const teams = await yahoo.getLeagueTeams(leagueRow.leagueKey);
        const myTeam = teams.find(t => t.isOwnedByCurrentLogin);
        if (myTeam) {
          myTeamKey = myTeam.teamKey;
          await db.update(yahooLeague)
            .set({ myTeamKey: myTeam.teamKey, myTeamName: myTeam.name })
            .where(eq(yahooLeague.id, 1));
        }
      }

      if (!myTeamKey) {
        return res.status(400).json({ message: 'Could not find your team in this league. Try disconnecting and reconnecting.' });
      }

      const rosterPlayers = await yahoo.getMyRoster(myTeamKey);

      const allPlayers = await storage.getPlayers();

      // Normalize: strip accents (NFD decompose + drop combining marks), lowercase, strip non-alphanumeric
      const normalize = (s: string) =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

      // Step 1: record who was previously on 'my roster' so we can clear stale entries
      const prevMineIds = new Set(allPlayers.filter(p => p.status === 'mine').map(p => p.id));

      const results = { synced: 0, unmatched: [] as string[], removed: 0 };
      const newMineIds = new Set<number>();

      for (const yp of rosterPlayers) {
        const ynorm = normalize(yp.name);

        // Primary match: full accent-stripped name
        let match = allPlayers.find(p => normalize(p.name) === ynorm);

        // Fallback: last-name + first-initial match (handles suffix/Jr/III differences)
        if (!match) {
          const ylast = ynorm.split(' ').slice(-1)[0] ?? '';
          const yfirst = ynorm.split(' ')[0]?.[0] ?? '';
          if (ylast.length > 3) {
            match = allPlayers.find(p => {
              const pnorm = normalize(p.name);
              const plast = pnorm.split(' ').slice(-1)[0] ?? '';
              const pfirst = pnorm.split(' ')[0]?.[0] ?? '';
              return plast === ylast && pfirst === yfirst;
            });
          }
        }

        if (match) {
          await storage.updatePlayer(match.id, { status: 'mine' });
          newMineIds.add(match.id);
          results.synced++;
        } else {
          results.unmatched.push(yp.name);
        }
      }

      // Step 2: clear players who were on the roster but are no longer on Yahoo
      for (const id of prevMineIds) {
        if (!newMineIds.has(id)) {
          await storage.updatePlayer(id, { status: 'available' });
          results.removed++;
        }
      }

      await db
        .update(yahooLeague)
        .set({ lastSyncedAt: new Date() })
        .where(eq(yahooLeague.id, 1));

      broadcast({ type: 'yahoo_roster_synced', data: results });
      res.json(results);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Yahoo: get waiver wire ────────────────────────────────────────────────
  app.get('/api/yahoo/waiver-wire', async (req, res) => {
    try {
      const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
      if (!leagueRow?.leagueKey) {
        return res.status(400).json({ message: 'No league connected' });
      }

      const pos = (req.query.pos as string) || 'B';
      const players = await yahoo.getWaiverWire(leagueRow.leagueKey, pos, 25);
      res.json(players);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Yahoo: get standings ──────────────────────────────────────────────────
  app.get('/api/yahoo/standings', async (_req, res) => {
    try {
      const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
      if (!leagueRow?.leagueKey) {
        return res.status(400).json({ message: 'No league connected' });
      }

      const standings = await yahoo.getStandings(leagueRow.leagueKey);
      res.json(standings);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Yahoo: get scoreboard / matchups ─────────────────────────────────────
  app.get('/api/yahoo/scoreboard', async (_req, res) => {
    try {
      const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
      if (!leagueRow?.leagueKey) {
        return res.status(400).json({ message: 'No league connected' });
      }

      const scoreboard = await yahoo.getScoreboard(leagueRow.leagueKey);
      res.json(scoreboard);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  return httpServer;
}
