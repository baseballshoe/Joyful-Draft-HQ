/**
 * JOYT Import Service
 * -------------------
 * Parses uploaded ranking files and merges them into the database.
 *
 * FantasyPros CSV columns:  RK, PLAYER NAME (or NAME / PLAYER), TEAM, POS
 * ESPN XLSX/CSV columns:    Rank, Name (or Player), Team, Position, Auction Value
 * Yahoo XLSX/CSV columns:   Rank, Name, Team, Position
 *
 * All three parsers use flexible column-name detection with multi-candidate
 * fallbacks so minor header changes in exports don't break the import.
 *
 * normalizeName strips parentheticals before cleaning so names like
 * "Aaron Judge (DTD)" and "Shohei Ohtani (SP, DH)" match the DB correctly.
 */

import * as XLSX from "xlsx";

// ── Position normalisation ────────────────────────────────────────────────────
const POS_MAP: Record<string, string> = {
  OF: "OF", LF: "OF", CF: "OF", RF: "OF",
  DH: "DH", P: "P", UTIL: "UTIL",
};

const VALID_POS = new Set(["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP", "DH", "P", "UTIL"]);

function normalizePos(raw: string | null | undefined): string {
  if (!raw) return "UTIL";
  const primary = raw.trim().toUpperCase().split(/[,\/]/)[0].trim();
  const stripped = primary.replace(/\d+$/, "");
  const mapped = POS_MAP[stripped] ?? stripped;
  return VALID_POS.has(mapped) ? mapped : "UTIL";
}

/**
 * Canonical name key used for matching imports against the DB.
 * Steps:
 *  1. Strip parentheticals: "Aaron Judge (DTD)"  → "Aaron Judge"
 *  2. Lowercase + trim
 *  3. NFD Unicode decomposition → strip combining diacritics (é→e, á→a, etc.)
 *  4. Remove all remaining non-alphanumeric / non-space characters
 *  5. Collapse whitespace
 *  6. Apply nickname alias resolution
 */
function normalizeName(name: string): string {
  const raw = name
    .replace(/\s*\([^)]*\)/g, "")          // strip "(DTD)", "(SP, DH)", etc.
    .normalize("NFD")                        // decompose accented chars: é → e + ̀
    .replace(/[\u0300-\u036f]/g, "")        // strip combining diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]/g, "")            // remove dots, apostrophes, hyphens, etc.
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[raw] ?? raw;
}

/**
 * Nickname / alternate-name aliases.
 * Key   = what the external file (ESPN, Yahoo) may call the player
 * Value = how the player is stored in the DB (typically the FantasyPros name)
 *
 * Common sources of mismatch:
 *  - ESPN uses legal/full first names; FP uses nicknames
 *  - Different conventions for suffixes (Jr., II) or initials
 */
const NAME_ALIASES: Record<string, string> = {
  // Catchers
  "caleb raleigh":        "cal raleigh",

  // Pitchers / position players — add as discovered via import warnings
  "nicholas castellanos": "nick castellanos",
  "michael brosseau":     "mike brosseau",
  "michael yastrzemski":  "mike yastrzemski",
  "nathaniel lowe":       "nate lowe",
  "nathaniel eaton":      "nate eaton",
  "cameron rupp":         "cam rupp",
  "christopher morel":    "christopher morel",   // already matches; placeholder pattern
  "gilbert lara":         "gilbert lara",
};

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

