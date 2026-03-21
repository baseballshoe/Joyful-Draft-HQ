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

  // TEMPORARY one-shot fix — apply correct ESPN overall ranks to production DB
  app.post("/api/admin/fix-espn-ranks-2025", async (_req, res) => {
    try {
      const ESPN_DATA: [string, number][] = [["Shohei Ohtani",1],["Aaron Judge",2],["Bobby Witt Jr.",3],["Jose Ramirez",4],["Juan Soto",5],["Corbin Carroll",6],["Ronald Acuna Jr.",7],["Elly De La Cruz",8],["Julio Rodriguez",9],["Tarik Skubal",10],["Paul Skenes",11],["Garrett Crochet",12],["Fernando Tatis Jr.",13],["Francisco Lindor",14],["Kyle Tucker",15],["Gunnar Henderson",16],["Jackson Chourio",17],["Trea Turner",18],["Junior Caminero",19],["Kyle Schwarber",20],["Nick Kurtz",21],["Yoshinobu Yamamoto",22],["Cristopher Sanchez",23],["Vladimir Guerrero Jr.",24],["Hunter Brown",25],["Jazz Chisholm Jr.",26],["Pete Alonso",27],["Manny Machado",28],["Cal Raleigh",29],["Yordan Alvarez",30],["Matt Olson",31],["Bryce Harper",32],["Roman Anthony",33],["Rafael Devers",34],["James Wood",35],["Ketel Marte",36],["Chris Sale",37],["Jacob deGrom",38],["Logan Webb",39],["Logan Gilbert",40],["Bryan Woo",41],["Zach Neto",42],["Freddie Freeman",43],["Brent Rooker",44],["Cole Ragans",45],["Max Fried",46],["Freddy Peralta",47],["Mookie Betts",48],["Jackson Merrill",49],["Vinnie Pasquantino",50],["Mason Miller",51],["CJ Abrams",52],["Edwin Diaz",53],["Pete Crow-Armstrong",54],["Andres Munoz",55],["Jhoan Duran",56],["Jarren Duran",57],["Josh Naylor",58],["Joe Ryan",59],["George Kirby",60],["Framber Valdez",61],["Byron Buxton",62],["Geraldo Perdomo",63],["Dylan Cease",64],["William Contreras",65],["Cody Bellinger",66],["Brice Turang",67],["Cade Smith",68],["Wyatt Langford",69],["Alex Bregman",70],["Bo Bichette",71],["Austin Riley",72],["Jeremy Pena",73],["Christian Yelich",74],["Maikel Garcia",75],["Trevor Story",76],["Randy Arozarena",77],["Riley Greene",78],["Nico Hoerner",79],["Aroldis Chapman",80],["David Bednar",81],["Jesus Luzardo",82],["Tyler Soderstrom",83],["Seiya Suzuki",84],["Corey Seager",85],["Hunter Goodman",86],["Michael Busch",87],["Shea Langeliers",88],["Yandy Diaz",89],["Nick Pivetta",90],["George Springer",91],["Will Smith",92],["Zack Wheeler",93],["Agustin Ramirez",94],["Konnor Griffin",95],["Ben Rice",96],["Drake Baldwin",97],["Salvador Perez",98],["Eury Perez",99],["Spencer Strider",100],["Kevin Gausman",101],["Oneil Cruz",102],["Kyle Bradish",103],["Matt Chapman",104],["Kyle Stowers",105],["Jose Altuve",106],["Dansby Swanson",107],["Eugenio Suarez",108],["Devin Williams",109],["Michael Harris II",110],["Willy Adames",111],["Raisel Iglesias",112],["Carlos Estevez",113],["Jackson Holliday",114],["Emilio Pagan",115],["Trevor Megill",116],["Bryan Abreu",117],["Jacob Misiorowski",118],["Robert Suarez",119],["Jason Adam",120],["Nolan McLean",121],["Ryan Helsley",122],["Jeff Hoffman",123],["Kenley Jansen",124],["Brandon Woodruff",125],["Chase Burns",126],["Nathan Eovaldi",127],["Drew Rasmussen",128],["Michael King",129],["Pete Fairbanks",130],["Daniel Palencia",131],["Sonny Gray",132],["Jacob Wilson",133],["Luis Robert Jr.",134],["Luke Keaschall",135],["Teoscar Hernandez",136],["Mike Trout",137],["Andy Pages",138],["Lawrence Butler",139],["Brandon Nimmo",140],["Josh Hader",141],["Shota Imanaga",142],["Tyler Glasnow",143],["Brenton Doyle",144],["Ceddanne Rafaela",145],["Luis Castillo",146],["Gavin Williams",147],["Blake Snell",148],["Matthew Boyd",149],["Aaron Nola",150],["Brandon Lowe",151],["Nick Lodolo",152],["Trevor Rogers",153],["Chandler Simpson",154],["Cam Schlittler",155],["Heliot Ramos",156],["Ryan Pepiot",157],["Steven Kwan",158],["Sandy Alcantara",159],["Carlos Rodon",160],["Colson Montgomery",161],["Xavier Edwards",162],["Marcus Semien",163],["Spencer Torkelson",164],["Jo Adell",165],["Taylor Ward",166],["Sal Frelick",167],["Willson Contreras",168],["Christian Walker",169],["Ranger Suarez",170],["Cade Horton",171],["Robbie Ray",172],["Dennis Santana",173],["Emmet Sheehan",174],["Adrian Morejon",175],["Jeremiah Estrada",176],["Alejandro Kirk",177],["Tatsuya Imai",178],["Yainer Diaz",179],["Gerrit Cole",180],["Abner Uribe",181],["Kazuma Okamoto",182],["Munetaka Murakami",183],["Tanner Bibee",184],["Dylan Crews",185],["Jakob Marsee",186],["Tyler Rogers",187],["Roki Sasaki",188],["Sal Stewart",189],["Jordan Westburg",190],["Bryson Stott",191],["Luis Garcia Jr.",192],["Ozzie Albies",193],["Jose Caballero",194],["Alec Burleson",195],["MacKenzie Gore",196],["Trey Yesavage",197],["Luis Arraez",198],["Masyn Winn",199],["Jonathan Aranda",200],["Anthony Volpe",201],["Brendan Donovan",202],["Xander Bogaerts",203],["Gleyber Torres",204],["Bubba Chandler",205],["Addison Barger",206],["Jorge Polanco",207],["Shane Baz",208],["Kevin McGonigle",209],["JJ Wetherholt",210],["Andrew Abbott",211],["Bryce Miller",212],["Bryan Reynolds",213],["Ivan Herrera",214],["Isaac Paredes",215],["Kyle Manzardo",216],["Ezequiel Tovar",217],["Rhys Hoskins",218],["Zac Gallen",219],["Jac Caglianone",220],["Willi Castro",221],["Daylen Lile",222],["Kerry Carpenter",223],["Spencer Steer",224],["Merrill Kelly",225],["Trent Grisham",226],["Ian Happ",227],["Noelvi Marte",228],["Alec Bohm",229],["Zach McKinstry",230],["Caleb Durbin",231],["Adley Rutschman",232],["Samuel Basallo",233],["Ernie Clement",234],["Ryan O'Hearn",235],["Ryan Walker",236],["Kris Bubic",237],["Brad Keller",238],["Carter Jensen",239],["Louis Varland",240],["Griffin Jax",241],["Kyle Teel",242],["Seranthony Dominguez",243],["Dillon Dingler",244],["Jack Flaherty",245],["Jordan Lawlar",246],["Otto Lopez",247],["Shane Bieber",248],["Matt McLain",249],["Joe Musgrove",250],["Noah Cameron",251],["Jake Cronenworth",252],["Brett Baty",253],["Edward Cabrera",254],["J.T. Realmuto",255],["Jose Berrios",256],["Alex Vesia",257],["Parker Messick",258],["Bryce Eldridge",259],["Moises Ballesteros",260],["Starling Marte",261],["Casey Mize",262],["Spencer Schwellenbach",263],["Connelly Early",264],["Shane Smith",265],["Mark Vientos",266],["Max Muncy",267],["Hunter Gaddis",268],["Carlos Correa",269],["Adolis Garcia",270],["Royce Lewis",271],["Daulton Varsho",272],["Austin Wells",273],["Hunter Greene",274],["Carson Kelly",275],["Ryne Nelson",276],["Tony Santillan",277],["Luke Weaver",278],["Riley O'Brien",279],["Will Vest",280],["Robert Stephenson",281],["Lucas Erceg",282],["Shane McClanahan",283],["Lenyn Sosa",284],["Kyle Finnegan",285],["Masataka Yoshida",286],["Camilo Doval",287],["Giancarlo Stanton",288],["Bryan King",289],["Gavin Sheets",290],["Yusei Kikuchi",291],["Harrison Bader",292],["Jung Hoo Lee",293],["Jordan Beck",294],["Ryan Waldschmidt",295],["Evan Carter",296],["Quinn Priester",297],["Kodai Senga",298],["Matt Shaw",299],["Ryan Weathers",300]];

      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      const espnMap = new Map<string, number>(ESPN_DATA.map(([n, r]) => [norm(n), r]));

      const { db } = await import("./db");
      const { players } = await import("@shared/schema");
      const { sql: drizzleSql } = await import("drizzle-orm");

      const allPlayers = await db.select({ id: players.id, name: players.name, espnRank: players.espnRank, fpRank: players.fpRank }).from(players);

      let updated = 0, nulled = 0, unchanged = 0;
      for (const p of allPlayers) {
        const key = norm(p.name);
        const fileRank = espnMap.get(key) ?? null;
        if (fileRank !== null && fileRank !== p.espnRank) {
          const consensus = p.fpRank != null ? Math.round((p.fpRank + fileRank) / 2) : fileRank;
          await db.execute(drizzleSql`UPDATE players SET espn_rank = ${fileRank}, consensus_rank = ${consensus}, updated_at = NOW() WHERE id = ${p.id}`);
          updated++;
        } else if (fileRank === null && p.espnRank !== null) {
          const consensus = p.fpRank ?? null;
          await db.execute(drizzleSql`UPDATE players SET espn_rank = NULL, consensus_rank = ${consensus}, updated_at = NOW() WHERE id = ${p.id}`);
          nulled++;
        } else {
          unchanged++;
        }
      }

      res.json({ ok: true, updated, nulled, unchanged });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  return httpServer;
}
