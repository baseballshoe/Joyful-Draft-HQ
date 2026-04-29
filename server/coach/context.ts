// server/coach/context.ts
// ─────────────────────────────────────────────────────────────────────
// Build the data snapshot Coach sees on every conversation turn.
//
// v1.1: 3-block split for prompt caching
// v1.2: temporal awareness + schedule layer + two-start pitcher detection
// v1.4: multi-source row merging + comprehensive stat formatters +
//       fixes field-name bugs (strikeoutsPitched, hitsAllowed, etc.)
// v1.5: Yahoo as highest-priority data source
// v1.5.1.2: defensive percentage formatter
// v1.5.1.3: ALWAYS include other teams' rosters + tag each player with
//           roster status (rostered by [team] vs available vs on wire).
//           Coach can no longer recommend players he can see are owned.
//
// THE PROBLEM v1.5.1.3 FIXES:
//   Coach kept recommending players like Christian Walker who were
//   already rostered by other teams. Two root causes:
//   1. shouldIncludeOtherTeams() only loaded rosters when the user
//      message mentioned "trade/swap/target" — for casual recommendation
//      questions, Coach had zero awareness of who owned whom.
//   2. The "available pool" Coach saw was JOYT's own DB (status='available')
//      which tracks MLB-active players, NOT actual Yahoo league
//      availability. A player can be MLB-active but rostered in your
//      specific Yahoo league.
//
// THE FIX:
//   1. Always include other teams' rosters (no regex gate).
//   2. Build a per-turn map: yahooPlayerKey → status ("yours", "rostered
//      by Team X", "available"). Tag each player line in every section
//      so Coach sees availability inline, not buried 5K tokens away.
//   3. Cross-reference: a player is only labeled "available" if they
//      are NOT on any team's roster.
//
// COST IMPACT:
//   Adds ~3-5K tokens per turn (other teams' compact rosters).
//   At single-user scale (you), pennies/month. At commercial scale,
//   keep an eye on this — could compress with abbreviations later if
//   needed.
//
// Block layout:
//   1. staticPrefix      Coach personality + sport pack + league
//                        header + settings. Cached.
//   2. semiStaticBlock   Temporal context + standings + matchup +
//                        week schedule summary. Cached; busts daily.
//   3. volatileBlock     User's roster + available pool + waivers
//                        + ALWAYS other teams' rosters (v1.5.1.3).
//                        NOT cached.
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
const SOURCE_PRIORITY = ['yahoo', 'mlb-stats-api', 'fangraphs', 'savant'];

// ── v1.5.1.2: Defensive percentage formatter ─────────────────────────────
//
// THE PROBLEM:
//   The same column can be stored in different scales depending on which
//   data source wrote it. Confirmed examples in Aaron Judge's row:
//     fangraphs: barrel_pct = 0.239   (decimal, 23.9%)
//     savant:    barrel_pct = 26.1    (percentage, 26.1%)
//
//   Multiplying by 100 unconditionally turns 26.1 into 2610%.
//   Skipping the multiply unconditionally turns 0.239 into 0.2%.
//
// THE FIX:
//   Detect at format time. Values > 1 are already percentages. Values
//   ≤ 1 are decimal fractions and need the * 100. This handles both
//   FanGraphs convention (decimal) and Savant convention (already-pct)
//   without rewriting the data layer.

function fmtPct(v: number | null | undefined, digits = 1): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v > 1) return `${v.toFixed(digits)}%`;
  return `${(v * 100).toFixed(digits)}%`;
}

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

// ── v1.5.1.3: Yahoo player-availability map ──────────────────────────────
//
// Build a single source of truth for "who has whom" across the league.
// Used to tag every player line with their availability status, so Coach
// can never recommend a rostered player without knowing it.

interface YahooAvailability {
  /** Map from normalized name → status string */
  byName: Map<string, string>;
  /** Map from yahoo player_key → status string */
  byYahooKey: Map<string, string>;
}

function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\s+(jr|sr|ii|iii|iv)\.?$/, '')
          .replace(/[^a-z0-9]/g, '');
}

