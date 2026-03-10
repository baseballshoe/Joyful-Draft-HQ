const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../db/joyt.db');
const SCHEMA_PATH = path.join(__dirname, '../db/schema.sql');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema on first open
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
  }
  return db;
}

// ── Consensus rank calculation ─────────────────────────────────────────────
// Weights: FP 40%, ESPN 35%, Yahoo 25%
// Treats missing ranks as a penalty (max_rank + 100)
function calcConsensus(fp, espn, yahoo, maxRank = 500) {
  const penalty = maxRank + 100;
  const f = fp    ?? penalty;
  const e = espn  ?? penalty;
  const y = yahoo ?? penalty;
  return +(f * 0.40 + e * 0.35 + y * 0.25).toFixed(2);
}

// Priority rank: my_rank first, then consensus
function priorityRank(player) {
  return player.my_rank ?? player.consensus_rank;
}

module.exports = { getDb, calcConsensus, priorityRank };
