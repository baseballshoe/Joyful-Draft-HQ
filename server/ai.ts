// server/ai.ts
// ─────────────────────────────────────────────────────────────────────
// Coach entry point — what server/routes.ts calls into.
//
// PHASE 2 v1.1 + v1.1a UPGRADES:
//   - Prompt caching: 3-block system prompt with cache_control on the
//     first two blocks. Cache hits cost 10% of base; reduces input
//     spend ~30-40% on follow-up turns within a session.
//   - Output cap at MAX_TOKENS (1500) — keeps Coach responses tight
//     and predictable.
//   - History truncation: only the last MAX_HISTORY_TURNS (8) get
//     replayed each turn. Prevents long sessions from blowing up cost.
//   - Lazy other-teams loading: context.ts now skips other-team rosters
//     unless the user's question hints at trades/league-wide questions.
//   - Telemetry: every turn writes to coach_interactions with full
//     cost breakdown (input / output / cache write / cache read), the
//     question bucket, and timing. Failures are non-fatal.
//
// Function exports preserved for routes.ts compatibility:
//   askAIStream, getConversationHistory, clearSession, getSuggestedPrompts
// ─────────────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';
import { aiConversations, aiUsage } from '@shared/schema';
import { eq, desc, and } from 'drizzle-orm';

import { buildCoachContext } from './coach/context';
import { BASEBALL_PROMPTS } from './coach/baseball';
import { categorize } from './coach/categorizer';
import { recordInteraction, recordError, calculateCost } from './coach/telemetry';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set — Coach will not work');
}

// Allow disabling cache during local development. Set DISABLE_CACHE=1
// when iterating on the personality/sport pack so changes don't get
// hidden by the 5-min cache.
const CACHE_ENABLED = process.env.DISABLE_CACHE !== '1';

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY ?? '' });

const DEFAULT_MODEL      = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS         = 1500;
const MAX_HISTORY_TURNS  = 8; // ~16 messages; older turns dropped each request

// ── Public types (preserved from v1.0) ────────────────────────────────────

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

// ── Streaming entry ───────────────────────────────────────────────────────

