/**
 * JOYT Import Service
 * -------------------
 * Parses uploaded ranking files and merges them into the database.
 *
 * FantasyPros CSV columns:  RK, PLAYER NAME (or NAME), TEAM, POS
 * ESPN XLSX columns:        Rank, Name, Team, Position, Auction Value
 * Yahoo XLSX columns:       Rank, Name, Team, Position
 */

import * as XLSX from "xlsx";

// Position normalisation map
const POS_MAP: Record<string, string> = {
  OF: "OF", LF: "OF", CF: "OF", RF: "OF",
  DH: "DH", P: "P", UTIL: "UTIL",
};

const VALID_POS = new Set(["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP", "DH", "P", "UTIL"]);

function normalizePos(raw: string | null | undefined): string {
  if (!raw) return "UTIL";
  // Take the primary position (before any slash or comma)
  const primary = raw.trim().toUpperCase().split(/[,\/]/)[0].trim();
  // Strip trailing digits: "1B73" → "1B", "OF199" → "OF", "SP124" → "SP"
  const stripped = primary.replace(/\d+$/, "");
  const mapped = POS_MAP[stripped] ?? stripped;
  return VALID_POS.has(mapped) ? mapped : "UTIL";
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

export interface ParsedRankSource {
  name: string;
  rank: number | null;
  team: string;
  posDisplay: string;
  auctionValue?: number | null;
}

export interface ParsedImportData {
  fp: Map<string, ParsedRankSource>;
  espn: Map<string, ParsedRankSource>;
  yahoo: Map<string, ParsedRankSource>;
}

// ── FantasyPros CSV ──────────────────────────────────────────────────────────
export function parseFPBuffer(buffer: Buffer): Map<string, ParsedRankSource> {
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();

  const header = lines[0].split(",").map((h) => h.trim().replace(/"/g, "").toLowerCase());
  const rkIdx   = header.findIndex((h) => /^rk$|^rank$/.test(h));
  const nameIdx = header.findIndex((h) => /player.*name|^name$/.test(h));
  const teamIdx = header.findIndex((h) => /^team$/.test(h));
  const posIdx  = header.findIndex((h) => /^pos$|^position$/.test(h));

  if (nameIdx === -1) return new Map();

  const map = new Map<string, ParsedRankSource>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/"/g, ""));
    const rawName = cols[nameIdx];
    if (!rawName) continue;
    const rank = rkIdx !== -1 ? parseInt(cols[rkIdx]) : null;
    const pos = posIdx !== -1 ? cols[posIdx] : "";
    map.set(normalizeName(rawName), {
      name: rawName.trim(),
      rank: rank && !isNaN(rank) ? rank : null,
      team: teamIdx !== -1 ? cols[teamIdx] : "",
      posDisplay: normalizePos(pos),
    });
  }
  return map;
}

// ── Generic XLSX parser ──────────────────────────────────────────────────────
function parseXLSXBuffer(
  buffer: Buffer,
  rankCol: string,
  nameCol: string,
  teamCol: string,
  posCol: string,
  auctionCol?: string
): Map<string, ParsedRankSource> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });
  const map = new Map<string, ParsedRankSource>();
  for (const row of rows) {
    const rawName = row[nameCol];
    if (!rawName) continue;
    const name = rawName.toString().trim();
    const rank = parseInt(row[rankCol]);
    const pos = (row[posCol] ?? "").toString().trim();
    const auction = auctionCol ? parseFloat(row[auctionCol]) : undefined;
    map.set(normalizeName(name), {
      name,
      rank: !isNaN(rank) ? rank : null,
      team: (row[teamCol] ?? "").toString().trim(),
      posDisplay: normalizePos(pos),
      auctionValue: auction && !isNaN(auction) ? auction : null,
    });
  }
  return map;
}

export function parseESPNBuffer(buffer: Buffer): Map<string, ParsedRankSource> {
  return parseXLSXBuffer(buffer, "Rank", "Name", "Team", "Position", "Auction Value");
}

export function parseYahooBuffer(buffer: Buffer): Map<string, ParsedRankSource> {
  return parseXLSXBuffer(buffer, "Rank", "Name", "Team", "Position");
}

// ── Consensus rank calculation ───────────────────────────────────────────────
// Uses renormalized weights — missing sources are dropped rather than penalised.
// Weights: FP 40%, ESPN 35%, Yahoo 25%
export function calcConsensus(
  fpRank: number | null,
  espnRank: number | null,
  yahooRank: number | null,
  _maxRank = 300  // kept for API compat, no longer used
): number {
  const hasFP    = fpRank    != null;
  const hasESPN  = espnRank  != null;
  const hasYahoo = yahooRank != null;

  const totalWeight = (hasFP ? 0.40 : 0) + (hasESPN ? 0.35 : 0) + (hasYahoo ? 0.25 : 0);
  if (totalWeight === 0) return 9999;

  const weighted =
    (hasFP    ? fpRank!    * 0.40 : 0) +
    (hasESPN  ? espnRank!  * 0.35 : 0) +
    (hasYahoo ? yahooRank! * 0.25 : 0);

  return Math.round(weighted / totalWeight);
}

export { normalizeName };
