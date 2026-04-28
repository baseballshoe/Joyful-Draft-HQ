// server/yahoo-cache.ts
// ─────────────────────────────────────────────────────────────────────
// TTL-aware cache wrapper around the yahoo_cache table.
//
// Note: despite the "yahoo" naming (historical), this is a generic
// key/jsonb/timestamp cache. v1.2 adds MLB schedule + probables keys
// alongside Yahoo data — same table, different key prefixes.
//
// Design:
//   - Every cached external API call goes through getCached()
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
 * TTL config (in seconds) per exact cache key.
 * Tuned for the access patterns of each data type — e.g. settings
 * almost never change so we cache them aggressively, while the
 * scoreboard updates during games and needs to feel live.
 */
export const CACHE_TTL_SEC: Record<string, number> = {
  // Yahoo data (existing)
  'settings':       60 * 60 * 24,   // 24h — categories/roster slots rarely change
  'rosters':        60 * 15,        // 15 min — opponents may set lineups
  'my-roster':      60 * 5,         // 5 min — user might tweak their own
  'standings':      60 * 30,        // 30 min — updates after games
  'scoreboard':     60 * 5,         // 5 min — feels live during slates
  'waivers:B':      60 * 10,        // 10 min — adds/drops happen all day
  'waivers:P':      60 * 10,
  'transactions':   60 * 5,         // 5 min — news ticker feel
};

/**
 * TTL config (in seconds) per cache key PREFIX. Used for dynamic keys
 * (e.g. `mlb:schedule:2026-04-28:2026-05-04` — date range varies, so
 * exact match doesn't work). First matching prefix wins.
 *
 * v1.2 additions for MLB schedule layer:
 *   - mlb:schedule:* — week schedule, 24h cache (rarely changes)
 *   - mlb:probables:* — probable pitchers, 1h cache (lineups can shift)
 */
export const CACHE_TTL_PREFIXES: Record<string, number> = {
  'mlb:schedule:':   60 * 60 * 24,   // 24h
  'mlb:probables:':  60 * 60,        // 1h
};

const DEFAULT_TTL = 60 * 10;        // 10 min for any unrecognised key

/** Resolve TTL for a given cache key — exact match → prefix match → default. */
function getTTL(cacheKey: string): number {
  if (CACHE_TTL_SEC[cacheKey] !== undefined) return CACHE_TTL_SEC[cacheKey];
  for (const prefix of Object.keys(CACHE_TTL_PREFIXES)) {
    if (cacheKey.startsWith(prefix)) return CACHE_TTL_PREFIXES[prefix];
  }
  return DEFAULT_TTL;
}

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
 * @param fetcher    Async fn that fetches fresh data from the source
 * @param opts.force If true, bypass cache and refetch
 */
export async function getCached<T>(
  cacheKey: string,
  fetcher:  () => Promise<T>,
  opts:     { force?: boolean } = {},
): Promise<{ data: T; meta: CacheMetadata }> {
  const ttl = getTTL(cacheKey);

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

  const ttl = getTTL(cacheKey);
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

  // Pre-populate exact-match keys with null
  for (const key of Object.keys(CACHE_TTL_SEC)) out[key] = null;

  for (const row of rows) {
    const ttl = getTTL(row.cacheKey);
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
