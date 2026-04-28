// server/coach/context.ts
// ─────────────────────────────────────────────────────────────────────
// Build the data snapshot Coach sees on every conversation turn.
//
// v1.1 REFACTOR: The output is now split into THREE blocks for prompt
// caching:
//
//   1. staticPrefix      — Coach personality + sport pack + league
//                          header + settings. Identical across turns
//                          within a session. Cached (first breakpoint).
//
//   2. semiStaticBlock   — Standings + matchup top-line. Changes
//                          rarely (every ~30 min as Yahoo cache
//                          refreshes). Cached (second breakpoint).
//
//   3. volatileBlock     — User's roster (full advanced stats),
//                          available player pool, tagged players,
//                          Yahoo waivers, and OPTIONALLY other teams'
//                          rosters. NOT cached — fresh every turn.
//
// Other teams' rosters are now LAZY-LOADED: only included when the
// user's question hints at trades / league-wide / "who has X" /
// strength-weakness analysis. Saves ~1-2K tokens on most turns.
//
// Ordering of detail (most → least):
//   1. User's roster — full advanced stats per player
//   2. Available player pool with stats — addable candidates
//   3. Current matchup — categories scoreline this week
//   4. Standings — full league context
//   5. Other 11 teams' rosters — names + positions only (lazy)
//   6. League settings — categories, roster construction
//   7. User-tagged players (their notes from cheat sheet)
// ─────────────────────────────────────────────────────────────────────
import { db } from '../db';
import {
  players, batterStats, pitcherStats, playerIds, playerStatus,
  yahooLeague,
} from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getCachedOrNull } from '../yahoo-cache';
import type {
  ParsedLeagueSettings, ParsedStandings, ParsedScoreboard,
  YahooTeamWithRoster, YahooRosterPlayer,
} from '../yahoo';
import { buildCoachSystemPrompt } from './personality';
import { buildBaseballPack } from './baseball';

const CURRENT_SEASON = new Date().getFullYear();

// ── Lazy-load relevance check ─────────────────────────────────────────────
//
// Other teams' rosters add ~1-2K tokens. They're only relevant when the
// user is asking about trades, league-wide context, or who has whom.
// For everyday "should I drop X" or "who's hot on waivers" questions,
// they're noise. Skip them by default; include only when we see signal.

