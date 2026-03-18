import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import { parseFPBuffer, parseESPNBuffer, parseYahooBuffer, type ESPNParseResult } from "./import-service";

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

  return httpServer;
}