function buildYahooAvailabilityMap(
  myTeamName: string | null,
  rosters:    YahooTeamWithRoster[] | null,
): YahooAvailability {
  const byName     = new Map<string, string>();
  const byYahooKey = new Map<string, string>();
  if (!rosters) return { byName, byYahooKey };

  for (const team of rosters) {
    const isMine = team.isOwnedByCurrentLogin;
    const status = isMine ? '✓ YOURS' : `🔒 ${team.name}`;
    for (const p of team.roster) {
      const n = normalizeName(p.name ?? '');
      if (n) byName.set(n, status);
      if (p.playerKey) byYahooKey.set(p.playerKey, status);
    }
  }
  return { byName, byYahooKey };
}

function rosterTag(name: string, avail: YahooAvailability): string {
  const status = avail.byName.get(normalizeName(name));
  if (!status) return '🟢 AVAILABLE';
  return status;
}

// ── Multi-source row merging (v1.4) ──────────────────────────────────────

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

// ── Data-completeness check (v1.4) ───────────────────────────────────────

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

// ── Comprehensive batter line formatter (v1.5.1.3: + roster tag) ─────────

function formatBatterLine(
  p:            any,
  stats:        any | null,
  status:       any | null,
  weekSchedule: WeekSchedule | null,
  avail:        YahooAvailability,
): string {
  const head = `**${p.name}** (${p.posDisplay}, ${p.team ?? '?'}) ${rosterTag(p.name, avail)}`;
  const headParts: string[] = [head];

  if (status?.injuryStatus) {
    headParts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
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

  // Counting stats
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
  const brl = fmtPct(stats.barrelPct);    if (brl) contact.push(`${brl} Brl`);
  const hh  = fmtPct(stats.hardHitPct);   if (hh)  contact.push(`${hh} HH`);
  if (stats.avgExitVelo != null)    contact.push(`${stats.avgExitVelo.toFixed(1)} mph EV`);
  if (stats.maxExitVelo != null)    contact.push(`max ${stats.maxExitVelo.toFixed(1)}`);
  if (stats.avgLaunchAngle != null) contact.push(`${stats.avgLaunchAngle.toFixed(1)}° LA`);
  if (contact.length) lines.push(`  · contact: ${contact.join(', ')}`);

  // Plate discipline
  const discipline: string[] = [];
  const chase = fmtPct(stats.chasePct);       if (chase) discipline.push(`${chase} chase`);
  const whiff = fmtPct(stats.whiffPct);       if (whiff) discipline.push(`${whiff} whiff`);
  const ctct  = fmtPct(stats.contactPct);     if (ctct)  discipline.push(`${ctct} contact`);
  const zctct = fmtPct(stats.zoneContactPct); if (zctct) discipline.push(`${zctct} z-contact`);
  if (discipline.length) lines.push(`  · discipline: ${discipline.join(', ')}`);

  // Speed
  if (stats.sprintSpeed != null) {
    lines.push(`  · ${stats.sprintSpeed.toFixed(1)} ft/s sprint`);
  }

  return lines.join('\n');
}

// ── Comprehensive pitcher line formatter (v1.5.1.3: + roster tag) ────────

function formatPitcherLine(
  p:            any,
  stats:        any | null,
  status:       any | null,
  weekSchedule: WeekSchedule | null,
  probables:    ProbableStartsMap | null,
  avail:        YahooAvailability,
): string {
  const head = `**${p.name}** (${p.posDisplay}, ${p.team ?? '?'}) ${rosterTag(p.name, avail)}`;
  const headParts: string[] = [head];

  if (status?.injuryStatus) {
    headParts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
  }

  const completeness = pitcherDataCompleteness(stats);
  const annot = buildScheduleAnnotation(p, true, status, weekSchedule, probables);

  if (!stats) {
    headParts.push('(no stats yet)');
    return '- ' + headParts.join(' | ') + annot;
  }

  // Top line summary
  const summary: string[] = [];
  if (stats.games != null)          summary.push(`${stats.games}G`);
  if (stats.gamesStarted != null)   summary.push(`${stats.gamesStarted}GS`);
  if (stats.inningsPitched != null) summary.push(`${stats.inningsPitched.toFixed(1)} IP`);
  if (stats.era != null)            summary.push(`${stats.era.toFixed(2)} ERA`);
  if (stats.whip != null)           summary.push(`${stats.whip.toFixed(2)} WHIP`);
  if (summary.length) headParts.push(summary.join(' '));

  if (completeness) headParts.push(completeness);

  const lines: string[] = ['- ' + headParts.join(' | ') + annot];

  // Counting stats
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
  const kr  = fmtPct(stats.kRate);    if (kr)  rate.push(`${kr} K`);
  const bbr = fmtPct(stats.bbRate);   if (bbr) rate.push(`${bbr} BB`);
  const kbb = fmtPct(stats.kMinusBB); if (kbb) rate.push(`${kbb} K-BB`);
  if (rate.length) lines.push(`  · rates: ${rate.join(', ')}`);

  // Sabermetrics
  const sabermetric: string[] = [];
  if (stats.fip != null)   sabermetric.push(`${stats.fip.toFixed(2)} FIP`);
  if (stats.xFIP != null)  sabermetric.push(`${stats.xFIP.toFixed(2)} xFIP`);
  if (stats.siera != null) sabermetric.push(`${stats.siera.toFixed(2)} SIERA`);
  if (stats.xERA != null)  sabermetric.push(`${stats.xERA.toFixed(2)} xERA`);
  if (stats.war != null)   sabermetric.push(`${stats.war.toFixed(1)} WAR`);
  if (sabermetric.length) lines.push(`  · sabermetric: ${sabermetric.join(', ')}`);

  // Pitch arsenal
  const stuff: string[] = [];
  if (stats.avgFastballVelo != null) stuff.push(`${stats.avgFastballVelo.toFixed(1)} mph FB`);
  if (stats.maxFastballVelo != null) stuff.push(`max ${stats.maxFastballVelo.toFixed(1)}`);
  if (stats.spinRate != null)        stuff.push(`${Math.round(stats.spinRate)} spin`);
  if (stuff.length) lines.push(`  · stuff: ${stuff.join(', ')}`);

  // Statcast against
  const against: string[] = [];
  if (stats.xwOBAagainst != null)    against.push(`${stats.xwOBAagainst.toFixed(3)} xwOBA`);
  if (stats.xBAagainst != null)      against.push(`${stats.xBAagainst.toFixed(3)} xBA`);
  const brlA = fmtPct(stats.barrelPctAgainst);  if (brlA) against.push(`${brlA} Brl`);
  const hhA  = fmtPct(stats.hardHitPctAgainst); if (hhA)  against.push(`${hhA} HH`);
  if (against.length) lines.push(`  · against: ${against.join(', ')}`);

  // Pitch quality
  const quality: string[] = [];
  const csw  = fmtPct(stats.cswPct);          if (csw)  quality.push(`${csw} CSW`);
  const swst = fmtPct(stats.swStrikePct);     if (swst) quality.push(`${swst} SwStr`);
  const chs  = fmtPct(stats.chasePctInduced); if (chs)  quality.push(`${chs} chase`);
  const zn   = fmtPct(stats.zonePct);         if (zn)   quality.push(`${zn} zone`);
  if (quality.length) lines.push(`  · pitch quality: ${quality.join(', ')}`);

  return lines.join('\n');
}

// ── Yahoo data renderers ─────────────────────────────────────────────────

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
    const scoredCats = settings.categories.filter(c => !c.isDisplayOnly);
    for (const cat of scoredCats) {
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
    if (catLines.length) {
      // v1.5.1.8: compute running score from markers and surface it
      // in the matchup header so Coach uses the literal number instead
      // of inferring (or hallucinating) one.
      const wins   = catLines.filter(l => l.endsWith(' ✅')).length;
      const losses = catLines.filter(l => l.endsWith(' ❌')).length;
      const ties   = catLines.filter(l => l.endsWith(' =')).length;
      const scoreStr = ties > 0
        ? `${wins}-${losses}-${ties} (your wins–losses–ties)`
        : `${wins}-${losses} (your wins–losses)`;
      lines.push(`**Current category score: ${scoreStr}**`);
      lines.push('Category scoreline:\n' + catLines.join('\n'));
    }
  }
  return lines.join('\n');
}

