// server/coach/context.ts
// ─────────────────────────────────────────────────────────────────────
// Build the data snapshot Coach sees on every conversation turn.
//
// v1.1: 3-block split for prompt caching
// v1.2: temporal awareness + schedule layer + two-start pitcher detection
// v1.4: multi-source row merging + comprehensive stat formatters +
//       fixes field-name bugs (strikeoutsPitched, hitsAllowed, etc.)
//
// Block layout:
//   1. staticPrefix      Coach personality + sport pack + league
//                        header + settings. Cached.
//   2. semiStaticBlock   Temporal context + standings + matchup +
//                        week schedule summary. Cached; busts daily.
//   3. volatileBlock     User's roster + available pool + waivers
//                        + optionally other teams. NOT cached.
//
// MULTI-SOURCE MERGE (v1.4):
//   pitcher_stats and batter_stats can have multiple rows per
//   (player_id, season) — one per data_source ('mlb-stats-api',
//   'fangraphs', 'savant'). We merge them column-by-column with
//   source priority: MLB Stats API > FanGraphs > Savant for any
//   column populated by multiple sources. NULL columns are filled
//   in from whichever source has the value.
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
import { scheduleProvider } from '../external/schedule';
import type { WeekSchedule, ProbableStartsMap } from '../external/schedule';

const CURRENT_SEASON = new Date().getFullYear();

// Source priority for merging multi-source rows. Lower index = higher priority.
const SOURCE_PRIORITY = ['mlb-stats-api', 'fangraphs', 'savant'];

