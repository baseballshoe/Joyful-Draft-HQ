// server/coach/baseball.ts
// ─────────────────────────────────────────────────────────────────────
// Baseball sport pack for Coach.
//
// Sport-specific knowledge: jargon Coach can sprinkle in, categories he's
// optimising for, what "good" looks like statistically, common pitfalls.
//
// When we add football: server/coach/football.ts with the same shape.
// ─────────────────────────────────────────────────────────────────────
import type { ParsedLeagueSettings } from '../yahoo';

/**
 * Sport-agnostic-shaped record describing what Coach knows about baseball.
 * The buildBaseballPack() function below renders this into prose for the
 * system prompt.
 */
const BASEBALL_KNOWLEDGE = {
  sport: 'fantasy baseball',

  // Jargon Coach can deploy naturally. NOT a checklist — these are flavour.
  jargon: [
    '"got the sword" — when a hitter takes a check swing or weak hack on a nasty pitch (esp. slider)',
    '"frozen rope" — hard line drive',
    '"painting the corners" — pitcher locating on the edges',
    '"cheese" / "high cheese" — high-90s fastball, esp. up in the zone',
    '"worm-burner" — weak ground ball',
    '"on the screws" — hit hard, barreled up',
    '"chasing junk" — swinging at breaking balls out of the zone',
    '"dealing" — pitcher rolling, dominant outing',
    '"in the books" — game over',
    '"back-end of the rotation" — #4/#5 starter, streamer territory',
    '"closer\'s closer" — elite ninth-inning guy',
    '"three true outcomes" — HR/BB/K-heavy hitter profile',
    '"hose" — strong throwing arm (catcher, OF)',
    '"hit tool" / "power tool" / "speed tool" — scouting grade language',
  ],

  // Categories the user's league cares about. Coach should think in these terms.
  categoriesPrimer: `
Standard 12-team H2H Categories baseball uses 5x5:
  Batting:  AVG, HR, R, RBI, SB
  Pitching: K, W (or QS), SV, ERA, WHIP

Some leagues swap W → QS (Quality Starts), which dramatically changes how
you value pitching — QS leagues reward consistency over win-vulture luck,
and #4/#5 starters become viable streamer fodder if they go 6 IP regularly.
The user's league uses categories specified in the live league settings.`.trim(),

  // What "good" looks like in 2026 — anchor points Coach can riff off
  goodLooksLike: `
Reasonable benchmarks for elite production at standard positions:

Batting:
  - Elite contact hitter: .290+ AVG, low K%, high contact rate
  - Elite power: 35+ HR pace, .250+ ISO, top-decile barrel rate (~12%+)
  - Elite speed: 30+ SB pace, plus sprint speed (28+ ft/sec)
  - Elite well-rounded (5-cat): .280/30 HR/90+ R/90+ RBI/15+ SB
  - Advanced reads: xwOBA, barrel%, hard-hit%, sweet-spot%, K%, BB%

Pitching:
  - Elite SP: sub-3.00 ERA, sub-1.10 WHIP, 30+ K%, low BB%, 25+ QS pace
  - Elite RP: sub-2.50 ERA, sub-1.00 WHIP, locked-in closer role
  - Advanced reads: xERA, FIP/SIERA, CSW%, swinging-strike%, chase%,
    fastball velo, spin rate, induced vertical break
  - "Stuff+" / "Pitching+" models — anything 110+ is plus-plus

Read xwOBA before AVG. Read FIP/SIERA before ERA. Outcomes lie; process
doesn't (much).`.trim(),

  // Common bad patterns Coach pushes back on
  redFlags: `
Things Coach calls out without being asked:

- BABIP-driven hot streak with no underlying batted-ball improvement
- ERA way under FIP/xERA — regression incoming
- Closer with shaky command and a manager who's already pulled the
  trigger on auditioning replacements
- Power surge with no barrel-rate improvement (lucky pulls / short porches)
- Pitcher with declining velo year-over-year, esp. early-season warning
- Veteran with chronic IL pattern who's "due" — usually isn't
- Holding underperformers from draft because of sunk-cost feelings`.trim(),
};

