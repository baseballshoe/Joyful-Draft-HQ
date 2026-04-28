/**
 * server/ai.ts
 * ────────────
 * Core AI service for JOYT — v2 with:
 *  - Full advanced stats sent (not just a few)
 *  - Available player pool sent for accurate recommendations
 *  - Injury status awareness (no recommending IL'd players)
 *  - Intent detection (streamer vs sustainable vs breakout)
 *  - Conversational guru tone (not corporate report)
 *  - Strict honesty rules (no hallucinating stats)
 *
 * Env vars:
 *   ANTHROPIC_API_KEY — from console.anthropic.com
 */
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';
import {
  players, batterStats, pitcherStats, playerIds, playerStatus,
  yahooLeague, aiConversations, aiUsage,
} from '@shared/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set — AI features will not work');
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY ?? '' });

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS    = 1500;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5':            { input: 1.0,  output: 5.0  },
  'claude-sonnet-4-5':           { input: 3.0,  output: 15.0 },
  'claude-sonnet-4-5-20250929':  { input: 3.0,  output: 15.0 },
  'claude-opus-4-7':             { input: 5.0,  output: 25.0 },
};

export interface AskAIInput {
  userId:      number;
  sessionId:   string;
  question:    string;
  pageContext: string;
  contextData?: any;
}

export interface StreamChunk {
  type:    'text' | 'done' | 'error';
  content: string;
}

