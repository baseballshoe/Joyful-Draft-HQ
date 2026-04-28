// server/yahoo-cache.ts
// ─────────────────────────────────────────────────────────────────────
// TTL-aware cache wrapper around the yahoo_cache table.
//
// Note: despite the "yahoo" naming (historical), this is a generic
// key/jsonb/timestamp cache. v1.2 added MLB schedule + probables keys.
// v1.3 adds MLB player metadata keys for runtime lookups.
//
// Design:
//   - Every cached external API call goes through getCached()
//   - If cached value is fresher than its TTL, return it immediately
//   - Otherwise call the fetcher, store the result, return it
//   - Pages call the API endpoints freely — auto-sync is transparent
// ─────────────────────────────────────────────────────────────────────
import { db } from './db';
import { yahooCache } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * TTL config (in seconds) per exact cache key.
 */
export const CACHE_TTL_SEC: Record<string, number> = {
  // Yahoo data (v1.0)
  'settings':       60 * 60 * 24,   // 24h
  'rosters':        60 * 15,        // 15 min
  'my-roster':      60 * 5,         // 5 min
  'standings':      60 * 30,        // 30 min
  'scoreboard':     60 * 5,         // 5 min
  'waivers:B':      60 * 10,        // 10 min
  'waivers:P':      60 * 10,
  'transactions':   60 * 5,         // 5 min
};

/**
 * TTL config (in seconds) per cache key PREFIX. Used for dynamic keys
 * (e.g. `mlb:schedule:2026-04-28:2026-05-04` — date range varies, so
 * exact match doesn't work). First matching prefix wins.
 *
 * v1.2 — schedule layer:
 *   - mlb:schedule:*   week schedule (24h cache)
 *   - mlb:probables:*  probable pitchers (1h cache)
 *
 * v1.3 — player roster layer:
 *   - mlb:player:*           single player lookup by MLBAM ID (24h)
 *   - mlb:players:active:*   full active roster snapshot (24h)
 */
export const CACHE_TTL_PREFIXES: Record<string, number> = {
  'mlb:schedule:':         60 * 60 * 24,   // 24h
  'mlb:probables:':        60 * 60,        // 1h
  'mlb:player:':           60 * 60 * 24,   // 24h
  'mlb:players:active:':   60 * 60 * 24,   // 24h
};

const DEFAULT_TTL = 60 * 10;

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

  const fresh = await fetcher();
  await setCache(cacheKey, fresh);

  return {
    data: fresh,
    meta: { fetchedAt: new Date(), ageSec: 0, fresh: true, ttlSec: ttl },
  };
}

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

export async function setCache(cacheKey: string, data: unknown): Promise<void> {
  await db
    .insert(yahooCache)
    .values({ cacheKey, data: data as any, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: yahooCache.cacheKey,
      set:    { data: data as any, fetchedAt: new Date() },
    });
}

export async function invalidateCache(cacheKey?: string): Promise<void> {
  if (cacheKey) {
    await db.delete(yahooCache).where(eq(yahooCache.cacheKey, cacheKey));
  } else {
    await db.delete(yahooCache);
  }
}

export async function getCacheStatus(): Promise<Record<string, CacheMetadata | null>> {
  const rows = await db.select().from(yahooCache);
  const out: Record<string, CacheMetadata | null> = {};
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
