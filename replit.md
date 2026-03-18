# Jazz On Your Tatis (JOYT) — Draft HQ

## Overview

JOYT is a real-time fantasy baseball draft assistant tool designed for 12-team Head-to-Head snake drafts. It allows two users to collaboratively manage a draft board with live sync. The app provides a full-featured draft interface including a player database with multi-source rankings, by-position views, roster tracking, a cheat sheet with notes, and round-by-round strategy planning.

Key features:
- Real-time multi-user sync via WebSockets
- Player ranking aggregation from FantasyPros, ESPN, and Yahoo
- Consensus rank calculation (FP 50%, ESPN 50% — Yahoo stored for reference only)
- Player tagging (sleeper, target, watch, injured, skip)
- Draft state tracking (current round/pick, rank mode)
- Per-round strategy planning with tier labels
- Collaborative cheat sheet with auto-save
- Smart roster slot auto-assignment when drafting (primary pos → Util → P overflow → BN)
- Dashboard shows 4 rounds (prev, current, +1, +2); round overrides sort by rank within round
- `rosterSlot` field tracked per player; displayed on My Roster page with SlotBadge

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Layout

The project uses a single-repo structure with three main directories:
- `client/` — React frontend (Vite)
- `server/` — Express backend (Node.js/TypeScript)
- `shared/` — Shared schema and route definitions used by both ends

This eliminates duplication of types and ensures the API contract is enforced in one place.

### Frontend Architecture

- **Framework**: React 18 with TypeScript, bundled by Vite
- **Routing**: `wouter` (lightweight alternative to React Router)
- **State/Data Fetching**: TanStack Query (React Query) for server state. Queries are configured with `staleTime: Infinity` and rely on WebSocket messages and manual invalidations rather than polling. Pages that need live data use direct `api.ts` helpers with local `useState`.
- **UI Components**: Custom JOYT game-ui components (`client/src/components/game-ui.tsx`): PosBadge, TagPill, ActionBtns, Card, StatusPill, EditableRank, TagSelector. shadcn/ui used only for toaster/tooltip.
- **Styling**: Light theme. Tailwind CSS v3 for utilities. JOYT design system CSS in `index.css` using custom properties (`--joyt-*`) with utility classes: `.joyt-card`, `.pos-badge`, `.tag-pill`, `.filter-pill`, `.btn`, `.data-table`, `.search-input`, `.notes-area`, `.progress-bar`, `.editable-cell`.
- **API Client**: `client/src/lib/api.ts` — direct fetch wrappers for all API calls, used by pages that manage their own state.
- **Real-time**: `useWebSocket` hook connects to `/ws`, listens for server broadcasts, returns `{ connected: boolean }`, and invalidates React Query caches. Called in layout component so nav can show live sync status.
- **Layout**: Top horizontal navigation bar with: 💦 "JAZZ ON YOUR TATIS" logo, nav tabs (active tab = pink background), rank mode selector dropdown, live sync indicator dot.

**Key design files:**
- `client/src/components/layout.tsx` — top nav header
- `client/src/components/game-ui.tsx` — JOYT UI primitives
- `client/src/lib/api.ts` — API fetch helpers
- `client/src/index.css` — full JOYT CSS design system

**Pages:**
| Route | Page |
|---|---|
| `/` | Dashboard (stats, targets, sleepers) |
| `/players` | Full player list with filters |
| `/by-position` | Top 5 available players per position |
| `/my-roster` | Drafted roster with slot tracking |
| `/cheat-sheet` | Collaborative free-text notes |
| `/round-strategy` | Per-round tier and position planning |

### Backend Architecture

- **Framework**: Express 5 (TypeScript) running on a single HTTP server
- **WebSocket**: `ws` library attached to the same HTTP server at path `/ws`. All data mutations broadcast updates to connected clients.
- **Development**: Vite dev server runs in middleware mode inside Express, enabling HMR without a separate process.
- **Production**: Client is pre-built by Vite into `dist/public/`; server is bundled by esbuild into `dist/index.cjs`.
- **API**: RESTful endpoints under `/api/*`. Route definitions live in `shared/routes.ts` and are shared with the frontend for consistent path/method references.
- **Storage layer**: A `storage.ts` abstraction (`IStorage` interface) wraps all DB calls via Drizzle ORM, keeping routes clean and testable.