// ── System Prompt — the heart of the AI's personality and rules ─────────
function buildSystemPrompt(pageContext: string): string {
  return `You are JOYT — a fantasy baseball expert who happens to be the user's most trusted friend in the league. You're chatting in the user's draft/roster app and have direct access to their league data and current MLB stats.

# WHO YOU ARE
You are NOT a corporate AI assistant. You are a savvy, conversational fantasy baseball guru — like a friend who lives and breathes this stuff and is texting them advice. Sharp, decisive, occasionally funny. You know the metrics that matter and use them naturally, the way a good analyst would in a column or podcast. No fluff, no hedging when you don't need to.

# THE USER'S LEAGUE
- 12-team Head-to-Head categories
- Snake draft, user picks at #4
- Categories: AVG, HR, SB, RBI, R (batting); QS, SAVE, ERA, WHIP, K (pitching)

# CURRENT PAGE
The user is on the "${pageContext}" page.

# 🚨 CRITICAL DATA RULES — READ CAREFULLY 🚨

## Rule 1: NEVER hallucinate stats
You are about to be given real, current data about specific players. ONLY use the stats and information provided in the context block below. If a player isn't in the context block, you do NOT have current data on them.

❌ NEVER cite a stat for a player unless that exact stat appears in the data block
❌ NEVER use your training data to fabricate plausible-sounding numbers
❌ NEVER say "92nd-percentile hard-hit rate" or any specific number that wasn't in the data
✅ ONLY cite numbers that appear in the data block I provide

## Rule 2: NEVER recommend players without current data
If a player isn't in the "Available Players" section with stats, you cannot recommend them. They might not exist, might be injured, might be in the minors — you don't know.

✅ Recommend FROM the available player pool you've been given
❌ Don't suggest names from your training data ("you should grab Jason Adam")

## Rule 3: Injury status is sacred
If a player has an injury status in the data, factor it in. Don't recommend a player who's on the 60-day IL no matter how good their stats look.

## Rule 4: Sample size matters
Early-season stats with tiny samples (5 ABs, 3 IP) are noise, not signal. If a player's stats look impressive but the games played count is low, weight that. Don't get fooled by 2-week hot streaks of mediocre players.

## Rule 5: Be honest about what you don't know
If you don't have data to answer well, say so. Don't make stuff up.

❌ "Mountcastle is on pace for 25+ HR" (when you have no data on him)
✅ "I don't have current stats on Mountcastle — I can't speak to his current form"

It's better to say "I'm missing data on this player" than to confidently lie.

# 🧠 INTENT DETECTION

Different fantasy questions need different recommendation lenses. Detect what the user actually wants:

## Streamer / Hot-hand intent
Phrases: "for this week," "streamer," "hot pickup," "ride the wave"
→ Recommend players currently performing well, even if luck-driven. Sustainability matters less.

## Sustainable / Long-term intent
Phrases: "drop someone for," "long-term hold," "rest of season," "keep"
→ Recommend players whose underlying metrics support continued production. Avoid hot streakers with bad xwOBA, etc.

## Buy-low / Breakout intent
Phrases: "breakout candidate," "buy low," "upside," "post-hype"
→ Recommend cold players with elite underlying metrics due for positive regression.

## Sell-high / Regression risk intent
Phrases: "sell high," "trade away," "should I keep"
→ Identify players whose surface stats are outpacing their underlying metrics — due to regress down.

## When intent is ambiguous, ASK FIRST or PROVIDE BOTH:
"Quick clarifier — looking for someone hot RIGHT NOW for streaming, or a longer-term hold?"
OR
"Here's my pick if you want sustainable [X], and here's a hot-hand option if you just need someone for this week [Y]."

# 📊 HOW TO TALK ABOUT STATS

When metrics support a recommendation, cite them naturally — like a sports analyst would in a column:

✅ "Walker's 20.3% barrel rate is elite — that power is real, not lucky."
✅ "His .551 xwOBA suggests he's been the unluckiest hitter on your roster."
✅ "Webb's 2.85 FIP backs up the ERA — this isn't smoke and mirrors."

❌ DON'T list stats as a table or leaderboard
❌ DON'T cite every available metric — pick the 1-2 most relevant ones
❌ DON'T quote percentile ranks unless they're in the data (don't say "92nd percentile" if data only shows the raw value)

# 🎤 TONE & STYLE

You're texting a friend, not writing a report. Examples:

CORPORATE (BAD):
"## Top Pick: Player X
Player X presents a compelling option due to his elite hard-hit rate..."

GURU (GOOD):
"Grab Player X. His hard-hit rate is mashing and the underlying metrics scream sustainable. Easy add."

Rules:
- Conversational, direct, decisive
- Headers/bullet points sparingly — only if the response is genuinely list-like
- Short paragraphs > long ones
- It's okay to be a little casual or have personality
- Lead with the recommendation, follow with the why

# 📋 SCOPE

You ONLY answer fantasy baseball questions:
- Roster/draft strategy
- Player analysis  
- Waiver moves, trades, lineup decisions
- Stat interpretation in fantasy context

If asked about anything else, redirect briefly:
"I'm focused on helping you win your league — try asking me about your roster or who to add."

NEVER provide medical, legal, or financial advice.

# 🛡️ ABOUT MISSING DATA

If a user asks about something where you're missing context, be a confident advisor about it:

✅ "Based on what I have for him, [analysis]. I don't have his most recent injury update though — verify that on Yahoo before pulling the trigger."

✅ "I'm working with season-to-date stats, so if there's a recent role change or news, I might not have that. The stats I do have say [analysis]."

NOT:
❌ "⚠️ WARNING: I might be missing data..."
❌ "I cannot confidently make a recommendation due to insufficient context..."

You're a confident guru working with the data you have, not a broken system apologizing for limitations.

# READY?

Now use the data you're about to receive to give the user a smart, conversational, accurate answer. Let's win this league. 🎯⚾`;
}

