# 🎸 Jazz On Your Tatis — Draft HQ

> 12-team H2H snake draft collaborative tool. Two users, one draft board, real-time sync.

---

## Quick Start on Replit

### 1. Upload your ranking files

Create a `data/` folder in the project root and add:

| File | Source | Notes |
|------|--------|-------|
| `FantasyPros_2026_Draft_ALL_Rankings.csv` | FantasyPros → Export CSV | Must include RK, PLAYER NAME, TEAM, POS columns |
| `espn_top300.xlsx` | ESPN Fantasy → Rankings export | Needs Rank, Name, Team, Position, Auction Value columns |
| `yahoo_rankings.xlsx` | Yahoo Fantasy → Rankings export | Needs Rank, Name, Team, Position columns |

> **Don't have xlsx yet?** The app works with just the FantasyPros CSV — ESPN and Yahoo ranks are optional. ESPN/Yahoo missing ranks are treated as penalties in the consensus formula.

### 2. Install dependencies

Open the Replit Shell and run:

```bash
# Install server deps
npm install

# Install xlsx parser (needed for ESPN/Yahoo files)
npm install xlsx

# Install client deps
cd client && npm install && cd ..
```

### 3. Build the React client

```bash
cd client && npm run build && cd ..
```

### 4. Seed the database

```bash
npm run seed
```

This reads your ranking files and populates the SQLite database. You'll see output like:
```
🌱  Seeding JOYT database...
  FP: 1557 players loaded
  espn_top300.xlsx: 300 players loaded
  yahoo_rankings.xlsx: 300 players loaded
✅  Seeded 1557 players + 20 round strategy rows.
```

> To re-seed (wipe and reload): `FORCE_SEED=1 npm run seed`

### 5. Start the server

Click **Run** in Replit, or in the shell:

```bash
npm run start
```

The app will be live at your Replit URL on port 80.

---

## Development Mode (local)

If running locally with hot reload:

```bash
# Terminal 1 — API server with auto-restart
npm install -g nodemon
nodemon server/index.js

# Terminal 2 — Vite dev server
cd client && npm run dev
```

App available at `http://localhost:5173` (proxies API to `localhost:3001`).

---

## League Settings

| Slot | Count |
|------|-------|
| C | 1 |
| 1B | 1 |
| 2B | 1 |
| 3B | 1 |
| SS | 1 |
| OF | 4 |
| Util | 1 |
| SP | 4 |
| RP | 2 |
| P | 3 |
| BN | 5 |
| **Total** | **23** |

**H2H Categories:** AVG · HR · SB · RBI · R · QS · SAVE · ERA · WHIP · K

---

## Ranking Logic

### Priority Rank (default)
- If **My Rank** is set → use My Rank
- Otherwise → use Consensus Rank
- This is what powers ALL dashboard sections (Top 5, Targets, Sleepers, Round picks)

### Consensus Rank
- Weighted blend: **FantasyPros 40% + ESPN 35% + Yahoo 25%**
- Missing ranks treated as `max_rank + 100` (penalty)

### My Pos Rank
- **ONLY affects** the By Position page and Best by Position on the Dashboard
- Does NOT affect overall rank, round suggestions, or any other section

### Round Override
- Forces a player to appear in a specific round's card on the Dashboard
- Does not affect their consensus or priority rank

### Rank Mode Toggle (in nav)
- **Priority Rank** — My Rank > Consensus (default)
- **Consensus Rank** — always use weighted consensus, ignores My Rank

---

## Pages

### Dashboard
Real-time draft command center:
- **Stat strip** — Round, My Picks, Drafted, Next Best Available
- **My Roster** — position fill bars (C/1B/2B/3B/SS/OF×4/Util/SP×4/RP×2/P×3/BN×5)
- **Top 10 Targets** — players tagged `target`, sorted by Priority Rank
- **Best Available — Current Rounds** — rounds current±1, 5 players per round
- **Quick Mark** — search + Mine/Out for fast draft-day marking
- **Best by Position** — top available per position (My Pos Rank aware)
- **Sleepers** — players tagged `sleeper`, sorted by Priority Rank
- **Top 5 Available** — overall top 5 by Priority Rank

