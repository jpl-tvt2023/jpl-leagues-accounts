/**
 * Cricket's own Redis cache (prefix `crk:`), separate from every FPL key so neither can evict or
 * read the other's entries. Keys carry the tournament's data version and the league's state
 * version, so an upload or a sale makes old entries unreachable instead of needing an explicit
 * invalidation. Works (uncached) without Redis.
 *
 * The client is the shared one (lib/redis.ts): while Upstash refuses, reads are misses and writes
 * are dropped without a round trip each, and the page is built from the database as it is when
 * Redis is not configured at all.
 */

import { cachedGet, cachedSet } from "@/lib/redis";

const TTL_SECONDS = 3600;

export function leagueViewKey(leagueId: string, dataVersion: number, stateVersion: number): string {
  return `crk:league:v2:${leagueId}:d${dataVersion}:s${stateVersion}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  return cachedGet<T>(key);
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  await cachedSet(key, value, TTL_SECONDS);
}