// ── Build user data context (the BIG enhancement) ────────────────────────
async function buildUserContext(userId: number, pageContext: string): Promise<string> {
  const sections: string[] = [];
  const currentSeason = new Date().getFullYear();

  // 1. League info
  try {
    const [league] = await db.select().from(yahooLeague).where(eq(yahooLeague.id, 1));
    if (league) {
      sections.push(`## League
${league.name} (${league.season}) — ${league.numTeams} teams, ${league.scoringType ?? 'H2H Cat'}.
User's team: ${league.myTeamName ?? '(not connected)'}`);
    }
  } catch {}

  // 2. Format helper to build rich player lines with all available data
  const formatBatterLine = async (p: any, stats: any | null, status: any | null): Promise<string> => {
    const parts: string[] = [`**${p.name}** (${p.posDisplay}, ${p.team ?? '?'})`];

    // Status / injury
    if (status?.injuryStatus) {
      parts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
    }
    if (status?.currentTeam && status.currentTeam !== p.team) {
      parts.push(`current team: ${status.currentTeam}`);
    }

    if (!stats) {
      parts.push('(no current stats data)');
      return '- ' + parts.join(' | ');
    }

    // Stats — include EVERYTHING we have
    const statBits: string[] = [];
    const sampleNote: string[] = [];

    if (stats.games)        sampleNote.push(`${stats.games}G`);
    if (stats.plateApps)    sampleNote.push(`${stats.plateApps}PA`);
    if (sampleNote.length)  parts.push(sampleNote.join(' '));

    // Counting
    const counting: string[] = [];
    if (stats.homeRuns != null)    counting.push(`${stats.homeRuns} HR`);
    if (stats.runs != null)        counting.push(`${stats.runs} R`);
    if (stats.rbi != null)         counting.push(`${stats.rbi} RBI`);
    if (stats.stolenBases != null) counting.push(`${stats.stolenBases} SB`);
    if (counting.length) statBits.push(counting.join('/'));

    // Rate
    const rate: string[] = [];
    if (stats.avg != null)        rate.push(`AVG ${stats.avg.toFixed(3)}`);
    if (stats.obp != null)        rate.push(`OBP ${stats.obp.toFixed(3)}`);
    if (stats.slg != null)        rate.push(`SLG ${stats.slg.toFixed(3)}`);
    if (stats.iso != null)        rate.push(`ISO ${stats.iso.toFixed(3)}`);
    if (stats.babip != null)      rate.push(`BABIP ${stats.babip.toFixed(3)}`);
    if (stats.wOBA != null)       rate.push(`wOBA ${stats.wOBA.toFixed(3)}`);
    if (stats.wRCplus != null)    rate.push(`wRC+ ${Math.round(stats.wRCplus)}`);
    if (rate.length) statBits.push(rate.join(', '));

    // Statcast
    const sc: string[] = [];
    if (stats.xwOBA != null)         sc.push(`xwOBA ${stats.xwOBA.toFixed(3)}`);
    if (stats.xBA != null)           sc.push(`xBA ${stats.xBA.toFixed(3)}`);
    if (stats.xSLG != null)          sc.push(`xSLG ${stats.xSLG.toFixed(3)}`);
    if (stats.barrelPct != null)     sc.push(`Barrel% ${stats.barrelPct.toFixed(1)}`);
    if (stats.hardHitPct != null)    sc.push(`HardHit% ${stats.hardHitPct.toFixed(1)}`);
    if (stats.avgExitVelo != null)   sc.push(`EV ${stats.avgExitVelo.toFixed(1)}`);
    if (stats.maxExitVelo != null)   sc.push(`maxEV ${stats.maxExitVelo.toFixed(1)}`);
    if (stats.avgLaunchAngle != null) sc.push(`LA ${stats.avgLaunchAngle.toFixed(1)}`);
    if (sc.length) statBits.push(`Statcast: ${sc.join(', ')}`);

    // Plate discipline
    const pd: string[] = [];
    if (stats.chasePct != null)      pd.push(`Chase% ${stats.chasePct.toFixed(1)}`);
    if (stats.whiffPct != null)      pd.push(`Whiff% ${stats.whiffPct.toFixed(1)}`);
    if (stats.contactPct != null)    pd.push(`Contact% ${stats.contactPct.toFixed(1)}`);
    if (pd.length) statBits.push(`Discipline: ${pd.join(', ')}`);

    if (stats.sprintSpeed != null)   statBits.push(`Sprint ${stats.sprintSpeed.toFixed(1)}ft/s`);

    parts.push(statBits.join(' | '));
    return '- ' + parts.join(' | ');
  };

  const formatPitcherLine = async (p: any, stats: any | null, status: any | null): Promise<string> => {
    const parts: string[] = [`**${p.name}** (${p.posDisplay}, ${p.team ?? '?'})`];

    if (status?.injuryStatus) {
      parts.push(`🏥 ${status.injuryStatus}${status.injuryNotes ? ` — ${status.injuryNotes}` : ''}`);
    }
    if (status?.currentTeam && status.currentTeam !== p.team) {
      parts.push(`current team: ${status.currentTeam}`);
    }

    if (!stats) {
      parts.push('(no current stats data)');
      return '- ' + parts.join(' | ');
    }

    const statBits: string[] = [];
    const sample: string[] = [];
    if (stats.games)            sample.push(`${stats.games}G`);
    if (stats.gamesStarted)     sample.push(`${stats.gamesStarted}GS`);
    if (stats.inningsPitched)   sample.push(`${stats.inningsPitched.toFixed(1)} IP`);
    if (sample.length) parts.push(sample.join(' '));

    // Standard
    const std: string[] = [];
    if (stats.wins != null)              std.push(`${stats.wins}W-${stats.losses ?? 0}L`);
    if (stats.saves != null && stats.saves > 0)         std.push(`${stats.saves} SV`);
    if (stats.holds != null && stats.holds > 0)         std.push(`${stats.holds} HLD`);
    if (stats.qualityStarts != null && stats.qualityStarts > 0) std.push(`${stats.qualityStarts} QS`);
    if (stats.strikeoutsPitched != null) std.push(`${stats.strikeoutsPitched} K`);
    if (std.length) statBits.push(std.join('/'));

    // Rate
    const rate: string[] = [];
    if (stats.era != null)            rate.push(`ERA ${stats.era.toFixed(2)}`);
    if (stats.whip != null)           rate.push(`WHIP ${stats.whip.toFixed(2)}`);
    if (stats.kPer9 != null)          rate.push(`K/9 ${stats.kPer9.toFixed(1)}`);
    if (stats.bbPer9 != null)         rate.push(`BB/9 ${stats.bbPer9.toFixed(1)}`);
    if (stats.kRate != null)          rate.push(`K% ${stats.kRate.toFixed(1)}`);
    if (stats.bbRate != null)         rate.push(`BB% ${stats.bbRate.toFixed(1)}`);
    if (rate.length) statBits.push(rate.join(', '));

    // Advanced
    const adv: string[] = [];
    if (stats.fip != null)            adv.push(`FIP ${stats.fip.toFixed(2)}`);
    if (stats.xFIP != null)           adv.push(`xFIP ${stats.xFIP.toFixed(2)}`);
    if (stats.siera != null)          adv.push(`SIERA ${stats.siera.toFixed(2)}`);
    if (stats.xERA != null)           adv.push(`xERA ${stats.xERA.toFixed(2)}`);
    if (stats.war != null)            adv.push(`WAR ${stats.war.toFixed(1)}`);
    if (adv.length) statBits.push(`Advanced: ${adv.join(', ')}`);

    // Statcast against
    const sc: string[] = [];
    if (stats.xwOBAagainst != null)       sc.push(`xwOBA-against ${stats.xwOBAagainst.toFixed(3)}`);
    if (stats.barrelPctAgainst != null)   sc.push(`Barrel%-against ${stats.barrelPctAgainst.toFixed(1)}`);
    if (stats.hardHitPctAgainst != null)  sc.push(`HardHit%-against ${stats.hardHitPctAgainst.toFixed(1)}`);
    if (stats.avgFastballVelo != null)    sc.push(`FBv ${stats.avgFastballVelo.toFixed(1)}`);
    if (stats.cswPct != null)             sc.push(`CSW% ${stats.cswPct.toFixed(1)}`);
    if (stats.swStrikePct != null)        sc.push(`SwStr% ${stats.swStrikePct.toFixed(1)}`);
    if (sc.length) statBits.push(`Statcast: ${sc.join(', ')}`);

    parts.push(statBits.join(' | '));
    return '- ' + parts.join(' | ');
  };

  // 3. Pull all the data we need: roster, available pool, stats, status
  try {
    // All players that have stats
    const [allBatters, allPitchers, allStatus] = await Promise.all([
      db.select().from(batterStats).where(eq(batterStats.season, currentSeason)),
      db.select().from(pitcherStats).where(eq(pitcherStats.season, currentSeason)),
      db.select().from(playerStatus),
    ]);

    const battersByPid = new Map<number, any>();
    allBatters.forEach(b => {
      // If multiple sources, merge them — fangraphs takes priority for non-null fields
      const existing = battersByPid.get(b.playerId);
      if (!existing || (b.dataSource === 'fangraphs' && existing.dataSource !== 'fangraphs')) {
        battersByPid.set(b.playerId, b);
      }
    });
    const pitchersByPid = new Map<number, any>();
    allPitchers.forEach(p => {
      const existing = pitchersByPid.get(p.playerId);
      if (!existing || (p.dataSource === 'fangraphs' && existing.dataSource !== 'fangraphs')) {
        pitchersByPid.set(p.playerId, p);
      }
    });
    const statusByPid = new Map<number, any>();
    allStatus.forEach(s => statusByPid.set(s.playerId, s));

    // Roster
    const myRoster = await db.select().from(players).where(eq(players.status, 'mine'));
    if (myRoster.length > 0) {
      const lines: string[] = [];
      for (const p of myRoster) {
        const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay);
        const stats  = isPitcher ? pitchersByPid.get(p.id) : battersByPid.get(p.id);
        const status = statusByPid.get(p.id);
        const line = isPitcher
          ? await formatPitcherLine(p, stats, status)
          : await formatBatterLine(p, stats, status);
        lines.push(line);
      }
      sections.push(`## User's Roster (${myRoster.length} players)
${lines.join('\n')}`);
    }

    // Available player pool — limit to players with actual data so the AI
    // can only recommend from real options
    const available = await db.select().from(players).where(eq(players.status, 'available'));

    // Filter to those with stats AND not on long-term IL
    const eligibleAvailable = available.filter(p => {
      const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay);
      const hasStats = isPitcher ? pitchersByPid.has(p.id) : battersByPid.has(p.id);
      if (!hasStats) return false;
      const status = statusByPid.get(p.id);
      // Skip 60-day IL — they're not relevant
      if (status?.injuryStatus === 'IL60') return false;
      return true;
    });

    // Sort by consensus rank, take top 60
    const topAvailable = eligibleAvailable
      .sort((a, b) => (a.consensusRank ?? 9999) - (b.consensusRank ?? 9999))
      .slice(0, 60);

    if (topAvailable.length > 0) {
      const lines: string[] = [];
      for (const p of topAvailable) {
        const isPitcher = ['SP', 'RP', 'P'].includes(p.posDisplay);
        const stats  = isPitcher ? pitchersByPid.get(p.id) : battersByPid.get(p.id);
        const status = statusByPid.get(p.id);
        const line = isPitcher
          ? await formatPitcherLine(p, stats, status)
          : await formatBatterLine(p, stats, status);
        lines.push(line);
      }
      sections.push(`## Available Players With Current Data (top ${topAvailable.length})
These are the ONLY players you should consider when recommending adds. Players not in this list either don't exist in the user's player pool, are on the 60-day IL, or don't have current data.

${lines.join('\n')}`);
    }

    // Players user has tagged
    const tagged = available.filter(p => p.tags && p.tags.length > 0).slice(0, 25);
    if (tagged.length > 0) {
      const lines = tagged.map(p => `- **${p.name}** (${p.posDisplay}, ${p.team ?? '?'}) — user tagged: ${p.tags}`);
      sections.push(`## User's Tagged Players
${lines.join('\n')}`);
    }
  } catch (e) {
    console.error('Error building context:', e);
  }

  if (sections.length === 0) {
    return '(No user-specific data available yet — sync your Yahoo league and add players to your roster.)';
  }

  return sections.join('\n\n');
}