// ── v1.5.1.3: ALWAYS render other teams' rosters ─────────────────────────
//
// Compact format — name, position, injury status only. No per-player stats
// (they'd blow up token count). Coach uses this for league-wide awareness:
// "is X owned, who has thin SP, what's Team Y stacking, etc."

function renderOtherTeams(allTeams: YahooTeamWithRoster[]): string {
  const others = allTeams.filter(t => !t.isOwnedByCurrentLogin);
  if (!others.length) return '';
  const lines: string[] = ['## Other Teams in League (compact rosters — for trade/availability awareness)'];
  for (const team of others) {
    const mgr = team.managerName ? ` · ${team.managerName}` : '';
    lines.push(`\n**${team.name}**${mgr}`);
    if (team.roster.length === 0) {
      lines.push('  (roster unavailable)');
      continue;
    }
    const compact = team.roster
      .map(p => `${p.name} (${p.displayPosition}${p.injuryStatus ? `, 🏥 ${p.injuryStatus}` : ''})`)
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

// ── Roster section builders (v1.5.1.3: pass availability map down) ───────

async function buildUserRosterSection(
  weekSchedule: WeekSchedule | null,
  probables:    ProbableStartsMap | null,
  avail:        YahooAvailability,
): Promise<string> {
  try {
    const myRoster = await db.select().from(players).where(eq(players.status, 'mine'));
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

    const batterByPid  = rowsByPlayerId(battersRows);
    const pitcherByPid = rowsByPlayerId(pitchersRows);
    const statusByPid  = new Map(statusRows.map(r => [r.playerId, r]));

    const lines: string[] = [];
    for (const p of myRoster) {
      const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay ?? '');
      const stats  = isPitcher ? pitcherByPid.get(p.id) : batterByPid.get(p.id);
      const status = statusByPid.get(p.id);
      lines.push(isPitcher
        ? formatPitcherLine(p, stats, status, weekSchedule, probables, avail)
        : formatBatterLine(p, stats, status, weekSchedule, avail));
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
  avail:        YahooAvailability,
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
    // v1.5.1.3: filter out anyone Yahoo says is rostered. Only TRULY available
    // players belong in the pool — otherwise Coach recommends rostered guys.
    const withData = available
      .filter(p => batterByPid.has(p.id) || pitcherByPid.has(p.id))
      .filter(p => {
        const tag = avail.byName.get(normalizeName(p.name ?? ''));
        // No Yahoo data = could go either way, leave them in.
        // "🟢 AVAILABLE" status means Yahoo confirms they're free.
        // "🔒 [Team]" or "✓ YOURS" means rostered — exclude.
        return !tag || tag === '🟢 AVAILABLE' || !tag.startsWith('🔒') && !tag.startsWith('✓');
      })
      .sort((a, b) => (a.consensusRank ?? 9999) - (b.consensusRank ?? 9999))
      .slice(0, 60);

    if (withData.length > 0) {
      const lines: string[] = [];
      for (const p of withData) {
        const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay ?? '');
        const stats  = isPitcher ? pitcherByPid.get(p.id) : batterByPid.get(p.id);
        const status = statusByPid.get(p.id);
        lines.push(isPitcher
          ? formatPitcherLine(p, stats, status, weekSchedule, probables, avail)
          : formatBatterLine(p, stats, status, weekSchedule, avail));
      }
      pool = `## Available Players With Current Data (top ${withData.length}, Yahoo-cross-referenced)
These have stats AND are confirmed not on any team's Yahoo roster. Recommend adds from this pool primarily.

${lines.join('\n')}`;
    }

    let tagged = '';
    const taggedPlayers = available.filter(p => p.tags && p.tags.length > 0).slice(0, 25);
    if (taggedPlayers.length > 0) {
      const lines = taggedPlayers.map(p =>
        `- **${p.name}** (${p.posDisplay}, ${p.team ?? '?'}) ${rosterTag(p.name ?? '', avail)} — tags: ${p.tags}`
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
  const { pageContext } = opts;
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

  // v1.5.1.3: Build the availability map ONCE per turn from Yahoo rosters
  const avail = buildYahooAvailabilityMap(leagueRow?.myTeamName ?? null, rosters);

  // Static prefix (cacheable)
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

  // Volatile (v1.5.1.3: always include other teams)
  const volatileSections: string[] = [];
  const rosterSection = await buildUserRosterSection(weekSchedule, probables, avail);
  if (rosterSection) volatileSections.push(rosterSection);
  const { pool, tagged } = await buildAvailablePoolAndTagged(weekSchedule, probables, avail);
  if (pool)    volatileSections.push(pool);
  if (tagged)  volatileSections.push(tagged);
  const waiverBlock = renderYahooWaivers(waiverB, waiverP);
  if (waiverBlock) volatileSections.push(waiverBlock);

  // v1.5.1.3: ALWAYS include other teams' rosters when available
  let includedOtherTeams = false;
  if (rosters && rosters.length > 0) {
    const otherBlock = renderOtherTeams(rosters);
    if (otherBlock) {
      volatileSections.push(otherBlock);
      includedOtherTeams = true;
    }
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