const OTHER_TEAMS_RELEVANCE = /\b(trade|trad(e|es|ing)|swap|target|stash|league.?wide|who has|other teams?|opponents?'?\s+roster|strength|weakness|where am i (weak|strong)|cover (my|the)|need help (with|in|at)|short on|deep at)\b/i;

function shouldIncludeOtherTeams(latestUserMessage: string | undefined): boolean {
  if (!latestUserMessage) return false;
  return OTHER_TEAMS_RELEVANCE.test(latestUserMessage);
}

// ── Stat formatters (unchanged from v1.0) ─────────────────────────────────

async function formatBatterLine(p: any, stats: any | null, status: any | null): Promise<string> {
  const parts: string[] = [`**${p.name}** (${p.posDisplay}, ${p.team ?? '?'})`];

  if (status?.injuryStatus) {
    parts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
  }
  if (status?.currentTeam && status.currentTeam !== p.team) {
    parts.push(`current team: ${status.currentTeam}`);
  }
  if (!stats) {
    parts.push('(no current stats)');
    return '- ' + parts.join(' | ');
  }

  const sample: string[] = [];
  if (stats.games)     sample.push(`${stats.games}G`);
  if (stats.plateApps) sample.push(`${stats.plateApps}PA`);
  if (sample.length) parts.push(sample.join(' '));

  const counting: string[] = [];
  if (stats.homeRuns != null)    counting.push(`${stats.homeRuns} HR`);
  if (stats.runs != null)        counting.push(`${stats.runs} R`);
  if (stats.rbi != null)         counting.push(`${stats.rbi} RBI`);
  if (stats.stolenBases != null) counting.push(`${stats.stolenBases} SB`);
  if (counting.length) parts.push(counting.join('/'));

  const rate: string[] = [];
  if (stats.avg  != null) rate.push(`${stats.avg.toFixed(3)} AVG`);
  if (stats.obp  != null) rate.push(`${stats.obp.toFixed(3)} OBP`);
  if (stats.slg  != null) rate.push(`${stats.slg.toFixed(3)} SLG`);
  if (stats.iso  != null) rate.push(`${stats.iso.toFixed(3)} ISO`);
  if (stats.kPct != null) rate.push(`${(stats.kPct * 100).toFixed(1)}% K`);
  if (stats.bbPct != null) rate.push(`${(stats.bbPct * 100).toFixed(1)}% BB`);
  if (rate.length) parts.push(rate.join(', '));

  const adv: string[] = [];
  if (stats.xwoba != null)       adv.push(`${stats.xwoba.toFixed(3)} xwOBA`);
  if (stats.xba != null)         adv.push(`${stats.xba.toFixed(3)} xBA`);
  if (stats.barrelPct != null)   adv.push(`${(stats.barrelPct * 100).toFixed(1)}% Brl`);
  if (stats.hardHitPct != null)  adv.push(`${(stats.hardHitPct * 100).toFixed(1)}% HH`);
  if (stats.sweetSpotPct != null) adv.push(`${(stats.sweetSpotPct * 100).toFixed(1)}% SwSp`);
  if (stats.sprintSpeed != null) adv.push(`${stats.sprintSpeed.toFixed(1)} ft/s`);
  if (adv.length) parts.push(`adv: ${adv.join(', ')}`);

  return '- ' + parts.join(' | ');
}

async function formatPitcherLine(p: any, stats: any | null, status: any | null): Promise<string> {
  const parts: string[] = [`**${p.name}** (${p.posDisplay}, ${p.team ?? '?'})`];

  if (status?.injuryStatus) {
    parts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
  }
  if (!stats) {
    parts.push('(no current stats)');
    return '- ' + parts.join(' | ');
  }

  const sample: string[] = [];
  if (stats.games)         sample.push(`${stats.games}G`);
  if (stats.gamesStarted)  sample.push(`${stats.gamesStarted}GS`);
  if (stats.inningsPitched) sample.push(`${stats.inningsPitched.toFixed(1)} IP`);
  if (sample.length) parts.push(sample.join(' '));

  const counting: string[] = [];
  if (stats.wins != null)         counting.push(`${stats.wins}W`);
  if (stats.qualityStarts != null) counting.push(`${stats.qualityStarts}QS`);
  if (stats.saves != null)        counting.push(`${stats.saves}SV`);
  if (stats.strikeouts != null)   counting.push(`${stats.strikeouts}K`);
  if (counting.length) parts.push(counting.join('/'));

  const rate: string[] = [];
  if (stats.era != null)  rate.push(`${stats.era.toFixed(2)} ERA`);
  if (stats.whip != null) rate.push(`${stats.whip.toFixed(2)} WHIP`);
  if (stats.kPer9 != null) rate.push(`${stats.kPer9.toFixed(1)} K/9`);
  if (stats.bbPer9 != null) rate.push(`${stats.bbPer9.toFixed(1)} BB/9`);
  if (rate.length) parts.push(rate.join(', '));

  const adv: string[] = [];
  if (stats.xERA != null)  adv.push(`${stats.xERA.toFixed(2)} xERA`);
  if (stats.fip != null)   adv.push(`${stats.fip.toFixed(2)} FIP`);
  if (stats.siera != null) adv.push(`${stats.siera.toFixed(2)} SIERA`);
  if (stats.cswPct != null) adv.push(`${(stats.cswPct * 100).toFixed(1)}% CSW`);
  if (stats.swStrikePct != null) adv.push(`${(stats.swStrikePct * 100).toFixed(1)}% SwStr`);
  if (stats.avgFastballVelo != null) adv.push(`${stats.avgFastballVelo.toFixed(1)} mph FB`);
  if (stats.spinRate != null) adv.push(`${Math.round(stats.spinRate)} spin`);
  if (adv.length) parts.push(`adv: ${adv.join(', ')}`);

  return '- ' + parts.join(' | ');
}

// ── Yahoo data renderers ──────────────────────────────────────────────────

function renderLeagueSettings(s: ParsedLeagueSettings): string {
  const battingCats = s.categories.filter(c => c.positionType === 'B').map(c => c.displayName);
  const pitchingCats = s.categories.filter(c => c.positionType === 'P').map(c => c.displayName);
  const slots = s.rosterPositions
    .map(rp => `${rp.position}×${rp.count}`)
    .join(', ');

  return `## League Settings
**${s.name}** (${s.season}) · ${s.numTeams ?? '?'} teams · ${s.scoringType ?? 'H2H Cat'}
${s.currentWeek ? `Current week: ${s.currentWeek} (${s.startWeek}–${s.endWeek})` : ''}

Batting categories:  ${battingCats.join(', ') || '(none)'}
Pitching categories: ${pitchingCats.join(', ') || '(none)'}
Roster slots: ${slots}`;
}

function renderStandings(st: ParsedStandings): string {
  const sorted = [...st.standings].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const lines = sorted.map(t => {
    const me = t.isOwnedByCurrentLogin ? ' ← you' : '';
    const rec = `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`;
    const pct = t.winPct != null ? ` (${t.winPct.toFixed(3)})` : '';
    const gb = t.gamesBack && t.gamesBack !== '-' ? ` · GB: ${t.gamesBack}` : '';
    const mgr = t.managerName ? ` · ${t.managerName}` : '';
    return `${t.rank ?? '?'}. ${t.name}${mgr}${me} — ${rec}${pct}${gb}`;
  });
  return `## Standings\n${lines.join('\n')}`;
}

function renderMatchup(sb: ParsedScoreboard, settings: ParsedLeagueSettings | null): string {
  if (!sb.matchups.length) return '';

  const myMatchup = sb.matchups.find(m => m.sides.some(s => s.isOwnedByCurrentLogin));
  if (!myMatchup) return '';

  const me  = myMatchup.sides.find(s => s.isOwnedByCurrentLogin);
  const opp = myMatchup.sides.find(s => !s.isOwnedByCurrentLogin);
  if (!me || !opp) return '';

  const lines: string[] = [];
  lines.push(`## This Week's Matchup (Week ${sb.week ?? '?'})`);
  lines.push(`**${me.name}** vs **${opp.name}**${myMatchup.status ? ` (${myMatchup.status})` : ''}`);

  // Build per-category comparison if we have settings + stats
  if (settings) {
    const catLines: string[] = [];
    for (const cat of settings.categories) {
      const myV  = me.statsByStatId[cat.statId];
      const opV  = opp.statsByStatId[cat.statId];
      if (myV == null || opV == null) continue;
      const myNum = Number(myV);
      const opNum = Number(opV);
      let edge = '';
      if (!isNaN(myNum) && !isNaN(opNum)) {
        const meBetter = cat.sortOrder === 'asc' ? myNum < opNum : myNum > opNum;
        edge = meBetter ? ' ✅' : (myNum === opNum ? ' =' : ' ❌');
      }
      catLines.push(`  ${cat.displayName}: ${myV} vs ${opV}${edge}`);
    }
    if (catLines.length) lines.push('Category scoreline:\n' + catLines.join('\n'));
  }
  return lines.join('\n');
}

function renderOtherTeams(allTeams: YahooTeamWithRoster[]): string {
  const others = allTeams.filter(t => !t.isOwnedByCurrentLogin);
  if (!others.length) return '';

  const lines: string[] = ['## Other Teams in League (rosters, no stats)'];
  for (const team of others) {
    const mgr = team.managerName ? ` · ${team.managerName}` : '';
    lines.push(`\n**${team.name}**${mgr}`);
    if (team.roster.length === 0) {
      lines.push('  (roster unavailable)');
      continue;
    }
    const compact = team.roster
      .map(p => `${p.name} (${p.displayPosition}${p.injuryStatus ? `, ${p.injuryStatus}` : ''})`)
      .join('; ');
    lines.push(`  ${compact}`);
  }
  return lines.join('\n');
}

function renderYahooWaivers(waiverB: YahooRosterPlayer[] | null, waiverP: YahooRosterPlayer[] | null): string {
  const lines: string[] = [];
  if (waiverB?.length) {
    lines.push(`## Yahoo Waiver Wire — Batters (top ${Math.min(waiverB.length, 25)})`);
    lines.push(waiverB.slice(0, 25).map(p =>
      `- ${p.name} (${p.displayPosition}, ${p.editorialTeam}${p.injuryStatus ? `, 🏥 ${p.injuryStatus}` : ''})`
    ).join('\n'));
  }
  if (waiverP?.length) {
    lines.push(`## Yahoo Waiver Wire — Pitchers (top ${Math.min(waiverP.length, 25)})`);
    lines.push(waiverP.slice(0, 25).map(p =>
      `- ${p.name} (${p.displayPosition}, ${p.editorialTeam}${p.injuryStatus ? `, 🏥 ${p.injuryStatus}` : ''})`
    ).join('\n'));
  }
  return lines.join('\n\n');
}

// ── Roster section builders (DB-backed) ───────────────────────────────────

async function buildUserRosterSection(): Promise<string> {
  try {
    const myRoster = await db
      .select()
      .from(players)
      .where(eq(players.status, 'mine'));

    if (myRoster.length === 0) return '';

    const ids = myRoster.map(p => p.id);
    const battersRows = await db.select().from(batterStats)
      .where(and(
        eq(batterStats.season, CURRENT_SEASON),
        sql`${batterStats.playerId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`,
      ));
    const pitchersRows = await db.select().from(pitcherStats)
      .where(and(
        eq(pitcherStats.season, CURRENT_SEASON),
        sql`${pitcherStats.playerId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`,
      ));
    const statusRows = await db.select().from(playerStatus)
      .where(sql`${playerStatus.playerId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);

    const batterByPid  = new Map(battersRows.map(r => [r.playerId, r]));
    const pitcherByPid = new Map(pitchersRows.map(r => [r.playerId, r]));
    const statusByPid  = new Map(statusRows.map(r => [r.playerId, r]));

    const lines: string[] = [];
    for (const p of myRoster) {
      const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay ?? '');
      const stats  = isPitcher ? pitcherByPid.get(p.id) : batterByPid.get(p.id);
      const status = statusByPid.get(p.id);
      lines.push(isPitcher
        ? await formatPitcherLine(p, stats, status)
        : await formatBatterLine(p, stats, status));
    }
    return `## Your Roster (full advanced stats)\n${lines.join('\n')}`;
  } catch (e) {
    console.error('[coach/context] Error building user roster section:', e);
    return '';
  }
}

async function buildAvailablePoolAndTagged(): Promise<{ pool: string; tagged: string }> {
  try {
    const available = await db
      .select()
      .from(players)
      .where(eq(players.status, 'available'));

    const ids = available.map(p => p.id);
    if (ids.length === 0) return { pool: '', tagged: '' };

    const battersRows = await db.select().from(batterStats)
      .where(and(
        eq(batterStats.season, CURRENT_SEASON),
        sql`${batterStats.playerId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`,
      ));
    const pitchersRows = await db.select().from(pitcherStats)
      .where(and(
        eq(pitcherStats.season, CURRENT_SEASON),
        sql`${pitcherStats.playerId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`,
      ));
    const statusRows = await db.select().from(playerStatus)
      .where(sql`${playerStatus.playerId} IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);

    const batterByPid  = new Map(battersRows.map(r => [r.playerId, r]));
    const pitcherByPid = new Map(pitchersRows.map(r => [r.playerId, r]));
    const statusByPid  = new Map(statusRows.map(r => [r.playerId, r]));

    let pool = '';
    const withData = available
      .filter(p => batterByPid.has(p.id) || pitcherByPid.has(p.id))
      .sort((a, b) => (a.consensusRank ?? 9999) - (b.consensusRank ?? 9999))
      .slice(0, 60);

    if (withData.length > 0) {
      const lines: string[] = [];
      for (const p of withData) {
        const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay ?? '');
        const stats  = isPitcher ? pitcherByPid.get(p.id) : batterByPid.get(p.id);
        const status = statusByPid.get(p.id);
        lines.push(isPitcher
          ? await formatPitcherLine(p, stats, status)
          : await formatBatterLine(p, stats, status));
      }
      pool = `## Available Players With Current Data (top ${withData.length})
These have stats and are not on rosters. Recommend adds from this pool primarily.

${lines.join('\n')}`;
    }

    let tagged = '';
    const taggedPlayers = available.filter(p => p.tags && p.tags.length > 0).slice(0, 25);
    if (taggedPlayers.length > 0) {
      const lines = taggedPlayers.map(p =>
        `- **${p.name}** (${p.posDisplay}, ${p.team ?? '?'}) — tags: ${p.tags}`
      );
      tagged = `## Players You've Tagged\n${lines.join('\n')}`;
    }

    return { pool, tagged };
  } catch (e) {
    console.error('[coach/context] Error building available players section:', e);
    return { pool: '', tagged: '' };
  }
}

// ── Main entrypoint ───────────────────────────────────────────────────────

export interface CoachContextOptions {
  userId: number;
  pageContext: string;
  /**
   * The latest user message — used by the lazy-load logic to decide
   * whether to include other teams' rosters in the volatile block.
   * Pass undefined to always exclude other teams.
   */
  latestUserMessage?: string;
}

export interface CoachContextResult {
  /** Sport-agnostic personality + sport pack + league header + settings.
   *  Cacheable, identical across turns within a session. */
  staticPrefix: string;

  /** Standings + matchup top-line. Cacheable, changes ~30min. */
  semiStaticBlock: string;

  /** Roster, available pool, tagged, waivers, optionally other teams.
   *  Always fresh — NOT cached. */
  volatileBlock: string;

  /** Live league settings — used by buildBaseballPack to inject
   *  current scoring categories into the sport pack. */
  settings: ParsedLeagueSettings | null;

  /** Whether the lazy other-teams block was included this turn (for
   *  telemetry / debugging). */
  includedOtherTeams: boolean;
}

export async function buildCoachContext(opts: CoachContextOptions): Promise<CoachContextResult> {
  const { userId, pageContext, latestUserMessage } = opts;

  // 1. Connected league overview
  const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));

  // 2. Pull cached Yahoo data (stale-OK; we'd rather have stale than nothing)
  const [settingsCached, standingsCached, scoreboardCached, rostersCached, waiverBCached, waiverPCached] =
    await Promise.all([
      getCachedOrNull<ParsedLeagueSettings>('settings'),
      getCachedOrNull<ParsedStandings>('standings'),
      getCachedOrNull<ParsedScoreboard>('scoreboard'),
      getCachedOrNull<YahooTeamWithRoster[]>('rosters'),
      getCachedOrNull<YahooRosterPlayer[]>('waivers:B'),
      getCachedOrNull<YahooRosterPlayer[]>('waivers:P'),
    ]);

  const settings   = settingsCached?.data ?? null;
  const standings  = standingsCached?.data ?? null;
  const scoreboard = scoreboardCached?.data ?? null;
  const rosters    = rostersCached?.data ?? null;
  const waiverB    = waiverBCached?.data ?? null;
  const waiverP    = waiverPCached?.data ?? null;

  // ── BLOCK 1: STATIC PREFIX (cacheable, biggest win) ─────────────────────
  // Personality + sport pack + league header + league settings.
  const sportPack = buildBaseballPack({ settings });
  const systemPrompt = buildCoachSystemPrompt({ sportPack, pageContext });

  const staticSections: string[] = [systemPrompt, '', '# CURRENT DATA SNAPSHOT'];

  if (leagueRow) {
    staticSections.push(`## League
${leagueRow.name} (${leagueRow.season}) — ${leagueRow.numTeams ?? '?'} teams, ${leagueRow.scoringType ?? 'H2H Cat'}.
Your team: ${leagueRow.myTeamName ?? '(not connected)'}`);
  }

  if (settings) staticSections.push(renderLeagueSettings(settings));

  const staticPrefix = staticSections.join('\n\n');

  // ── BLOCK 2: SEMI-STATIC (cacheable, changes ~30min) ───────────────────
  // Standings + matchup top-line. These shift slowly enough during a
  // session that caching them is a clear win.
  const semiStaticSections: string[] = [];

  if (scoreboard) {
    const matchupBlock = renderMatchup(scoreboard, settings);
    if (matchupBlock) semiStaticSections.push(matchupBlock);
  }

  if (standings) semiStaticSections.push(renderStandings(standings));

  const semiStaticBlock = semiStaticSections.join('\n\n') || '(no live standings/matchup yet)';

  // ── BLOCK 3: VOLATILE (always fresh) ───────────────────────────────────
  // Roster, available pool, tagged, waivers, optionally other teams.
  const volatileSections: string[] = [];

  // 3a. User's roster — DEEP stats
  const rosterSection = await buildUserRosterSection();
  if (rosterSection) volatileSections.push(rosterSection);

  // 3b. Available pool + tagged
  const { pool, tagged } = await buildAvailablePoolAndTagged();
  if (pool)    volatileSections.push(pool);
  if (tagged)  volatileSections.push(tagged);

  // 3c. Real Yahoo waiver wire (fresh roster status from Yahoo)
  const waiverBlock = renderYahooWaivers(waiverB, waiverP);
  if (waiverBlock) volatileSections.push(waiverBlock);

  // 3d. Other teams — LAZY-LOADED only when relevance detected
  const includedOtherTeams =
    rosters !== null && shouldIncludeOtherTeams(latestUserMessage);
  if (includedOtherTeams) {
    const otherBlock = renderOtherTeams(rosters!);
    if (otherBlock) volatileSections.push(otherBlock);
  }

  const volatileBlock = volatileSections.join('\n\n') ||
    '(No roster/waiver data yet — connect Yahoo on the /yahoo page and load a few pages so the auto-sync can populate.)';

  return {
    staticPrefix,
    semiStaticBlock,
    volatileBlock,
    settings,
    includedOtherTeams,
  };
}