export async function* askAIStream(input: AskAIInput): AsyncGenerator<StreamChunk, void, unknown> {
  if (!ANTHROPIC_API_KEY) {
    yield { type: 'error', content: 'Coach is not configured (no API key).' };
    return;
  }

  const { userId, sessionId, question, pageContext } = input;
  const start = Date.now();

  // Categorize for telemetry — does not affect Coach behavior.
  const questionBucket = categorize(question);

  try {
    // Build 3-block context (staticPrefix / semiStaticBlock / volatileBlock)
    const ctx = await buildCoachContext({
      userId,
      pageContext,
      latestUserMessage: question, // drives lazy other-teams loading
    });

    // Persist user message immediately
    await saveMessage({
      userId, sessionId,
      role: 'user',
      content: question,
      pageContext,
    });

    // Load + truncate conversation history
    const history = await loadConversationHistory(userId, sessionId, MAX_HISTORY_TURNS * 2);
    const turnNumber = Math.floor(history.length / 2) + 1;

    // Build the messages array.
    //
    // STRATEGY: The data snapshot used to live in the first user message
    // ("turn 0"). With caching, we can do better — put ALL the league
    // context into the system parameter (where it can be cached), and
    // the messages array is purely the conversation.
    //
    // history already has the user's just-saved current message at the end.
    const messages = history.length > 0
      ? history.map(h => ({ role: h.role, content: h.content }))
      : [{ role: 'user' as const, content: question }];

    // Build the cacheable system parameter.
    // Two cache breakpoints: after staticPrefix and after semiStaticBlock.
    const systemParam = buildSystemParam(ctx);

    let fullResponse = '';
    let usage: {
      input_tokens:                  number;
      output_tokens:                 number;
      cache_creation_input_tokens?:  number;
      cache_read_input_tokens?:      number;
    } | null = null;

    const stream = await anthropic.messages.stream({
      model:      DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemParam,
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
    usage = {
      input_tokens:                 finalMessage.usage.input_tokens,
      output_tokens:                finalMessage.usage.output_tokens,
      cache_creation_input_tokens:  (finalMessage.usage as any).cache_creation_input_tokens,
      cache_read_input_tokens:      (finalMessage.usage as any).cache_read_input_tokens,
    };

    // Persist assistant response
    await saveMessage({
      userId, sessionId,
      role: 'assistant',
      content: fullResponse,
      pageContext,
      modelUsed: DEFAULT_MODEL,
      tokensIn:  usage.input_tokens,
      tokensOut: usage.output_tokens,
    });

    // Telemetry — primary record
    const costUsd = calculateCost(DEFAULT_MODEL, usage);
    await recordInteraction({
      userId,
      conversationId:   sessionId,
      turnNumber,
      userMessage:      question,
      assistantMessage: fullResponse,
      pageContext,
      questionBucket,
      model:            DEFAULT_MODEL,
      inputTokens:      usage.input_tokens,
      outputTokens:     usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens:     usage.cache_read_input_tokens ?? 0,
      costUsd,
      responseTimeMs:   Date.now() - start,
      errored:          false,
    });

    // Legacy aiUsage write (preserved for any existing dashboards/queries)
    await logUsage({
      userId, sessionId, pageContext,
      modelUsed:  DEFAULT_MODEL,
      tokensIn:   usage.input_tokens,
      tokensOut:  usage.output_tokens,
      responseMs: Date.now() - start,
      success:    true,
    });

    yield { type: 'done', content: '' };
  } catch (err: any) {
    console.error('[Coach] stream error:', err);

    // Telemetry — error record
    try {
      await recordError({
        userId,
        conversationId: sessionId,
        turnNumber: 0, // approx — true number requires a re-query we skip on error path
        userMessage: question,
        pageContext,
        questionBucket,
        model: DEFAULT_MODEL,
        errorMessage: err.message ?? String(err),
        responseTimeMs: Date.now() - start,
      });
    } catch {}

    // Legacy aiUsage error log
    try {
      await logUsage({
        userId, sessionId, pageContext,
        modelUsed:  DEFAULT_MODEL,
        tokensIn:   0,
        tokensOut:  0,
        responseMs: Date.now() - start,
        success:    false,
        errorType:  err.error?.type ?? err.name ?? 'unknown',
      });
    } catch {}

    yield {
      type:    'error',
      content: err.message ?? 'Something went sideways. Try again in a sec.',
    };
  }
}

// ── System parameter assembly with cache_control ──────────────────────────
//
// The Anthropic API accepts `system` as either a string OR an array of
// content blocks. With cache_control on a block, the API caches every
// token UP TO AND INCLUDING that block. Multiple cache_control markers
// = multiple breakpoints (max 4).
//
// Our shape:
//   [
//     { type: 'text', text: <staticPrefix>,    cache_control: ephemeral },
//     { type: 'text', text: <semiStaticBlock>, cache_control: ephemeral },
//     { type: 'text', text: <volatileBlock> }
//   ]
//
// Effect: on follow-up turns within ~5 min, both static prefix AND
// semi-static block get served from cache at 10% of base price.
// Volatile block is reprocessed each time (and that's fine — it's the
// fresh data).

function buildSystemParam(ctx: {
  staticPrefix:    string;
  semiStaticBlock: string;
  volatileBlock:   string;
}): any {
  if (!CACHE_ENABLED) {
    // Concat back to a string in dev mode for easier prompt iteration.
    return [
      ctx.staticPrefix,
      '',
      ctx.semiStaticBlock,
      '',
      ctx.volatileBlock,
    ].join('\n');
  }

  // Cacheable form
  return [
    {
      type: 'text',
      text: ctx.staticPrefix,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: ctx.semiStaticBlock,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: ctx.volatileBlock,
    },
  ];
}

// ── History helpers ───────────────────────────────────────────────────────

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

// ── Suggested prompts ─────────────────────────────────────────────────────

export function getSuggestedPrompts(pageContext: string): string[] {
  return BASEBALL_PROMPTS[pageContext] ?? BASEBALL_PROMPTS.dashboard;
}

// ── Internal ──────────────────────────────────────────────────────────────

/**
 * Load up to `limit` most recent messages, returned in chronological
 * order (oldest first) so they can be passed straight into Anthropic.
 *
 * MAX_HISTORY_TURNS * 2 default — each turn is a user msg + assistant
 * msg, so 8 turns = 16 rows.
 */
async function loadConversationHistory(
  userId: number,
  sessionId: string,
  limit = MAX_HISTORY_TURNS * 2,
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
    role:    r.role as 'user' | 'assistant',
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

/**
 * Legacy aiUsage logger — preserved for any existing dashboards or
 * queries that read from this table. Telemetry's coach_interactions
 * is the new canonical source, but we keep this writing for backwards
 * compat. Safe to remove once nothing reads aiUsage.
 */
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
  // Use Sonnet 4.5 input/output rates as a rough cost estimate for the
  // legacy table (it doesn't have cache columns).
  const costEstimate =
    (params.tokensIn  / 1_000_000) * 3.0 +
    (params.tokensOut / 1_000_000) * 15.0;
  try {
    await db.insert(aiUsage).values({ ...params, costEstimate });
  } catch (err) {
    console.error('[ai] Legacy aiUsage write failed:', err);
  }
}