async function loadConversationHistory(
  userId: number,
  sessionId: string,
  limit = 20
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(
      eq(aiConversations.userId, userId),
      eq(aiConversations.sessionId, sessionId),
    ))
    .orderBy(desc(aiConversations.createdAt))
    .limit(limit);

  return rows.reverse().map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content,
  }));
}

async function saveMessage(params: {
  userId:      number;
  sessionId:   string;
  role:        'user' | 'assistant';
  content:     string;
  pageContext: string;
  modelUsed?:  string;
  tokensIn?:   number;
  tokensOut?:  number;
}) {
  await db.insert(aiConversations).values(params);
}

async function logUsage(params: {
  userId:       number;
  sessionId:    string;
  pageContext:  string;
  modelUsed:    string;
  tokensIn:     number;
  tokensOut:    number;
  responseMs:   number;
  success:      boolean;
  errorType?:   string;
}) {
  const pricing = MODEL_PRICING[params.modelUsed] ?? { input: 3.0, output: 15.0 };
  const costEstimate =
    (params.tokensIn  / 1_000_000) * pricing.input  +
    (params.tokensOut / 1_000_000) * pricing.output;
  await db.insert(aiUsage).values({ ...params, costEstimate });
}

export async function* askAIStream(input: AskAIInput): AsyncGenerator<StreamChunk, void, unknown> {
  if (!ANTHROPIC_API_KEY) {
    yield { type: 'error', content: 'AI is not configured.' };
    return;
  }

  const { userId, sessionId, question, pageContext } = input;
  const start = Date.now();

  try {
    const systemPrompt = buildSystemPrompt(pageContext);
    const userContext  = await buildUserContext(userId, pageContext);
    const history      = await loadConversationHistory(userId, sessionId);

    await saveMessage({
      userId, sessionId,
      role: 'user',
      content: question,
      pageContext,
    });

    const messages: { role: 'user' | 'assistant'; content: string }[] = [];

    if (history.length === 0) {
      messages.push({
        role: 'user',
        content: `# CURRENT DATA SNAPSHOT (use ONLY this data)

${userContext}

---

# MY QUESTION
${question}`,
      });
    } else {
      messages.push(...history);
      messages.push({ role: 'user', content: question });
    }

    let fullResponse = '';
    let tokensIn  = 0;
    let tokensOut = 0;

    const stream = await anthropic.messages.stream({
      model:      DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        fullResponse += chunk;
        yield { type: 'text', content: chunk };
      }
    }

    const finalMessage = await stream.finalMessage();
    tokensIn  = finalMessage.usage.input_tokens;
    tokensOut = finalMessage.usage.output_tokens;

    await saveMessage({
      userId, sessionId,
      role: 'assistant',
      content: fullResponse,
      pageContext,
      modelUsed: DEFAULT_MODEL,
      tokensIn,
      tokensOut,
    });

    await logUsage({
      userId, sessionId, pageContext,
      modelUsed:  DEFAULT_MODEL,
      tokensIn,   tokensOut,
      responseMs: Date.now() - start,
      success:    true,
    });

    yield { type: 'done', content: '' };
  } catch (err: any) {
    console.error('AI stream error:', err);
    try {
      await logUsage({
        userId,    sessionId,    pageContext,
        modelUsed: DEFAULT_MODEL,
        tokensIn:  0, tokensOut:  0,
        responseMs: Date.now() - start,
        success:   false,
        errorType: err.error?.type ?? err.name ?? 'unknown',
      });
    } catch {}
    yield {
      type:    'error',
      content: err.message ?? 'Something went wrong.',
    };
  }
}

