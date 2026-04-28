// client/src/hooks/use-yahoo-data.ts
// ─────────────────────────────────────────────────────────────────────
// Auto-sync hooks for Yahoo data.
//
// Pattern: pages call these on mount. The server's cache layer decides
// whether to revalidate against Yahoo. Pages don't need a refresh button
// or any sync-aware logic — they just call the hook and render.
//
// Each response includes a `meta` object with cache freshness so the UI
// can show subtle "updated 2 min ago" indicators if it wants.
// ─────────────────────────────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface CacheMeta {
  fetchedAt: string;     // ISO timestamp
  ageSec:    number;
  fresh:     boolean;
  ttlSec:    number;
}

export interface YahooEnvelope<T> {
  data: T;
  meta: CacheMeta;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Settings ──────────────────────────────────────────────────────────────
export interface YahooSettingsData {
  leagueKey:    string;
  name:         string;
  season:       string;
  numTeams:     number | null;
  scoringType:  string | null;
  weekly:       string | null;
  currentWeek?: string;
  startWeek?:   string;
  endWeek?:     string;
  categories: Array<{
    statId:       string;
    name:         string;
    displayName:  string;
    sortOrder:    'asc' | 'desc';
    positionType: string;
  }>;
  rosterPositions: Array<{
    position:     string;
    count:        number;
    positionType: string;
  }>;
}

export function useYahooSettings() {
  return useQuery({
    queryKey: ['yahoo', 'settings'],
    queryFn:  () => fetchJson<YahooEnvelope<YahooSettingsData>>('/api/yahoo/settings'),
    staleTime: 0,            // Trust server cache; always re-ask on mount
    refetchOnMount: true,
  });
}

// ── Standings ─────────────────────────────────────────────────────────────
export interface TeamStandingData {
  teamKey:     string;
  teamId:      string;
  name:        string;
  managerName: string | null;
  isOwnedByCurrentLogin: boolean;
  rank:        number | null;
  wins:        number;
  losses:      number;
  ties:        number;
  winPct:      number | null;
  gamesBack:   string | null;
  pointsFor:   number | null;
  pointsAgainst: number | null;
}

export function useYahooStandings() {
  return useQuery({
    queryKey: ['yahoo', 'standings'],
    queryFn:  () => fetchJson<YahooEnvelope<{ leagueKey: string; standings: TeamStandingData[] }>>('/api/yahoo/standings'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

// ── Scoreboard / Matchup ──────────────────────────────────────────────────
export interface MatchupSideData {
  teamKey:     string;
  name:        string;
  isOwnedByCurrentLogin: boolean;
  totalPoints: number | null;
  statsByStatId: Record<string, string>;
}

export interface MatchupData {
  week:    number | null;
  status:  string | null;
  isPlayoffs:    boolean;
  isConsolation: boolean;
  sides:   MatchupSideData[];
}

export function useYahooScoreboard() {
  return useQuery({
    queryKey: ['yahoo', 'scoreboard'],
    queryFn:  () => fetchJson<YahooEnvelope<{ leagueKey: string; week: number | null; matchups: MatchupData[] }>>('/api/yahoo/scoreboard'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

// ── All teams' rosters ────────────────────────────────────────────────────
export interface YahooRosterPlayerData {
  playerKey:         string;
  playerId:          string;
  name:              string;
  editorialTeam:     string;
  displayPosition:   string;
  eligiblePositions: string[];
  selectedPosition:  string | null;
  injuryStatus:      string | null;
}

export interface TeamWithRosterData {
  teamKey:     string;
  teamId:      string;
  name:        string;
  managerName: string | null;
  isOwnedByCurrentLogin: boolean;
  roster:      YahooRosterPlayerData[];
}

export function useYahooAllRosters() {
  return useQuery({
    queryKey: ['yahoo', 'rosters'],
    queryFn:  () => fetchJson<YahooEnvelope<TeamWithRosterData[]>>('/api/yahoo/rosters'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

// ── Waiver wire ───────────────────────────────────────────────────────────
export function useYahooWaivers(position: 'B' | 'P' = 'B') {
  return useQuery({
    queryKey: ['yahoo', 'waivers', position],
    queryFn:  () => fetchJson<YahooEnvelope<YahooRosterPlayerData[]>>(`/api/yahoo/waiver-wire?pos=${position}`),
    staleTime: 0,
    refetchOnMount: true,
  });
}

// ── Transactions ──────────────────────────────────────────────────────────
export interface YahooTransactionData {
  transactionKey: string;
  type:           string;
  status:         string;
  timestamp:      number | null;
  players: Array<{
    playerKey:      string;
    name:           string;
    position:       string;
    team:           string;
    action:         string | null;
    sourceTeamName: string | null;
    destTeamName:   string | null;
  }>;
}

export function useYahooTransactions() {
  return useQuery({
    queryKey: ['yahoo', 'transactions'],
    queryFn:  () => fetchJson<YahooEnvelope<YahooTransactionData[]>>('/api/yahoo/transactions'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

// ── Manual force-refresh ──────────────────────────────────────────────────
//
// Use this if you ever want to expose a refresh button. Default UX
// per the Phase 2 spec is "no manual sync" — pages auto-sync. But this
// hook is wired up if you want the option somewhere (e.g. a dev panel).
//
export function useYahooRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key?: string) => {
      const res = await fetch('/api/yahoo/refresh', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(key ? { key } : {}),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['yahoo'] });
    },
  });
}

// ── Cache status (debug) ──────────────────────────────────────────────────
export function useYahooCacheStatus() {
  return useQuery({
    queryKey: ['yahoo', 'cache-status'],
    queryFn:  () => fetchJson<Record<string, CacheMeta | null>>('/api/yahoo/cache-status'),
    staleTime: 30_000,
  });
}
