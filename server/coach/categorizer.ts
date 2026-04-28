// server/coach/categorizer.ts
// ─────────────────────────────────────────────────────────────────────
// Lightweight regex-based question categorization for telemetry.
//
// Runs server-side on every turn, tags each interaction with a bucket
// for the admin dashboard. No model call — instant, free, ~80% accurate
// which is plenty for usage-pattern analysis.
//
// When buckets get noisy (some categories swallow too much, some are
// too narrow), we can upgrade to a Haiku classification call (~$0.001
// per turn) — but that's a v1.2 problem.
//
// Order matters: the first matching pattern wins. More specific
// patterns go above more general ones.
// ─────────────────────────────────────────────────────────────────────

export type QuestionBucket =
  | 'matchup_analysis'
  | 'trade_eval'
  | 'waiver_pickup'
  | 'drop_decision'
  | 'lineup_decision'
  | 'stat_question'
  | 'player_lookup'
  | 'general_strategy'
  | 'banter'
  | 'other';

interface BucketPattern {
  bucket: QuestionBucket;
  regex:  RegExp;
}

// Order matters — first match wins. Specific → general.
const PATTERNS: BucketPattern[] = [
  // Trade-related (very specific keywords)
  {
    bucket: 'trade_eval',
    regex:  /\b(trade|traded|trading|swap|fair (deal|trade|offer)|accept (this|the) (offer|trade|deal)|trade(d)? (for|away)|(send|give up) (.+) for|two.?for.?one)\b/i,
  },

  // Drop / cut / release decisions
  {
    bucket: 'drop_decision',
    regex:  /\b(drop|cut|release|waive|dump|let .+ go|dfa)\b/i,
  },

  // Waiver pickups
  {
    bucket: 'waiver_pickup',
    regex:  /\b(waiver|pickup|pick up|pick.?up|free agent|FA|add (?!up|on)|claim|stream (?:a |an )?(?:start|hitter|pitcher))\b/i,
  },

  // Lineup decisions (start/sit)
  {
    bucket: 'lineup_decision',
    regex:  /\b(start|sit|lineup|active|bench|who should i (start|play|sit)|start or sit|sit or start|set my lineup)\b/i,
  },

  // Matchup analysis
  {
    bucket: 'matchup_analysis',
    regex:  /\b(matchup|opponent|this week|am i winning|am i losing|categories i('m| am)|category .+ (lead|behind|tied)|cats? (am i|i'm) (winning|losing|leading|trailing|tied))\b/i,
  },

  // Stats deep-dives
  {
    bucket: 'stat_question',
    regex:  /\b(stats?|numbers?|x?wOBA|xBA|barrel(s|ed)?|exit velo|hard.?hit|whip|era|fip|siera|babip|war|spin rate|csw|swstr|sweet ?spot)\b/i,
  },

  // Player lookups (info on a specific guy)
  {
    bucket: 'player_lookup',
    regex:  /\b(who is|tell me about|info on|show me|how('s| is)|how('s| has) .+ (been|doing|looking|hitting|pitching)|what.+about)\b/i,
  },

  // Strategy / general advice
  {
    bucket: 'general_strategy',
    regex:  /\b(strategy|strategic|approach|game ?plan|advice|should i|what (do|would) you|recommend|where am i (weak|strong|short|deep)|weakness|strength)\b/i,
  },

  // Banter / acknowledgments / sport jargon checks
  {
    bucket: 'banter',
    regex:  /\b(thanks|thank you|cool|nice|haha|lol|good (one|call)|appreciate|fuck|shit|sword|cheese|frozen rope|painting (the )?corners?|chin music|gas|heater)\b/i,
  },
];

/**
 * Bucket a user message into a category. Returns 'other' if no
 * pattern matches.
 */
export function categorize(message: string): QuestionBucket {
  if (!message || typeof message !== 'string') return 'other';
  const trimmed = message.trim();
  if (!trimmed) return 'other';

  for (const { bucket, regex } of PATTERNS) {
    if (regex.test(trimmed)) return bucket;
  }
  return 'other';
}

/**
 * For dashboard display — human-readable label per bucket.
 */
export const BUCKET_LABELS: Record<QuestionBucket, string> = {
  matchup_analysis: 'Matchup analysis',
  trade_eval:       'Trade evaluation',
  waiver_pickup:    'Waiver pickup',
  drop_decision:    'Drop decision',
  lineup_decision:  'Lineup decision',
  stat_question:    'Stat question',
  player_lookup:    'Player lookup',
  general_strategy: 'General strategy',
  banter:           'Banter / chatter',
  other:            'Other',
};