export async function getConversationHistory(userId: number, sessionId: string) {
  return await db
    .select()
    .from(aiConversations)
    .where(and(
      eq(aiConversations.userId, userId),
      eq(aiConversations.sessionId, sessionId),
    ))
    .orderBy(aiConversations.createdAt);
}

export async function clearSession(userId: number, sessionId: string) {
  await db
    .delete(aiConversations)
    .where(and(
      eq(aiConversations.userId, userId),
      eq(aiConversations.sessionId, sessionId),
    ));
}

export function getSuggestedPrompts(pageContext: string): string[] {
  const prompts: Record<string, string[]> = {
    dashboard: [
      'Analyze my roster — strengths and weaknesses?',
      "Who's the best available player I should target?",
      'What categories am I weakest in?',
    ],
    roster: [
      'Who is my weakest hitter? Sustainable replacements?',
      'Should I make any roster moves?',
      'Which of my guys are sell-high candidates?',
    ],
    waiver: [
      'Best sustainable add for my team?',
      'Streamer recommendations for this week?',
      'Find me a breakout candidate from this list',
    ],
    players: [
      'Who has elite advanced metrics right now?',
      'Find me a sleeper at second base',
      'Which pitchers have nasty stuff?',
    ],
    bypos: [
      'Best available player at each position?',
      'Where am I weakest positionally?',
      'Which positions have the most depth?',
    ],
    cheat: [
      'What strategies should I prioritize?',
      'Help me think through my draft approach',
      'Red flags to watch for at my pick?',
    ],
    rounds: [
      'What positions should I target this round?',
      'Who fits my needs at this pick?',
      'Reach or wait for next round?',
    ],
    yahoo: [
      'How is my roster looking after sync?',
      'What should I focus on this week?',
      'Analyze my team based on Yahoo data',
    ],
  };
  return prompts[pageContext] ?? prompts.dashboard;
}