// ── Temporal context (v1.2) ──────────────────────────────────────────────

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface TemporalContext {
  today:         Date;
  todayStr:      string;
  todayIso:      string;
  weekStart:     string;
  weekEnd:       string;
  dayOfWeek:     number;
  daysRemaining: number;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function computeTemporalContext(today: Date = new Date()): TemporalContext {
  const jsDay  = today.getDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() - (isoDay - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const todayStr =
    `${DAY_NAMES[today.getDay()]}, ${MONTH_NAMES[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;
  return {
    today, todayStr,
    todayIso:      isoDate(today),
    weekStart:     isoDate(monday),
    weekEnd:       isoDate(sunday),
    dayOfWeek:     isoDay,
    daysRemaining: 8 - isoDay,
  };
}

// ── Lazy-load relevance check (v1.1) ─────────────────────────────────────

const OTHER_TEAMS_RELEVANCE = /\b(trade|trad(e|es|ing)|swap|target|stash|league.?wide|who has|other teams?|opponents?'?\s+roster|strength|weakness|where am i (weak|strong)|cover (my|the)|need help (with|in|at)|short on|deep at)\b/i;

function shouldIncludeOtherTeams(latestUserMessage: string | undefined): boolean {
  if (!latestUserMessage) return false;
  return OTHER_TEAMS_RELEVANCE.test(latestUserMessage);
}

// ── Multi-source row merging (v1.4) ──────────────────────────────────────
//
// pitcher_stats / batter_stats may have multiple rows per player from
// different data sources. We collapse to one row per player by taking
// the highest-priority non-null value per column.

function mergeStatRows<T extends { dataSource?: string | null }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const sorted = [...rows].sort((a, b) => {
    const ai = SOURCE_PRIORITY.indexOf(a.dataSource ?? '');
    const bi = SOURCE_PRIORITY.indexOf(b.dataSource ?? '');
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const merged: any = { ...sorted[0] };
  for (const row of sorted.slice(1)) {
    for (const [key, value] of Object.entries(row)) {
      if (merged[key] == null && value != null) {
        merged[key] = value;
      }
    }
  }
  return merged as T;
}

function rowsByPlayerId<T extends { playerId: number; dataSource?: string | null }>(
  rows: T[],
): Map<number, T> {
  const grouped = new Map<number, T[]>();
  for (const r of rows) {
    if (!grouped.has(r.playerId)) grouped.set(r.playerId, []);
    grouped.get(r.playerId)!.push(r);
  }
  const merged = new Map<number, T>();
  for (const [pid, list] of grouped) {
    const m = mergeStatRows(list);
    if (m) merged.set(pid, m);
  }
  return merged;
}

// ── Data-completeness check (v1.4) — for limited-data flagging ───────────
//
// Returns a one-line tag describing how much data we have for a player.
// Coach uses this to decide whether to caveat its analysis.

function batterDataCompleteness(stats: any | null): string {
  if (!stats) return 'NO STATS';
  const sample = stats.plateApps ?? stats.atBats ?? 0;
  if (sample < 30)  return 'LIMITED DATA — tiny sample';
  if (sample < 80)  return 'EARLY-SEASON DATA';
  return '';
}

function pitcherDataCompleteness(stats: any | null): string {
  if (!stats) return 'NO STATS';
  const ip = stats.inningsPitched ?? 0;
  const games = stats.games ?? 0;
  if (ip < 10 && games < 5)    return 'LIMITED DATA — tiny sample';
  if (ip < 30)                 return 'EARLY-SEASON DATA';
  return '';
}

// ── Schedule annotation helper (v1.2) ────────────────────────────────────

function buildScheduleAnnotation(
  player:       any,
  isPitcher:    boolean,
  status:       any,
  weekSchedule: WeekSchedule | null,
  probables:    ProbableStartsMap | null,
): string {
  if (!weekSchedule) return '';
  const annotations: string[] = [];
  const team = player.team as string | null | undefined;

  if (team && weekSchedule.gameCountByTeam[team] !== undefined) {
    annotations.push(`${weekSchedule.gameCountByTeam[team]} GP this wk`);
  }
  if (isPitcher && probables && status?.mlbamId) {
    const starts = probables.startCountByPlayerId[String(status.mlbamId)];
    if (starts !== undefined && starts >= 2) {
      annotations.push(`⭐ ${starts} STARTS this wk`);
    } else if (starts === 1) {
      annotations.push('1 start scheduled');
    }
  }
  return annotations.length ? ` | ${annotations.join(', ')}` : '';
}

// ── Comprehensive batter line formatter (v1.4 expansion) ─────────────────
//
// Includes EVERY useful column from batter_stats. Multi-line for
// readability. Schema-correct field names (no v1.2 bugs).

function formatBatterLine(
  p:            any,
  stats:        any | null,
  status:       any | null,
  weekSchedule: WeekSchedule | null,
): string {
  const head = `**${p.name}** (${p.posDisplay}, ${p.team ?? '?'})`;
  const headParts: string[] = [head];

  if (status?.injuryStatus) {
    headParts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
  }
  if (status?.currentTeam && status.currentTeam !== p.team) {
    headParts.push(`team: ${status.currentTeam}`);
  }

  const completeness = batterDataCompleteness(stats);
  const annot = buildScheduleAnnotation(p, false, status, weekSchedule, null);

  if (!stats) {
    headParts.push('(no stats yet)');
    return '- ' + headParts.join(' | ') + annot;
  }

  // Top line: identity + key season summary
  const summary: string[] = [];
  if (stats.games != null)     summary.push(`${stats.games}G`);
  if (stats.plateApps != null) summary.push(`${stats.plateApps}PA`);
  if (stats.atBats != null)    summary.push(`${stats.atBats}AB`);
  if (stats.avg != null)  summary.push(`${stats.avg.toFixed(3)} AVG`);
  if (stats.obp != null)  summary.push(`${stats.obp.toFixed(3)} OBP`);
  if (stats.slg != null)  summary.push(`${stats.slg.toFixed(3)} SLG`);
  if (stats.ops != null)  summary.push(`${stats.ops.toFixed(3)} OPS`);
  if (summary.length) headParts.push(summary.join(' '));

  if (completeness) headParts.push(completeness);

  const lines: string[] = ['- ' + headParts.join(' | ') + annot];

  // Counting stats (one line)
  const counting: string[] = [];
  if (stats.hits != null)        counting.push(`${stats.hits}H`);
  if (stats.doubles != null)     counting.push(`${stats.doubles}2B`);
  if (stats.triples != null)     counting.push(`${stats.triples}3B`);
  if (stats.homeRuns != null)    counting.push(`${stats.homeRuns}HR`);
  if (stats.runs != null)        counting.push(`${stats.runs}R`);
  if (stats.rbi != null)         counting.push(`${stats.rbi}RBI`);
  if (stats.stolenBases != null) counting.push(`${stats.stolenBases}SB`);
  if (stats.caughtStealing != null && stats.caughtStealing > 0) counting.push(`${stats.caughtStealing}CS`);
  if (stats.walks != null)       counting.push(`${stats.walks}BB`);
  if (stats.strikeouts != null)  counting.push(`${stats.strikeouts}K`);
  if (counting.length) lines.push(`  · ${counting.join(' / ')}`);

  // Sabermetric / advanced rate stats
  const sabermetric: string[] = [];
  if (stats.iso != null)     sabermetric.push(`${stats.iso.toFixed(3)} ISO`);
  if (stats.babip != null)   sabermetric.push(`${stats.babip.toFixed(3)} BABIP`);
  if (stats.wOBA != null)    sabermetric.push(`${stats.wOBA.toFixed(3)} wOBA`);
  if (stats.wRCplus != null) sabermetric.push(`${Math.round(stats.wRCplus)} wRC+`);
  if (sabermetric.length) lines.push(`  · ${sabermetric.join(', ')}`);

  // Statcast quality of contact
  const contact: string[] = [];
  if (stats.xBA != null)            contact.push(`${stats.xBA.toFixed(3)} xBA`);
  if (stats.xSLG != null)           contact.push(`${stats.xSLG.toFixed(3)} xSLG`);
  if (stats.xwOBA != null)          contact.push(`${stats.xwOBA.toFixed(3)} xwOBA`);
  if (stats.barrelPct != null)      contact.push(`${(stats.barrelPct * 100).toFixed(1)}% Brl`);
  if (stats.hardHitPct != null)     contact.push(`${(stats.hardHitPct * 100).toFixed(1)}% HH`);
  if (stats.avgExitVelo != null)    contact.push(`${stats.avgExitVelo.toFixed(1)} mph EV`);
  if (stats.maxExitVelo != null)    contact.push(`max ${stats.maxExitVelo.toFixed(1)}`);
  if (stats.avgLaunchAngle != null) contact.push(`${stats.avgLaunchAngle.toFixed(1)}° LA`);
  if (contact.length) lines.push(`  · contact: ${contact.join(', ')}`);

  // Plate discipline
  const discipline: string[] = [];
  if (stats.chasePct != null)        discipline.push(`${(stats.chasePct * 100).toFixed(1)}% chase`);
  if (stats.whiffPct != null)        discipline.push(`${(stats.whiffPct * 100).toFixed(1)}% whiff`);
  if (stats.contactPct != null)      discipline.push(`${(stats.contactPct * 100).toFixed(1)}% contact`);
  if (stats.zoneContactPct != null)  discipline.push(`${(stats.zoneContactPct * 100).toFixed(1)}% z-contact`);
  if (discipline.length) lines.push(`  · discipline: ${discipline.join(', ')}`);

  // Speed
  if (stats.sprintSpeed != null) {
    lines.push(`  · ${stats.sprintSpeed.toFixed(1)} ft/s sprint`);
  }

  return lines.join('\n');
}

// ── Comprehensive pitcher line formatter (v1.4 expansion + bugfixes) ─────
//
// FIXES BUG: v1.2 referenced stats.strikeouts (wrong — schema uses
// strikeoutsPitched). Same for stats.hits → hitsAllowed, etc. As a
// result every pitcher counting stat was silently NULL in Coach's view.

function formatPitcherLine(
  p:            any,
  stats:        any | null,
  status:       any | null,
  weekSchedule: WeekSchedule | null,
  probables:    ProbableStartsMap | null,
): string {
  const head = `**${p.name}** (${p.posDisplay}, ${p.team ?? '?'})`;
  const headParts: string[] = [head];

  if (status?.injuryStatus) {
    headParts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
  }
  if (status?.currentTeam && status.currentTeam !== p.team) {
    headParts.push(`team: ${status.currentTeam}`);
  }

  const completeness = pitcherDataCompleteness(stats);
  const annot = buildScheduleAnnotation(p, true, status, weekSchedule, probables);

  if (!stats) {
    headParts.push('(no stats yet)');
    return '- ' + headParts.join(' | ') + annot;
  }

  // Top line: identity + key season summary
  const summary: string[] = [];
  if (stats.games != null)          summary.push(`${stats.games}G`);
  if (stats.gamesStarted != null)   summary.push(`${stats.gamesStarted}GS`);
  if (stats.inningsPitched != null) summary.push(`${stats.inningsPitched.toFixed(1)} IP`);
  if (stats.era != null)            summary.push(`${stats.era.toFixed(2)} ERA`);
  if (stats.whip != null)           summary.push(`${stats.whip.toFixed(2)} WHIP`);
  if (summary.length) headParts.push(summary.join(' '));

  if (completeness) headParts.push(completeness);

  const lines: string[] = ['- ' + headParts.join(' | ') + annot];

  // Counting stats (key fantasy categories)
  const counting: string[] = [];
  if (stats.wins != null)              counting.push(`${stats.wins}W`);
  if (stats.losses != null)            counting.push(`${stats.losses}L`);
  if (stats.qualityStarts != null)     counting.push(`${stats.qualityStarts}QS`);
  if (stats.saves != null)             counting.push(`${stats.saves}SV`);
  if (stats.holds != null && stats.holds > 0) counting.push(`${stats.holds}HLD`);
  if (stats.strikeoutsPitched != null) counting.push(`${stats.strikeoutsPitched}K`);
  if (stats.walksAllowed != null)      counting.push(`${stats.walksAllowed}BB`);
  if (stats.hitsAllowed != null)       counting.push(`${stats.hitsAllowed}H`);
  if (stats.earnedRuns != null)        counting.push(`${stats.earnedRuns}ER`);
  if (stats.homerunsAllowed != null)   counting.push(`${stats.homerunsAllowed}HR`);
  if (counting.length) lines.push(`  · ${counting.join(' / ')}`);

  // Rate stats
  const rate: string[] = [];
  if (stats.kPer9 != null)    rate.push(`${stats.kPer9.toFixed(2)} K/9`);
  if (stats.bbPer9 != null)   rate.push(`${stats.bbPer9.toFixed(2)} BB/9`);
  if (stats.kRate != null)    rate.push(`${(stats.kRate * 100).toFixed(1)}% K`);
  if (stats.bbRate != null)   rate.push(`${(stats.bbRate * 100).toFixed(1)}% BB`);
  if (stats.kMinusBB != null) rate.push(`${(stats.kMinusBB * 100).toFixed(1)}% K-BB`);
  if (rate.length) lines.push(`  · rates: ${rate.join(', ')}`);

  // Sabermetrics
  const sabermetric: string[] = [];
  if (stats.fip != null)   sabermetric.push(`${stats.fip.toFixed(2)} FIP`);
  if (stats.xFIP != null)  sabermetric.push(`${stats.xFIP.toFixed(2)} xFIP`);
  if (stats.siera != null) sabermetric.push(`${stats.siera.toFixed(2)} SIERA`);
  if (stats.xERA != null)  sabermetric.push(`${stats.xERA.toFixed(2)} xERA`);
  if (stats.war != null)   sabermetric.push(`${stats.war.toFixed(1)} WAR`);
  if (sabermetric.length) lines.push(`  · sabermetric: ${sabermetric.join(', ')}`);

  // Pitch arsenal / stuff
  const stuff: string[] = [];
  if (stats.avgFastballVelo != null) stuff.push(`${stats.avgFastballVelo.toFixed(1)} mph FB`);
  if (stats.maxFastballVelo != null) stuff.push(`max ${stats.maxFastballVelo.toFixed(1)}`);
  if (stats.spinRate != null)        stuff.push(`${Math.round(stats.spinRate)} spin`);
  if (stuff.length) lines.push(`  · stuff: ${stuff.join(', ')}`);

  // Statcast against (key for pitchers — was missing in v1.2)
  const against: string[] = [];
  if (stats.xwOBAagainst != null)      against.push(`${stats.xwOBAagainst.toFixed(3)} xwOBA`);
  if (stats.xBAagainst != null)        against.push(`${stats.xBAagainst.toFixed(3)} xBA`);
  if (stats.barrelPctAgainst != null)  against.push(`${(stats.barrelPctAgainst * 100).toFixed(1)}% Brl`);
  if (stats.hardHitPctAgainst != null) against.push(`${(stats.hardHitPctAgainst * 100).toFixed(1)}% HH`);
  if (against.length) lines.push(`  · against: ${against.join(', ')}`);

  // Pitch quality
  const quality: string[] = [];
  if (stats.cswPct != null)          quality.push(`${(stats.cswPct * 100).toFixed(1)}% CSW`);
  if (stats.swStrikePct != null)     quality.push(`${(stats.swStrikePct * 100).toFixed(1)}% SwStr`);
  if (stats.chasePctInduced != null) quality.push(`${(stats.chasePctInduced * 100).toFixed(1)}% chase`);
  if (stats.zonePct != null)         quality.push(`${(stats.zonePct * 100).toFixed(1)}% zone`);
  if (quality.length) lines.push(`  · pitch quality: ${quality.join(', ')}`);

  return lines.join('\n');
}

// ── Yahoo data renderers ──────────────────────────────────────────────────

function renderLeagueSettings(s: ParsedLeagueSettings): string {
  const battingCats = s.categories.filter(c => c.positionType === 'B').map(c => c.displayName);
  const pitchingCats = s.categories.filter(c => c.positionType === 'P').map(c => c.displayName);
  const slots = s.rosterPositions.map(rp => `${rp.position}×${rp.count}`).join(', ');

  return `## League Settings
**${s.name}** (${s.season}) · ${s.numTeams ?? '?'} teams · ${s.scoringType ?? 'H2H Cat'}
${s.currentWeek ? `Current week: ${s.currentWeek} (${s.startWeek}–${s.endWeek})` : ''}

Batting categories:  ${battingCats.join(', ') || '(none)'}
Pitching categories: ${pitchingCats.join(', ') || '(none)'}
Roster slots: ${slots}`;
}

function renderTemporalContext(t: TemporalContext): string {
  const dayLabel =
    t.dayOfWeek === 1 ? 'Day 1 of 7 (just started — sample sizes mean nothing yet)' :
    t.dayOfWeek === 7 ? 'Day 7 of 7 (final day of the matchup)' :
                        `Day ${t.dayOfWeek} of 7`;
  const remainingNote =
    t.daysRemaining === 1 ? 'Only today left in the matchup.' :
    t.daysRemaining === 0 ? 'Matchup is in the books — we\'re looking at next week.' :
                            `${t.daysRemaining} days remaining (counting today).`;
  return `## TODAY
**${t.todayStr}** (ISO ${t.todayIso})
Matchup week: ${t.weekStart} → ${t.weekEnd} · ${dayLabel}
${remainingNote}`;
}

function renderScheduleSummary(weekSchedule: WeekSchedule | null): string {
  if (!weekSchedule) return '';
  const counts = weekSchedule.gameCountByTeam;
  const teams  = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const heavy:    string[] = [];
  const standard: string[] = [];
  const light:    string[] = [];
  for (const t of teams) {
    if (counts[t] >= 7)      heavy.push(`${t} (${counts[t]})`);
    else if (counts[t] === 6) standard.push(t);
    else                      light.push(`${t} (${counts[t]})`);
  }
  const lines: string[] = [`## Week Schedule (${weekSchedule.startDate} → ${weekSchedule.endDate})`];
  if (heavy.length)    lines.push(`Heavy schedule (7+):  ${heavy.join(', ')}`);
  if (standard.length) lines.push(`Standard (6 games):   ${standard.join(', ')}`);
  if (light.length)    lines.push(`Light schedule (<6):  ${light.join(', ')}`);
  return lines.join('\n');
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

// ── Roster section builders (v1.4: multi-source merge) ───────────────────

async function buildUserRosterSection(
  weekSchedule: WeekSchedule | null,
  probables:    ProbableStartsMap | null,
): Promise<string> {
  try {
    const myRoster = await db.select().from(players).where(eq(players.status, 'mine'));
    if (myRoster.length === 0) return '';

    const ids = myRoster.map(p => p.id);

    // v1.4: don't restrict by data_source — pull all rows for these
    // players in the current season, then merge.
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

    const batterByPid  = rowsByPlayerId(battersRows);
    const pitcherByPid = rowsByPlayerId(pitchersRows);
    const statusByPid  = new Map(statusRows.map(r => [r.playerId, r]));

    const lines: string[] = [];
    for (const p of myRoster) {
      const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay ?? '');
      const stats  = isPitcher ? pitcherByPid.get(p.id) : batterByPid.get(p.id);
      const status = statusByPid.get(p.id);
      lines.push(isPitcher
        ? formatPitcherLine(p, stats, status, weekSchedule, probables)
        : formatBatterLine(p, stats, status, weekSchedule));
    }
    return `## Your Roster (full advanced stats, schedule-annotated)\n${lines.join('\n')}`;
  } catch (e) {
    console.error('[coach/context] Error building user roster section:', e);
    return '';
  }
}

async function buildAvailablePoolAndTagged(
  weekSchedule: WeekSchedule | null,
  probables:    ProbableStartsMap | null,
): Promise<{ pool: string; tagged: string }> {
  try {
    const available = await db.select().from(players).where(eq(players.status, 'available'));
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

    const batterByPid  = rowsByPlayerId(battersRows);
    const pitcherByPid = rowsByPlayerId(pitchersRows);
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
          ? formatPitcherLine(p, stats, status, weekSchedule, probables)
          : formatBatterLine(p, stats, status, weekSchedule));
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

// ── Schedule fetcher (graceful failure) ──────────────────────────────────

async function safeGetWeekSchedule(t: TemporalContext): Promise<WeekSchedule | null> {
  try {
    return await scheduleProvider.getWeekSchedule(t.weekStart, t.weekEnd);
  } catch (e) {
    console.error('[coach/context] schedule fetch failed (continuing without):', e);
    return null;
  }
}

async function safeGetProbables(t: TemporalContext): Promise<ProbableStartsMap | null> {
  try {
    return await scheduleProvider.getProbableStarts(t.weekStart, t.weekEnd);
  } catch (e) {
    console.error('[coach/context] probables fetch failed (continuing without):', e);
    return null;
  }
}

// ── Main entrypoint ───────────────────────────────────────────────────────

export interface CoachContextOptions {
  userId: number;
  pageContext: string;
  latestUserMessage?: string;
  now?: Date;
}

export interface CoachContextResult {
  staticPrefix:       string;
  semiStaticBlock:    string;
  volatileBlock:      string;
  settings:           ParsedLeagueSettings | null;
  includedOtherTeams: boolean;
  hadSchedule:        boolean;
  hadProbables:       boolean;
}

export async function buildCoachContext(opts: CoachContextOptions): Promise<CoachContextResult> {
  const { pageContext, latestUserMessage } = opts;
  const temporal = computeTemporalContext(opts.now ?? new Date());

  const [leagueRow] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));

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

  const [weekSchedule, probables] = await Promise.all([
    safeGetWeekSchedule(temporal),
    safeGetProbables(temporal),
  ]);

  // Static prefix
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

  // Semi-static
  const semiStaticSections: string[] = [];
  semiStaticSections.push(renderTemporalContext(temporal));
  if (weekSchedule) {
    const schedSummary = renderScheduleSummary(weekSchedule);
    if (schedSummary) semiStaticSections.push(schedSummary);
  }
  if (scoreboard) {
    const matchupBlock = renderMatchup(scoreboard, settings);
    if (matchupBlock) semiStaticSections.push(matchupBlock);
  }
  if (standings) semiStaticSections.push(renderStandings(standings));
  const semiStaticBlock = semiStaticSections.join('\n\n') || '(no live standings/matchup yet)';

  // Volatile
  const volatileSections: string[] = [];
  const rosterSection = await buildUserRosterSection(weekSchedule, probables);
  if (rosterSection) volatileSections.push(rosterSection);
  const { pool, tagged } = await buildAvailablePoolAndTagged(weekSchedule, probables);
  if (pool)    volatileSections.push(pool);
  if (tagged)  volatileSections.push(tagged);
  const waiverBlock = renderYahooWaivers(waiverB, waiverP);
  if (waiverBlock) volatileSections.push(waiverBlock);

  const includedOtherTeams = rosters !== null && shouldIncludeOtherTeams(latestUserMessage);
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
    hadSchedule:  weekSchedule !== null,
    hadProbables: probables !== null,
  };
}
