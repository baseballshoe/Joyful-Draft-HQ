/**
 * JOYT API Routes
 * ---------------
 * All REST endpoints + WebSocket broadcast on data changes.
 */

const express = require('express');
const router  = express.Router();
const { getDb, priorityRank } = require('./db');

// WebSocket broadcaster — injected from index.js
let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// ── Helpers ───────────────────────────────────────────────────────────────
function now() { return new Date().toISOString(); }

function enrichPlayer(p) {
  return {
    ...p,
    tags:          p.tags ? p.tags.split(',').filter(Boolean) : [],
    priority_rank: p.my_rank ?? p.consensus_rank,
  };
}

// ── Draft State ───────────────────────────────────────────────────────────
router.get('/draft-state', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM draft_state WHERE id=1').get());
});

router.patch('/draft-state', (req, res) => {
  const db = getDb();
  const { current_round, current_pick, rank_mode } = req.body;
  const fields = [];
  const vals   = {};
  if (current_round !== undefined) { fields.push('current_round=@current_round'); vals.current_round = current_round; }
  if (current_pick  !== undefined) { fields.push('current_pick=@current_pick');   vals.current_pick  = current_pick; }
  if (rank_mode     !== undefined) { fields.push('rank_mode=@rank_mode');          vals.rank_mode     = rank_mode; }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at=@updated_at'); vals.updated_at = now();
  db.prepare(`UPDATE draft_state SET ${fields.join(',')} WHERE id=1`).run(vals);
  const state = db.prepare('SELECT * FROM draft_state WHERE id=1').get();
  broadcast({ type: 'draft_state', data: state });
  res.json(state);
});

// ── Players ───────────────────────────────────────────────────────────────

// GET /api/players — full list with optional filters
// Query params: status, pos, tag, search
router.get('/players', (req, res) => {
  const db = getDb();
  const { status, pos, tag, search } = req.query;

  let sql = 'SELECT * FROM players WHERE 1=1';
  const params = {};

  if (status && status !== 'all') {
    sql += ' AND status=@status';
    params.status = status;
  }
  if (pos && pos !== 'all') {
    sql += ' AND pos_display=@pos';
    params.pos = pos;
  }
  if (tag && tag !== 'all') {
    // Tags are comma-separated; check if tag is contained
    sql += ` AND (',' || tags || ',' LIKE '%,' || @tag || ',%')`;
    params.tag = tag;
  }
  if (search) {
    sql += ' AND (name LIKE @search OR team LIKE @search)';
    params.search = `%${search}%`;
  }

  sql += ' ORDER BY consensus_rank ASC';

  const players = db.prepare(sql).all(params).map(enrichPlayer);
  res.json(players);
});

// GET /api/players/:id
router.get('/players/:id', (req, res) => {
  const db = getDb();
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(enrichPlayer(p));
});

// PATCH /api/players/:id — update any combination of editable fields
router.patch('/players/:id', (req, res) => {
  const db = getDb();
  const allowed = ['my_rank','my_pos_rank','round_override','tags','status','notes'];
  const fields  = [];
  const vals    = { id: req.params.id };

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      fields.push(`${key}=@${key}`);
      // Normalise tags array → comma string
      vals[key] = Array.isArray(req.body[key])
        ? req.body[key].join(',')
        : req.body[key];
    }
  }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at=@updated_at');
  vals.updated_at = now();

  db.prepare(`UPDATE players SET ${fields.join(',')} WHERE id=@id`).run(vals);
  const updated = db.prepare('SELECT * FROM players WHERE id=@id').get({ id: req.params.id });
  const enriched = enrichPlayer(updated);
  broadcast({ type: 'player_updated', data: enriched });
  res.json(enriched);
});

// POST /api/players/:id/reset — restore to available, clear my_rank overrides
router.post('/players/:id/reset', (req, res) => {
  const db = getDb();
  db.prepare(`
    UPDATE players SET status='available', updated_at=@ts WHERE id=@id
  `).run({ id: req.params.id, ts: now() });
  const updated = enrichPlayer(db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id));
  broadcast({ type: 'player_updated', data: updated });
  res.json(updated);
});

// ── Dashboard computed sections ───────────────────────────────────────────

