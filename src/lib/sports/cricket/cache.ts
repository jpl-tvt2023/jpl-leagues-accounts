/**
 * Cricket's own Redis cache (prefix `crk:`), separate from every FPL key so neither can evict or
 * read the other's entries. Keys carry the tournament's data version and the league's state
 * version, so an upload or a sale makes old entries unreachable instead of needing an explicit
 * invalidation. Works (uncached) without Redis.
 */

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!redis && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  }
  return redis;
}

const TTL_SECONDS = 3600;

export function leagueViewKey(leagueId: string, dataVersion: number, stateVersion: number): string {
  return `crk:league:v1:${leagueId}:d${dataVersion}:s${stateVersion}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return (await r.get<T>(key)) ?? null;
  } catch (err) {
    console.error("cricket cache get failed:", err);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, value, { ex: TTL_SECONDS });
  } catch (err) {
    console.error("cricket cache set failed:", err);
  }
}
