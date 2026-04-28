// server/coach/telemetry.ts
// ─────────────────────────────────────────────────────────────────────
// Telemetry capture for the admin dashboard (v1.1a → v1.1b).
//
// Records every Coach turn into coach_interactions with:
//   - Full prompt + response text (option D — 90-day retention auto-deletes)
//   - Cost breakdown by token category (input / output / cache write / cache read)
//   - Performance (response time, errors)
//   - Categorization (page context, regex bucket)
//   - Conversation linkage (so we can analyse multi-turn sessions)
//
// Cost calculation includes prompt caching pricing — cache writes cost
// 1.25× base input, cache reads cost 0.10× base input. Without this,
// the dashboard would underestimate cost on cached turns and we'd think
// we're saving more than we are.
//
// All telemetry calls are wrapped so failures NEVER break the actual
// Coach response. If telemetry blows up, we log and move on.
// ─────────────────────────────────────────────────────────────────────
import { db } from '../db';
import { coachInteractions } from '@shared/schema';

// ── Pricing table ─────────────────────────────────────────────────────────
//
// Per-million-token rates ($USD), as of April 2026.
// Source: https://docs.claude.com/en/docs/about-claude/pricing
//
// IMPORTANT: keep this in sync with current Anthropic pricing. When
// pricing changes, only this file needs to update — the dashboard reads
// from the cost_usd column which was calculated at write-time.

interface ModelPricing {
  /** Standard input tokens per million USD */
  input:      number;
  /** Output tokens per million USD */
  output:     number;
  /** Cache write tokens per million USD (1.25× base input) */
  cacheWrite: number;
  /** Cache read tokens per million USD (0.10× base input) */
  cacheRead:  number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Sonnet 4.5 — current default
  'claude-sonnet-4-5-20250929': { input: 3.0,  output: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-4-5':          { input: 3.0,  output: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },

  // Sonnet 4.6
  'claude-sonnet-4-6':          { input: 3.0,  output: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },

  // Haiku 4.5 — for future cheap-routing experiments
  'claude-haiku-4-5-20251001':  { input: 1.0,  output: 5.0,  cacheWrite: 1.25,  cacheRead: 0.10 },
  'claude-haiku-4-5':           { input: 1.0,  output: 5.0,  cacheWrite: 1.25,  cacheRead: 0.10 },

  // Opus 4.6 / 4.7 — for future power-user features
  'claude-opus-4-7':            { input: 5.0,  output: 25.0, cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-opus-4-6':            { input: 5.0,  output: 25.0, cacheWrite: 6.25,  cacheRead: 0.50 },
};

const DEFAULT_PRICING: ModelPricing = MODEL_PRICING['claude-sonnet-4-5-20250929'];

// ── Cost calculator ───────────────────────────────────────────────────────

export interface UsageBreakdown {
  /** Standard input tokens (uncached). */
  input_tokens:                  number;
  /** Output tokens. */
  output_tokens:                 number;
  /** Tokens written to cache this turn (paid 1.25× rate). */
  cache_creation_input_tokens?:  number;
  /** Tokens read from cache this turn (paid 0.10× rate). */
  cache_read_input_tokens?:      number;
}

/**
 * Compute total $USD cost from a usage object. Defaults to Sonnet 4.5
 * pricing if the model isn't recognized.
 */
export function calculateCost(model: string, usage: UsageBreakdown): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  const M = 1_000_000;

  const cost =
    (usage.input_tokens                  / M) * p.input +
    (usage.output_tokens                 / M) * p.output +
    ((usage.cache_creation_input_tokens ?? 0) / M) * p.cacheWrite +
    ((usage.cache_read_input_tokens     ?? 0) / M) * p.cacheRead;

  return Number(cost.toFixed(6)); // micro-dollar precision
}

// ── Recording ─────────────────────────────────────────────────────────────

export interface RecordInteractionInput {
  userId:              number;
  conversationId:      string;
  turnNumber:          number;

  userMessage:         string;
  assistantMessage:    string;

  pageContext?:        string | null;
  questionBucket?:     string | null;

  model:               string;
  inputTokens:         number;
  outputTokens:        number;
  cacheCreationTokens?: number;
  cacheReadTokens?:     number;
  costUsd:             number;

  responseTimeMs?:     number;
  errored?:            boolean;
  errorMessage?:       string | null;
}

/**
 * Insert one row into coach_interactions. Failures are caught and
 * logged — telemetry must never break the actual response.
 */
export async function recordInteraction(input: RecordInteractionInput): Promise<void> {
  try {
    await db.insert(coachInteractions).values({
      userId:              input.userId,
      conversationId:      input.conversationId,
      turnNumber:          input.turnNumber,
      userMessage:         input.userMessage,
      assistantMessage:    input.assistantMessage,
      pageContext:         input.pageContext ?? null,
      questionBucket:      input.questionBucket ?? null,
      model:               input.model,
      inputTokens:         input.inputTokens,
      outputTokens:        input.outputTokens,
      cacheCreationTokens: input.cacheCreationTokens ?? 0,
      cacheReadTokens:     input.cacheReadTokens ?? 0,
      costUsd:             input.costUsd,
      responseTimeMs:      input.responseTimeMs ?? null,
      errored:             input.errored ?? false,
      errorMessage:        input.errorMessage ?? null,
    });
  } catch (err) {
    // Never let telemetry break the response.
    console.error('[telemetry] Failed to record interaction:', err);
  }
}

/**
 * Record a failed turn (no response generated). Used in the catch
 * branch of askAIStream to keep error rates visible in the dashboard.
 */
export async function recordError(input: {
  userId:         number;
  conversationId: string;
  turnNumber:     number;
  userMessage:    string;
  pageContext?:   string;
  questionBucket?: string;
  model:          string;
  errorMessage:   string;
  responseTimeMs?: number;
}): Promise<void> {
  return recordInteraction({
    userId:           input.userId,
    conversationId:   input.conversationId,
    turnNumber:       input.turnNumber,
    userMessage:      input.userMessage,
    assistantMessage: '',
    pageContext:      input.pageContext,
    questionBucket:   input.questionBucket,
    model:            input.model,
    inputTokens:      0,
    outputTokens:     0,
    costUsd:          0,
    responseTimeMs:   input.responseTimeMs,
    errored:          true,
    errorMessage:     input.errorMessage,
  });
}
