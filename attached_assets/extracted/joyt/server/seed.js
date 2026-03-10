/**
 * JOYT Seed Script
 * ----------------
 * Reads the three ranking sources and populates the players table.
 *
 * Usage:  node server/seed.js
 *
 * Expected files (place in /data/):
 *   data/FantasyPros_2026_Draft_ALL_Rankings.csv
 *   data/espn_top300.xlsx
 *   data/yahoo_rankings.xlsx
 *
 * Column mappings assumed:
 *   FantasyPros CSV:  RK, PLAYER NAME, TEAM, POS
 *   ESPN xlsx:        Rank, Name, Team, Position, Auction Value
 *   Yahoo xlsx:       Rank, Name, Team, Position
 */

const fs   = require('fs');
const path = require('path');
const { getDb, calcConsensus } = require('./db');

// ── Attempt to load xlsx parsing (optional dep) ───────────────────────────
let XLSX;
try { XLSX = require('xlsx'); } catch { XLSX = null; }

const DATA_DIR = path.join(__dirname, '../data');

// ── Normalise position string ─────────────────────────────────────────────
const POS_MAP = {
  'OF1':'OF','OF2':'OF','OF3':'OF','OF4':'OF','OF5':'OF',
  'LF':'OF','CF':'OF','RF':'OF',
  'SP1':'SP','SP2':'SP','SP3':'SP','SP4':'SP','SP5':'SP',
  'RP1':'RP','RP2':'RP','RP3':'RP',
  'P':'P',
};
function normalizePos(raw, source = 'fp') {
  if (!raw) return 'UTIL';
  const parts = raw.trim().toUpperCase().split(',').map(p => p.trim());
  // For FantasyPros keep original (OF1/OF2/OF3 preserved in positions column)
  const display = source === 'fp'
    ? (POS_MAP[parts[0]] ?? parts[0])
    : (POS_MAP[parts[0]] ?? parts[0]);
  return display;
}

// ── Parse FantasyPros CSV ─────────────────────────────────────────────────
function parseFP() {
  const file = path.join(DATA_DIR, 'FantasyPros_2026_Draft_ALL_Rankings.csv');
  if (!fs.existsSync(file)) {
    console.warn('⚠  FantasyPros CSV not found — using empty FP data');
    return new Map();
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  const rkIdx   = header.findIndex(h => /^RK$/i.test(h));
  const nameIdx = header.findIndex(h => /player.*name|name/i.test(h));
  const teamIdx = header.findIndex(h => /team/i.test(h));
  const posIdx  = header.findIndex(h => /^pos$/i.test(h));

  const map = new Map(); // key = normalised name
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g,''));
    if (!cols[nameIdx]) continue;
    const name = cols[nameIdx].trim();
    const rk   = parseInt(cols[rkIdx]);
    const pos  = cols[posIdx] ?? '';
    map.set(name.toLowerCase(), {
      name,
      team: cols[teamIdx] ?? '',
      positions: pos,           // raw FP position (may be OF1/OF2 etc.)
      pos_display: normalizePos(pos, 'fp'),
      fp_rank: isNaN(rk) ? null : rk,
    });
  }
  console.log(`  FP: ${map.size} players loaded`);
  return map;
}

// ── Parse xlsx helper ─────────────────────────────────────────────────────
function parseXlsx(filename, rankCol, nameCol, teamCol, posCol, auctionCol) {
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) {
    console.warn(`⚠  ${filename} not found — skipping`);
    return new Map();
  }
  if (!XLSX) {
    console.warn('⚠  xlsx package not installed (npm install xlsx) — skipping');
    return new Map();
  }
  const wb   = XLSX.readFile(file);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const map  = new Map();
  rows.forEach(row => {
    const name = row[nameCol];
    if (!name) return;
    const rk  = parseInt(row[rankCol]);
    const pos = (row[posCol] ?? '').toString().trim();
    map.set(name.toString().toLowerCase().trim(), {
      rank: isNaN(rk) ? null : rk,
      team: (row[teamCol] ?? '').toString().trim(),
      pos_display: normalizePos(pos, 'other'),
      auction: auctionCol ? parseFloat(row[auctionCol]) || null : null,
    });
  });
  console.log(`  ${filename}: ${map.size} players loaded`);
  return map;
}

