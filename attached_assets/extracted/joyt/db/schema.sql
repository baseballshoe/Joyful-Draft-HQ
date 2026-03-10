-- JOYT Fantasy Baseball Draft HQ — SQLite Schema
-- Run once to initialize the database

CREATE TABLE IF NOT EXISTS players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  team            TEXT,
  -- positions: comma-separated raw values (e.g. "OF1,OF2", "SP", "C")
  positions       TEXT NOT NULL,
  -- display position (normalized: OF, SP, RP, C, 1B, 2B, 3B, SS, DH)
  pos_display     TEXT NOT NULL,
  -- Source ranks
  fp_rank         INTEGER,
  espn_rank       INTEGER,
  yahoo_rank      INTEGER,
  espn_auction    REAL,
  -- Computed consensus rank (weighted avg, stored for perf, recalculated on seed)
  consensus_rank  REAL,
  -- User overrides
  my_rank         INTEGER,        -- NULL = not set, use consensus
  my_pos_rank     INTEGER,        -- only affects By Position page
  round_override  INTEGER,        -- forces dashboard round display
  -- Tags: comma-separated from: sleeper,target,watch,injured,skip
  tags            TEXT DEFAULT '',
  -- Status: 'available' | 'mine' | 'drafted'
  status          TEXT DEFAULT 'available',
  notes           TEXT DEFAULT '',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_status   ON players(status);
CREATE INDEX IF NOT EXISTS idx_players_pos      ON players(pos_display);
CREATE INDEX IF NOT EXISTS idx_players_consensus ON players(consensus_rank);

-- Round strategy table
CREATE TABLE IF NOT EXISTS round_strategy (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_num       INTEGER NOT NULL UNIQUE,
  picks_range     TEXT,           -- e.g. "1-12"
  target_positions TEXT DEFAULT '',  -- comma-separated positions
  tier            TEXT DEFAULT '',   -- single tier label
  target_names    TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Cheat sheet (single row, keyed by section)
CREATE TABLE IF NOT EXISTS cheat_sheet (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT UNIQUE NOT NULL,   -- 'strategy' | 'avoid' | 'sleepers' | 'scratchpad'
  content TEXT DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO cheat_sheet (section, content) VALUES
  ('strategy',   ''),
  ('avoid',      ''),
  ('sleepers',   ''),
  ('scratchpad', '');

-- Draft state (global settings, single row)
CREATE TABLE IF NOT EXISTS draft_state (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  current_round INTEGER DEFAULT 1,
  current_pick  INTEGER DEFAULT 1,
  rank_mode     TEXT DEFAULT 'priority',  -- 'priority' | 'consensus' | 'blended'
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO draft_state (id) VALUES (1);