**API Endpoints:**
| Resource | Methods |
|---|---|
| `/api/draft-state` | GET, PATCH |
| `/api/players` | GET (with filters), PATCH /:id, POST /:id/reset |
| `/api/dashboard` | GET |
| `/api/round-strategy` | GET, PATCH /:id |
| `/api/cheat-sheet` | GET, PATCH /:section |

### Data Storage

- **Database**: PostgreSQL via `node-postgres` (`pg`) connection pool
- **ORM**: Drizzle ORM with `drizzle-zod` for schema-derived validation
- **Schema** (`shared/schema.ts`):
  - `players` — Player rankings from multiple sources, draft status, tags, personal rank overrides, notes
  - `draft_state` — Single-row table tracking current round, current pick, rank mode
  - `round_strategy` — Per-round planning rows (tier label, target positions, target names, notes)
  - `cheat_sheet` — Key/value store for free-text sections (strategy, avoid, sleepers, scratchpad)
- **Migrations**: Drizzle Kit manages migrations in `./migrations/`; `drizzle-kit push` is used for schema sync

### Database Seeding

On first startup, if the `players` table is empty, the server seeds default player data and round strategy rows automatically via `seedDatabase()` in `server/routes.ts`. The original design (from `attached_assets`) supported seeding from CSV/XLSX ranking files (FantasyPros, ESPN, Yahoo).

### Consensus Ranking Formula

Priority rank is determined by:
1. User's custom `myRank` if set
2. Otherwise `consensusRank` — stored as a sequential position (uniquified) for internal sorting; displayed in the CON column as the raw `ROUND((fpRank + espnRank) / 2)` average so users can verify the math. Yahoo is ignored in the formula.
3. If only one source has the player, that source's rank is used directly as the consensus.

### Build System

- `tsx` runs TypeScript server directly in development
- `script/build.ts` orchestrates: Vite client build → esbuild server bundle
- esbuild bundles an allowlist of server-side dependencies to minimize cold start overhead; all other deps are marked external

## External Dependencies

### Runtime Dependencies
| Dependency | Purpose |
|---|---|
| `express` v5 | HTTP server and API routing |
| `ws` | WebSocket server for real-time sync |
| `drizzle-orm` + `drizzle-zod` | ORM and schema validation |
| `pg` (node-postgres) | PostgreSQL client |
| `connect-pg-simple` | PostgreSQL session store (included, available if sessions needed) |
| `zod` | Schema validation and API input parsing |
| `@tanstack/react-query` | Client-side server state management |
| `wouter` | Client-side routing |
| `@radix-ui/*` | Accessible UI primitives |
| `tailwind-merge` + `clsx` | Tailwind class utilities |
| `class-variance-authority` | Component variant definitions |
| `date-fns` | Date formatting utilities |
| `nanoid` | Unique ID generation |
| `lucide-react` | Icon library |

### Development Dependencies
| Dependency | Purpose |
|---|---|
| `vite` + `@vitejs/plugin-react` | Frontend bundler and dev server |
| `tsx` | TypeScript execution for server dev |
| `esbuild` | Server production bundler |
| `drizzle-kit` | DB migration tooling |
| `@replit/vite-plugin-runtime-error-modal` | Replit dev overlay |
| `@replit/vite-plugin-cartographer` | Replit dev tooling |
| `tailwindcss` + `autoprefixer` + `postcss` | CSS processing |

### External Services
| Service | Usage |
|---|---|
| PostgreSQL | Primary database (requires `DATABASE_URL` env variable) |
| Google Fonts | DM Sans, DM Mono, Fira Code, Geist Mono, Architects Daughter |

### Environment Variables Required
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string — required at startup |