/**
 * Render the baseball pack into a string suitable for prepending to the
 * Coach system prompt. Optionally inject the user's actual league settings
 * if they're connected so Coach knows the EXACT categories.
 */
export function buildBaseballPack(opts: { settings?: ParsedLeagueSettings | null }): string {
  const sections: string[] = [];

  sections.push(`You're coaching ${BASEBALL_KNOWLEDGE.sport}.`);

  // Live league settings if available
  if (opts.settings && opts.settings.categories.length > 0) {
    const battingCats = opts.settings.categories
      .filter(c => c.positionType === 'B')
      .map(c => c.displayName);
    const pitchingCats = opts.settings.categories
      .filter(c => c.positionType === 'P')
      .map(c => c.displayName);

    sections.push(`# THIS USER'S LEAGUE CATEGORIES (use these — not generic 5x5)

Batting:  ${battingCats.length > 0 ? battingCats.join(', ') : '(unknown)'}
Pitching: ${pitchingCats.length > 0 ? pitchingCats.join(', ') : '(unknown)'}
Format:   ${opts.settings.scoringType ?? '(unknown)'} · ${opts.settings.numTeams ?? '?'} teams
${opts.settings.currentWeek ? `Current week: ${opts.settings.currentWeek}` : ''}`);
  } else {
    sections.push(`# CATEGORIES PRIMER\n\n${BASEBALL_KNOWLEDGE.categoriesPrimer}`);
  }

  sections.push(`# JARGON YOU CAN USE NATURALLY\n\n${BASEBALL_KNOWLEDGE.jargon.map(j => `- ${j}`).join('\n')}\n\nUse this stuff like a real human — sparingly, where it lands. Don't crowbar it in.`);

  sections.push(`# WHAT "GOOD" LOOKS LIKE\n\n${BASEBALL_KNOWLEDGE.goodLooksLike}`);

  sections.push(`# RED FLAGS YOU CALL OUT\n\n${BASEBALL_KNOWLEDGE.redFlags}`);

  return sections.join('\n\n');
}

/**
 * Suggested Coach starter prompts per page. Sport-specific so the voice
 * matches when these appear in the UI.
 */
export const BASEBALL_PROMPTS: Record<string, string[]> = {
  dashboard: [
    "Coach, give me the read on my team — where are we strong, where are we soft?",
    "Best available guy I should be targeting?",
    "Which categories am I getting smoked in?",
  ],
  roster: [
    "Coach, who's my weakest hitter? Who's a real replacement, not a streamer?",
    "Any sell-high guys on my roster right now?",
    "Should I be making a move this week?",
  ],
  waiver: [
    "Coach, best sustainable add for my team?",
    "Find me a streamer for this week's two-start guys",
    "Anyone on the wire with a real breakout profile?",
  ],
  players: [
    "Who's got the elite advanced numbers right now?",
    "Find me a sleeper at second base",
    "Which pitchers have actual nasty stuff?",
  ],
  bypos: [
    "Best available guy at each position?",
    "Where am I weakest positionally?",
    "Which positions have the most depth on the wire?",
  ],
  cheat: [
    "What strategies should I prioritise?",
    "Walk me through my draft approach",
    "Red flags to watch for at my pick?",
  ],
  rounds: [
    "What positions should I target this round?",
    "Who fits my needs at this pick?",
    "Reach now or wait for the next round?",
  ],
  yahoo: [
    "How's my roster looking after the sync?",
    "What should I focus on this week?",
    "Coach, give me the team analysis",
  ],
  matchup: [
    "Coach, how am I matching up this week?",
    "Where can I steal categories?",
    "Any streamers I should slot in for the matchup?",
  ],
  standings: [
    "Where do I stand and what's the path?",
    "Which categories should I punt or chase?",
    "Who's the team to beat and why?",
  ],
};
