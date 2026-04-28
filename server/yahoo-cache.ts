// server/yahoo-cache.ts
// ─────────────────────────────────────────────────────────────────────
// TTL-aware cache wrapper around the yahoo_cache table.
//
// Design:
//   - Every Yahoo API endpoint goes through getCached()
//   - If cached value is fresher than its TTL, return it immediately
//   - Otherwise call the fetcher, store the result, return it
//   - Pages call the API endpoints freely — auto-sync is transparent
//
// This is what enables "no manual sync button". Pages mount, hit the
// endpoint, and get fresh-ish data without anyone clicking anything.
// ─────────────────────────────────────────────────────────────────────
import { db } from './db';
import { yahooCache } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * TTL config (in seconds) per cache key.
 * Tuned for the access patterns of each data type — e.g. settings
 * almost never change so we cache them aggressively, while the
 * scoreboard updates during games and needs to feel live.
 */
export const CACHE_TTL_SEC: Record<string, number> = {
  'settings':       60 * 60 * 24,   // 24h — categories/roster slots rarely change
  'rosters':        60 * 15,        // 15 min — opponents may set lineups
  'my-roster':      60 * 5,         // 5 min — user might tweak their own
  'standings':      60 * 30,        // 30 min — updates after games
  'scoreboard':     60 * 5,         // 5 min — feels live during slates
  'waivers:B':      60 * 10,        // 10 min — adds/drops happen all day
  'waivers:P':      60 * 10,
  'transactions':   60 * 5,         // 5 min — news ticker feel
};

const DEFAULT_TTL = 60 * 10;        // 10 min for any unrecognised key

export interface CacheMetadata {
  fetchedAt: Date;
  ageSec:    number;
  fresh:     boolean;
  ttlSec:    number;
}

/**
 * Read a cached value if fresh; otherwise call fetcher and store result.
 *
 * @param cacheKey   Stable string key (see CACHE_TTL_SEC for known keys)
 * @param fetcher    Async fn that fetches fresh data from Yahoo
 * @param opts.force If true, bypass cache and refetch
 */
export async function getCached<T>(
  cacheKey: string,
  fetcher:  () => Promise<T>,
  opts:     { force?: boolean } = {},
): Promise<{ data: T; meta: CacheMetadata }> {
  const ttl = CACHE_TTL_SEC[cacheKey] ?? DEFAULT_TTL;

  if (!opts.force) {
    const [row] = await db
      .select()
      .from(yahooCache)
      .where(eq(yahooCache.cacheKey, cacheKey));

    if (row) {
      const ageSec = Math.floor((Date.now() - new Date(row.fetchedAt).getTime()) / 1000);
      if (ageSec < ttl) {
        return {
          data: row.data as T,
          meta: { fetchedAt: row.fetchedAt, ageSec, fresh: true, ttlSec: ttl },
        };
      }
    }
  }

  // Cache miss or stale — fetch fresh
  const fresh = await fetcher();
  await setCache(cacheKey, fresh);

  return {
    data: fresh,
    meta: { fetchedAt: new Date(), ageSec: 0, fresh: true, ttlSec: ttl },
  };
}

/**
 * Read whatever's in the cache, regardless of staleness. Returns null
 * if no entry exists. Used by Coach context-builder, which prefers
 * stale data over no data.
 */
export async function getCachedOrNull<T>(cacheKey: string): Promise<{ data: T; meta: CacheMetadata } | null> {
  const [row] = await db
    .select()
    .from(yahooCache)
    .where(eq(yahooCache.cacheKey, cacheKey));

  if (!row) return null;

  const ttl = CACHE_TTL_SEC[cacheKey] ?? DEFAULT_TTL;
  const ageSec = Math.floor((Date.now() - new Date(row.fetchedAt).getTime()) / 1000);

  return {
    data: row.data as T,
    meta: { fetchedAt: row.fetchedAt, ageSec, fresh: ageSec < ttl, ttlSec: ttl },
  };
}

/** Write a value to the cache, replacing any prior entry. */
export async function setCache(cacheKey: string, data: unknown): Promise<void> {
  await db
    .insert(yahooCache)
    .values({ cacheKey, data: data as any, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: yahooCache.cacheKey,
      set:    { data: data as any, fetchedAt: new Date() },
    });
}

/** Clear one or all cache entries. Useful after disconnects, league changes. */
export async function invalidateCache(cacheKey?: string): Promise<void> {
  if (cacheKey) {
    await db.delete(yahooCache).where(eq(yahooCache.cacheKey, cacheKey));
  } else {
    await db.delete(yahooCache);
  }
}

/** Snapshot of cache freshness across all keys, for an admin/debug panel. */
export async function getCacheStatus(): Promise<Record<string, CacheMetadata | null>> {
  const rows = await db.select().from(yahooCache);
  const out: Record<string, CacheMetadata | null> = {};
  for (const key of Object.keys(CACHE_TTL_SEC)) out[key] = null;
  for (const row of rows) {
    const ttl = CACHE_TTL_SEC[row.cacheKey] ?? DEFAULT_TTL;
    const ageSec = Math.floor((Date.now() - new Date(row.fetchedAt).getTime()) / 1000);
    out[row.cacheKey] = {
      fetchedAt: row.fetchedAt,
      ageSec,
      fresh: ageSec < ttl,
      ttlSec: ttl,
    };
  }
  return out;
}
