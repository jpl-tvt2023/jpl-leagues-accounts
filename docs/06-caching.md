# 06 · Caching

Three Upstash Redis layers handle different latency vs freshness tradeoffs. All live in [`src/lib/sports/fpl/cache.ts`](../src/lib/sports/fpl/cache.ts).

| Layer | Keys | TTL | Written by | Read by | Invalidation |
|---|---|---|---|---|---|
| **FPL score cache** | `fpl:{leagueId}:gw{N}:{fplId}` | 24h | `calculateTeamGameweekScore` after FPL fetch | scoring handler, standings hit-penalty loop | TTL only |
| **Live GW cache** | `live:gw:{N}:league:{leagueId}` | 10 min | `setLiveCachedScores` after a manual refresh / `/api/fixtures/live` cold fetch | Fixtures page (in-progress GWs) | TTL only; `clearLiveCache` called per-GW at the start of `processOneLeagueOneGw` |
| **Page cache** | `standings:{leagueId}`, `fixtures:{leagueId}`, `playoffs:{leagueId}` | 25h | The corresponding GET routes after a successful build | Same routes on next request | `invalidateLeaguePageCache(leagueId)` — called by every score/advance/generate handler |

## How a typical request flows

A GET to `/api/standings?leagueSlug=tvt-fpl-32teams`:

1. Resolve `leagueSlug` → `leagueId`.
2. `getCachedStandings(leagueId)` — returns the cached blob if present. **Most reads stop here**.
3. Cache miss → compute from DB:
   - `db.query.teams.findMany({ where: eq(teams.leagueId, leagueId), with: { homeFixtures, awayFixtures, ... } })` — single relational query.
   - For each processed GW: `getAllCachedScores(gw, leagueId)` to read per-player FPL scores. On cache miss, fall through to parallel FPL fetches via `calculateTeamGameweekScore` (which caches as it goes).
   - Compute hit penalties, bonus points, chip points, sort.
4. Return the response and fire-and-forget `setCachedStandings(leagueId, responseData)`.

## Invalidation triggers

Every write that affects displayed data calls `invalidateLeaguePageCache(leagueId)`:

- Score handler ([`gameweeks/[gw]/route.ts`](../src/app/api/gameweeks/[gw]/route.ts)) — after results are persisted.
- Advance handler ([`advance-playoffs/route.ts`](../src/app/api/admin/[leagueId]/advance-playoffs/route.ts)) — after tie resolutions and next-round inserts.
- Generate handlers — after bracket creation.
- Bulk-upload handlers (teams, fixtures, captains, chips) — after imports.
- Per-team admin operations (create-team, delete-team, update-team, override-captain, override-chips, etc.).

The invalidation is a single `r.del(...)` call deleting three keys at once. Next request rebuilds and re-caches.

## What's NOT cached

- The `bootstrap-static` FPL response (fetched fresh per `/plan` run).
- Per-team `gameweekCaptains` / `gameweekChips` rows (read fresh from DB on every standings/dashboard request).
- The Hall of Champions winners endpoint (`/api/playoffs/winners`) — it's cheap enough to compute every request.

## TTLs explained

- **FPL score cache: 24h** — FPL `entry_history.points` numbers can shift slightly after the initial `finished=true` flip (bonus point reconciliation 1-2 days later). A 24h TTL means most reads after the initial scoring run will be from cache; the next-day cron pulls fresh data and overwrites.
- **Live GW cache: 10 min** — during a live GW, the public Fixtures page polls `/api/fixtures/live` periodically. Frequent enough to feel live without hammering FPL.
- **Page cache: 25h** — slightly longer than the typical 24h auto-processing cycle, so the cache is always warm when admins check standings the day after.

## Rate-limit keys

The middleware uses Upstash keys for rate limiting too: `rl:{routeLabel}:{key}` where key is either the IP (anonymous endpoints) or the session ID (admin endpoints). 60-second windows. See [`middleware.ts`](../src/middleware.ts).

## Fallback behaviour

`getRedis()` returns `null` if Upstash creds aren't set. All cache helpers return `null` / no-op in that case. The app still works — every read recomputes from DB and every rate-limited route passes through. Useful for local dev without Upstash.

## See also

- [04-scoring-pipeline.md](04-scoring-pipeline.md) — when the score handler invalidates the page cache.
- [05-auto-processing.md](05-auto-processing.md) — when the live-GW cache gets cleared.