// ── Robust CSV line splitter (handles quoted commas) ─────────────────────────
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { result.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

// ── FantasyPros CSV ───────────────────────────────────────────────────────────
export function parseFPBuffer(buffer: Buffer): Map<string, ParsedRankSource> {
  const text = buffer.toString("utf8");
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
  if (rawLines.length < 2) return new Map();

  // Scan first 5 rows to find the real header (skip FP metadata rows).
  let headerIdx = 0;
  let header: string[] = [];
  for (let i = 0; i < Math.min(rawLines.length, 5); i++) {
    const cols = splitCsvLine(rawLines[i]).map((h) => h.toLowerCase());
    const hasName = cols.some((h) => /player.*name|^name$|^player$/.test(h));
    if (hasName) { header = cols; headerIdx = i; break; }
  }
  if (header.length === 0) {
    console.warn("[FP import] could not locate header row — first cols:", splitCsvLine(rawLines[0]).slice(0, 6));
    return new Map();
  }

  const rkIdx   = header.findIndex((h) => /^rk$|^rank$|^overall$|^overall rank$|^#$/.test(h));
  const nameIdx = header.findIndex((h) => /player.*name|^name$|^player$/.test(h));
  const teamIdx = header.findIndex((h) => /^team$|^tm$/.test(h));
  const posIdx  = header.findIndex((h) => /^pos$|^position$|^eligible pos/.test(h));

  console.log(`[FP import] header row ${headerIdx}:`, header.slice(0, 8));
  console.log(`[FP import] col indices — rk:${rkIdx} name:${nameIdx} team:${teamIdx} pos:${posIdx}`);

  if (nameIdx === -1) {
    console.warn("[FP import] name column not found, aborting");
    return new Map();
  }

  const map = new Map<string, ParsedRankSource>();
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const cols = splitCsvLine(rawLines[i]);
    const rawName = cols[nameIdx];
    if (!rawName) continue;
    const rawRank = rkIdx !== -1 ? parseInt(cols[rkIdx]) : i - headerIdx;
    const pos = posIdx !== -1 ? cols[posIdx] : "";
    map.set(normalizeName(rawName), {
      name: rawName.trim(),
      rank: !isNaN(rawRank) ? rawRank : i - headerIdx,
      team: teamIdx !== -1 ? cols[teamIdx] : "",
      posDisplay: normalizePos(pos),
    });
  }
  console.log(`[FP import] parsed ${map.size} players`);
  return map;
}

// ── ESPN XLSX / CSV ───────────────────────────────────────────────────────────
// Uses the same flexible key-detection approach as the Yahoo parser so it
// works regardless of which exact column names ESPN uses in a given export.
export interface ESPNParseResult {
  map: Map<string, ParsedRankSource>;
  rankCol: string;
  rankColExists: boolean;
  fileColumns: string[];
}

export function parseESPNBuffer(buffer: Buffer): ESPNParseResult {
  const wb = XLSX.read(buffer, { type: "buffer", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });

  if (rows.length === 0) {
    console.warn("[ESPN import] file parsed to 0 rows");
    return { map: new Map(), rankCol: "—", rankColExists: false, fileColumns: [] };
  }

  const keys = Object.keys(rows[0]);

  // Case-insensitive exact-match lookup across multiple candidate names.
  const findKey = (...candidates: string[]): string => {
    for (const c of candidates) {
      const hit = keys.find((k) => k.toLowerCase().trim() === c.toLowerCase().trim());
      if (hit) return hit;
    }
    return candidates[0]; // fallback — will produce null values, logged below
  };

  const nameCol    = findKey("Name", "Player Name", "Player", "PLAYER", "player name", "name");
  const teamCol    = findKey("Team", "TEAM", "Team Abbrev", "Tm", "team");
  const posCol     = findKey("Position", "POS", "Pos", "Eligible Positions", "position", "pos");
  const auctionCol = findKey("Auction Value", "Value", "Auction $", "$ Value", "Auction", "auction value");

  /**
   * Determine whether a candidate column contains OVERALL rank values.
   * Position-rank columns have many duplicate small values (every position group
   * has its own #1, #2, …) so they fail this check.
   * Returns true if the column looks like a sequential 1-N overall rank.
   */
  function isOverallRankCol(colName: string): boolean {
    if (!keys.some(k => k.toLowerCase().trim() === colName.toLowerCase().trim())) return false;
    const sample = rows.slice(0, Math.min(rows.length, 60));
    const vals = sample.map(r => parseInt(r[colName])).filter(v => !isNaN(v));
    if (vals.length < 5) return false;
    const uniqueVals = new Set(vals);
    // A position-rank column will have many duplicates (e.g. many 1s, 2s, 3s).
    // An overall rank column should be almost entirely unique values.
    const uniqueRatio = uniqueVals.size / vals.length;
    // Also check: overall rank col should have values spanning a reasonable range.
    const maxVal = Math.max(...vals);
    const looksSequential = uniqueRatio > 0.85 && maxVal > 20;
    console.log(`[ESPN import] rank col candidate "${colName}": uniqueRatio=${uniqueRatio.toFixed(2)}, max=${maxVal}, looksSequential=${looksSequential}`);
    return looksSequential;
  }

  // Try overall-rank-specific column names first (unambiguous), then fall through
  // to ambiguous names like "Rank" only if they pass the duplicate-check.
  // NOTE: "Rank" alone is often POSITION rank in ESPN exports (Cal Raleigh = C#1 = rank 1).
  //       We test it with isOverallRankCol() and fall back to row-index if it fails.
  const OVERALL_PRIORITY = ["Overall Rank", "OVR", "Overall", "PROJ RK", "Projected Rank", "PRK", "Proj Rk"];
  const AMBIGUOUS        = ["Rank", "RK", "Rk", "rank"];

  let rankCol      = "";
  let rankColExists = false;

  for (const candidate of OVERALL_PRIORITY) {
    if (isOverallRankCol(candidate)) {
      rankCol = findKey(candidate);
      rankColExists = true;
      console.log(`[ESPN import] using unambiguous overall-rank column: "${rankCol}"`);
      break;
    }
  }

  if (!rankColExists) {
    for (const candidate of AMBIGUOUS) {
      if (isOverallRankCol(candidate)) {
        rankCol = findKey(candidate);
        rankColExists = true;
        console.log(`[ESPN import] using ambiguous column "${rankCol}" — passed duplicate check`);
        break;
      }
    }
  }

  if (!rankColExists) {
    // All named columns failed the overall-rank check (likely all are position ranks).
    // Fall back to row-index ordering — ESPN files are sorted by overall rank.
    rankCol = OVERALL_PRIORITY[0]; // for display purposes only
    console.warn(`[ESPN import] no valid overall-rank column found — using row-index ordering. File columns: ${keys.join(", ")}`);
  }

  console.log("[ESPN import] detected columns →", { rankCol, rankColExists, nameCol, teamCol, posCol, auctionCol });
  console.log("[ESPN import] sample row →", rows[0]);

  const map = new Map<string, ParsedRankSource>();
  let rowIdx = 0;
  for (const row of rows) {
    rowIdx++;
    const rawName = row[nameCol];
    if (!rawName) continue;
    const name    = rawName.toString().trim();
    const parsedRank = parseInt(row[rankCol]);
    // If the rank column doesn't exist or its value isn't numeric, fall back to row position.
    const rank = rankColExists && !isNaN(parsedRank) ? parsedRank : (rankColExists ? null : rowIdx);
    const pos     = (row[posCol]  ?? "").toString().trim();
    const auction = parseFloat(row[auctionCol]);
    map.set(normalizeName(name), {
      name,
      rank,
      team: (row[teamCol] ?? "").toString().trim(),
      posDisplay: normalizePos(pos),
      auctionValue: !isNaN(auction) ? auction : null,
    });
  }
  console.log(`[ESPN import] parsed ${map.size} players`);
  return { map, rankCol, rankColExists, fileColumns: keys };
}

// ── Yahoo XLSX / CSV ──────────────────────────────────────────────────────────
export function parseYahooBuffer(buffer: Buffer): Map<string, ParsedRankSource> {
  const wb = XLSX.read(buffer, { type: "buffer", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: null });

  if (rows.length === 0) {
    console.warn("[Yahoo import] file parsed to 0 rows");
    return new Map();
  }

  const keys = Object.keys(rows[0]);

  const findKey = (...candidates: string[]): string => {
    for (const c of candidates) {
      const hit = keys.find((k) => k.toLowerCase().trim() === c.toLowerCase().trim());
      if (hit) return hit;
    }
    return candidates[0];
  };

  const rankCol = findKey("Rank", "Overall Rank", "Rank #", "#", "ADP", "Rk", "rk");
  const nameCol = findKey("Name", "Player Name", "Player", "Full Name", "PLAYER", "Player Name (Team/Bye)");
  const teamCol = findKey("Team", "Team Abbrev", "Team Name", "NFL Team", "TEAM", "Team(s)");
  const posCol  = findKey("Position", "Eligible Positions", "Pos", "Primary Position", "POS", "Type");

  console.log("[Yahoo import] detected columns →", { rankCol, nameCol, teamCol, posCol });
  console.log("[Yahoo import] sample row →", rows[0]);

  const map = new Map<string, ParsedRankSource>();
  for (const row of rows) {
    const rawName = row[nameCol];
    if (!rawName) continue;
    const name    = rawName.toString().trim();
    const rank    = parseInt(row[rankCol]);
    const pos     = (row[posCol]  ?? "").toString().trim();
    const team    = (row[teamCol] ?? "").toString().trim();
    const rankVal = !isNaN(rank) ? rank : null;
    const key     = normalizeName(name);
    const existing = map.get(key);
    // Keep best (lowest) rank when a player appears more than once
    if (!existing || (rankVal !== null && (existing.rank === null || rankVal < existing.rank))) {
      map.set(key, { name, rank: rankVal, team, posDisplay: normalizePos(pos) });
    }
  }
  console.log(`[Yahoo import] parsed ${map.size} players`);
  return map;
}

// ── Consensus rank calculation ────────────────────────────────────────────────
// FP and ESPN weighted equally (50/50). Yahoo is stored for reference only
// and does NOT factor into the consensus or #RNK calculation.
export function calcConsensus(
  fpRank: number | null,
  espnRank: number | null,
  _yahooRank: number | null,
  _maxRank = 300
): number {
  const hasFP   = fpRank   != null;
  const hasESPN = espnRank != null;
  if (!hasFP && !hasESPN) return 9999;
  if (hasFP && hasESPN) return Math.round((fpRank! + espnRank!) / 2);
  return hasFP ? fpRank! : espnRank!;
}

export { normalizeName };