// ── Main seed ─────────────────────────────────────────────────────────────
function seed() {
  const db = getDb();

  console.log('\n🌱  Seeding JOYT database...');

  // Check if already seeded
  const count = db.prepare('SELECT COUNT(*) as n FROM players').get().n;
  if (count > 0) {
    const answer = process.env.FORCE_SEED ? 'yes' : null;
    if (!answer) {
      console.log(`  Database already has ${count} players.`);
      console.log('  Set FORCE_SEED=1 to re-seed (this will DELETE all player data).');
      return;
    }
    db.prepare('DELETE FROM players').run();
    db.prepare('DELETE FROM round_strategy').run();
    console.log('  Cleared existing player data.');
  }

  const fp     = parseFP();
  const espn   = parseXlsx('espn_top300.xlsx',      'Rank','Name','Team','Position','Auction Value');
  const yahoo  = parseXlsx('yahoo_rankings.xlsx',   'Rank','Name','Team','Position', null);

  // Merge: FP is master list
  const insert = db.prepare(`
    INSERT INTO players
      (name, team, positions, pos_display,
       fp_rank, espn_rank, yahoo_rank, espn_auction, consensus_rank)
    VALUES
      (@name, @team, @positions, @pos_display,
       @fp_rank, @espn_rank, @yahoo_rank, @espn_auction, @consensus_rank)
  `);

  const insertMany = db.transaction(players => {
    for (const p of players) insert.run(p);
  });

  const rows = [];
  fp.forEach((player, key) => {
    const e = espn.get(key)  ?? {};
    const y = yahoo.get(key) ?? {};
    rows.push({
      name:         player.name,
      team:         player.team || e.team || '',
      positions:    player.positions,
      pos_display:  player.pos_display,
      fp_rank:      player.fp_rank,
      espn_rank:    e.rank   ?? null,
      yahoo_rank:   y.rank   ?? null,
      espn_auction: e.auction ?? null,
      consensus_rank: calcConsensus(player.fp_rank, e.rank, y.rank),
    });
  });

  // Sort by consensus before inserting (nice for debugging)
  rows.sort((a,b) => (a.consensus_rank ?? 9999) - (b.consensus_rank ?? 9999));
  insertMany(rows);

  // Seed default round strategy rows (20 rounds)
  const rsInsert = db.prepare(`
    INSERT OR IGNORE INTO round_strategy (round_num, picks_range, target_positions, tier, target_names, notes)
    VALUES (@round_num, @picks_range, @target_positions, @tier, @target_names, @notes)
  `);
  const defaultTiers = [
    'ELITE TIER','TIER 1','TIER 1-2','TIER 2','TIER 2-3',
    'TIER 3','TIER 3','TIER 3-4','TIER 4','SLEEPER RD',
    'DEPTH','DEPTH','DEPTH','DEPTH','DEPTH',
    'LOTTERY PICKS','LOTTERY PICKS','LOTTERY PICKS','LOTTERY PICKS','LOTTERY PICKS',
  ];
  const seedRs = db.transaction(() => {
    for (let r = 1; r <= 20; r++) {
      rsInsert.run({
        round_num:        r,
        picks_range:      `${(r-1)*12+1}-${r*12}`,
        target_positions: '',
        tier:             defaultTiers[r-1] ?? 'DEPTH',
        target_names:     '',
        notes:            '',
      });
    }
  });
  seedRs();

  console.log(`\n✅  Seeded ${rows.length} players + 20 round strategy rows.\n`);
}

seed();