// GET /api/dashboard — returns all sections in one request
router.get('/dashboard', (req, res) => {
  const db    = getDb();
  const state = db.prepare('SELECT * FROM draft_state WHERE id=1').get();
  const mode  = state.rank_mode ?? 'priority';
  const round = state.current_round ?? 1;

  // Helper: order clause by rank mode
  const orderBy = mode === 'consensus'
    ? 'consensus_rank ASC'
    : 'COALESCE(my_rank, consensus_rank) ASC';

  const avail = `status='available'`;

  // My Roster — my picks
  const myRoster = db.prepare(
    `SELECT * FROM players WHERE status='mine' ORDER BY updated_at ASC`
  ).all().map(enrichPlayer);

  // Top 10 Targets — tagged 'target', available
  const top10Targets = db.prepare(
    `SELECT * FROM players WHERE ${avail}
     AND (',' || tags || ',' LIKE '%,target,%')
     ORDER BY ${orderBy} LIMIT 10`
  ).all().map(enrichPlayer);

  // Sleepers — tagged 'sleeper', available
  const sleepers = db.prepare(
    `SELECT * FROM players WHERE ${avail}
     AND (',' || tags || ',' LIKE '%,sleeper,%')
     ORDER BY ${orderBy} LIMIT 10`
  ).all().map(enrichPlayer);

  // Top 5 Overall available
  const top5 = db.prepare(
    `SELECT * FROM players WHERE ${avail} ORDER BY ${orderBy} LIMIT 5`
  ).all().map(enrichPlayer);

  // Best by Position — top available per position (my_pos_rank aware)
  // For each position, if any player has my_pos_rank set, sort by that first
  const positions = ['C','1B','2B','3B','SS','OF','SP','RP','DH'];
  const bestByPos = {};
  for (const pos of positions) {
    bestByPos[pos] = db.prepare(
      `SELECT * FROM players WHERE ${avail} AND pos_display=?
       ORDER BY COALESCE(my_pos_rank, 9999) ASC,
                COALESCE(my_rank, consensus_rank) ASC
       LIMIT 1`
    ).get(pos);
    if (bestByPos[pos]) bestByPos[pos] = enrichPlayer(bestByPos[pos]);
  }

  // Current Rounds — rounds current-1, current, current+1
  // Players forced to their round_override, or naturally falling in that round tier
  // Round tier = 12 picks per round
  const roundData = {};
  for (const r of [round - 1, round, round + 1].filter(x => x >= 1)) {
    const pickStart = (r - 1) * 12 + 1;
    const pickEnd   = r * 12;
    // Players with round_override = r come first; then available players whose
    // consensus rank falls in this round's pick range, up to 5 total
    const forced = db.prepare(
      `SELECT * FROM players WHERE ${avail} AND round_override=?
       ORDER BY ${orderBy}`
    ).all(r).map(enrichPlayer);

    const natural = db.prepare(
      `SELECT * FROM players WHERE ${avail}
       AND (round_override IS NULL OR round_override != ?)
       AND consensus_rank >= ? AND consensus_rank <= ?
       ORDER BY ${orderBy} LIMIT ?`
    ).all(r, pickStart, pickEnd, Math.max(0, 5 - forced.length)).map(enrichPlayer);

    roundData[r] = [...forced, ...natural].slice(0, 5);
  }

  // Next best available (for scorebar)
  const nextBest = db.prepare(
    `SELECT * FROM players WHERE ${avail} ORDER BY ${orderBy} LIMIT 1`
  ).get();

  res.json({
    state,
    myRoster,
    top10Targets,
    sleepers,
    top5,
    bestByPos,
    roundData,
    nextBest: nextBest ? enrichPlayer(nextBest) : null,
  });
});

// ── Round Strategy ────────────────────────────────────────────────────────
router.get('/round-strategy', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM round_strategy ORDER BY round_num').all());
});

router.patch('/round-strategy/:id', (req, res) => {
  const db = getDb();
  const allowed = ['target_positions','tier','target_names','notes'];
  const fields  = [];
  const vals    = { id: req.params.id };
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      fields.push(`${key}=@${key}`);
      vals[key] = Array.isArray(req.body[key]) ? req.body[key].join(',') : req.body[key];
    }
  }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at=@updated_at'); vals.updated_at = now();
  db.prepare(`UPDATE round_strategy SET ${fields.join(',')} WHERE id=@id`).run(vals);
  const updated = db.prepare('SELECT * FROM round_strategy WHERE id=@id').get({ id: req.params.id });
  broadcast({ type: 'round_strategy_updated', data: updated });
  res.json(updated);
});

// ── Cheat Sheet ───────────────────────────────────────────────────────────
router.get('/cheat-sheet', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM cheat_sheet').all();
  const result = {};
  rows.forEach(r => { result[r.section] = r.content; });
  res.json(result);
});

router.patch('/cheat-sheet/:section', (req, res) => {
  const db = getDb();
  const { content } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content required' });
  db.prepare(
    `INSERT INTO cheat_sheet (section, content, updated_at) VALUES (@s, @c, @ts)
     ON CONFLICT(section) DO UPDATE SET content=@c, updated_at=@ts`
  ).run({ s: req.params.section, c: content, ts: now() });
  broadcast({ type: 'cheat_sheet_updated', section: req.params.section, content });
  res.json({ ok: true });
});

module.exports = { router, setBroadcast };
