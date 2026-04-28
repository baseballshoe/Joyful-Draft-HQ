// server/coach/retention.ts
// ─────────────────────────────────────────────────────────────────────
// Retention policy for coach_interactions.
//
// Auto-deletes records older than RETENTION_DAYS. Runs on a 6-hour
// interval (idempotent + cheap, so frequency doesn't matter much).
//
// WHY 90 DAYS:
//   - Long enough to debug expensive turns from "last week" or "last
//     month" without losing data.
//   - Long enough to compute monthly cost trends and seasonal patterns.
//   - Short enough that we're not hoarding user prompts indefinitely.
//
// Tune RETENTION_DAYS below if needed. When Phase 2 multi-user lands,
// consider letting users opt for shorter retention (or instant delete)
// in their settings.
// ─────────────────────────────────────────────────────────────────────
import { db } from '../db';
import { coachInteractions } from '@shared/schema';
import { lt } from 'drizzle-orm';

const RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let schedulerStarted = false;

/**
 * Delete all coach_interactions rows older than RETENTION_DAYS.
 * Returns count of deleted rows.
 */
export async function runRetentionCleanup(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    const result = await db
      .delete(coachInteractions)
      .where(lt(coachInteractions.createdAt, cutoff))
      .returning({ id: coachInteractions.id });

    const count = result.length;
    if (count > 0) {
      console.log(`[retention] Deleted ${count} coach_interactions older than ${RETENTION_DAYS} days (before ${cutoff.toISOString()})`);
    }
    return { deleted: count };
  } catch (err) {
    console.error('[retention] Cleanup failed:', err);
    return { deleted: 0 };
  }
}

/**
 * Start the retention scheduler. Call this once from server startup
 * (typically server/index.ts or wherever you initialize background
 * jobs). Idempotent — safe to call multiple times, only schedules once.
 */
export function startRetentionScheduler(): void {
  if (schedulerStarted) {
    console.log('[retention] Scheduler already running, skipping');
    return;
  }
  schedulerStarted = true;

  console.log(`[retention] Starting scheduler — ${RETENTION_DAYS}-day retention, every ${CLEANUP_INTERVAL_MS / 1000 / 60 / 60}h`);

  // Run once on startup (after a small delay so it doesn't block boot)
  setTimeout(() => {
    runRetentionCleanup().catch(err =>
      console.error('[retention] Initial cleanup failed:', err)
    );
  }, 30_000);

  // Then run every CLEANUP_INTERVAL_MS
  setInterval(() => {
    runRetentionCleanup().catch(err =>
      console.error('[retention] Scheduled cleanup failed:', err)
    );
  }, CLEANUP_INTERVAL_MS);
}

/**
 * For an admin "delete this user's history" action (Phase 2 privacy).
 * Currently unused — drop this in once user settings page exists.
 */
export async function deleteUserHistory(userId: number): Promise<{ deleted: number }> {
  try {
    const { eq } = await import('drizzle-orm');
    const result = await db
      .delete(coachInteractions)
      .where(eq(coachInteractions.userId, userId))
      .returning({ id: coachInteractions.id });

    console.log(`[retention] Deleted ${result.length} interactions for user ${userId}`);
    return { deleted: result.length };
  } catch (err) {
    console.error('[retention] Failed to delete user history:', err);
    return { deleted: 0 };
  }
}