### All Players
Full sortable table with:
- Inline editable **My Rank** (amber), **Round Override**, **My Pos Rank** (pink)
- Multi-select **Tags** (sleeper / target / watch / injured / skip)
- Filter by position, status, tag, and search
- Mine / Out / Reset actions per player

### By Position
3×3 grid (C, 1B, 2B, 3B, SS, OF, SP, RP, DH) — top 5 available per position, sorted by My Pos Rank then Priority Rank.

### My Roster
- Position fill tiles with progress bars for all 11 slot types
- Draft picks table with consensus, FP rank, round tier, priority rank, notes
- H2H categories footer bar

### Cheat Sheet
- 3 free-text columns: Draft Strategy / Avoid & Red Flags / Sleeper Targets
- Scratch pad footer for live draft notes
- Auto-saves on every keystroke, syncs to partner in real time

### Round Strategy
- 20-round table, all editable inline
- Target positions: click position badges to toggle on/off (multi-select)
- Tier: dropdown (Elite Tier → Lottery Picks)
- Target names and notes fields

---

## Real-Time Sync

Both users connect to the same Replit URL. Every change (Mine, Out, tag, rank edit, cheat sheet note) broadcasts to all connected browsers instantly via WebSocket.

The green **Live Sync** dot in the nav confirms connection. If disconnected, it auto-reconnects every 2 seconds.

---

## File Structure

```
joyt/
├── .replit                  # Replit run config
├── replit.nix               # Nix dependencies
├── package.json             # Server dependencies
├── server/
│   ├── index.js             # Express + WebSocket server
│   ├── routes.js            # All API endpoints
│   ├── db.js                # SQLite connection + helpers
│   └── seed.js              # Data import script
├── db/
│   └── schema.sql           # Database schema
├── data/                    # ← PUT YOUR RANKING FILES HERE
│   ├── FantasyPros_2026_Draft_ALL_Rankings.csv
│   ├── espn_top300.xlsx
│   └── yahoo_rankings.xlsx
└── client/
    ├── package.json         # React + Vite deps
    ├── vite.config.js       # Dev proxy config
    ├── index.html
    └── src/
        ├── main.jsx         # Entry point
        ├── App.jsx          # Router + WS setup
        ├── index.css        # Design system tokens + global styles
        ├── lib/
        │   └── api.js       # API helpers + useWS hook
        ├── components/
        │   ├── Nav.jsx      # Navigation header
        │   └── UI.jsx       # PosBadge, TagPill, ActionBtns, Card, etc.
        └── pages/
            ├── Dashboard.jsx
            ├── AllPlayers.jsx
            └── Pages.jsx    # ByPosition, MyRoster, CheatSheet, RoundStrategy
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | All dashboard sections in one request |
| GET | `/api/players` | All players (filter: `?status=&pos=&tag=&search=`) |
| PATCH | `/api/players/:id` | Update my_rank, my_pos_rank, round_override, tags, status, notes |
| POST | `/api/players/:id/reset` | Reset player to available |
| GET | `/api/draft-state` | Current round, pick, rank mode |
| PATCH | `/api/draft-state` | Update round, pick, or rank mode |
| GET | `/api/round-strategy` | All 20 round strategy rows |
| PATCH | `/api/round-strategy/:id` | Update target_positions, tier, target_names, notes |
| GET | `/api/cheat-sheet` | All 4 cheat sheet sections |
| PATCH | `/api/cheat-sheet/:section` | Update strategy/avoid/sleepers/scratchpad |

---

## Troubleshooting

**"Database already has N players"** — normal on restart. Use `FORCE_SEED=1 npm run seed` to reload data.

**xlsx files not loading** — make sure `npm install xlsx` was run in the project root.

**White screen on load** — client wasn't built. Run `cd client && npm run build && cd ..` then restart.

**WebSocket shows "Connecting…"** — normal for 1-2 seconds on load. If it stays, check the server is running.

**Port already in use** — Replit handles this automatically. Locally, change `PORT` env var.
