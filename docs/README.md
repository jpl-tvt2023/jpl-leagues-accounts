# JPL India — Engineering Handbook

This is the technical companion to [`PROJECT.md`](../PROJECT.md). It covers how the platform is built, how its parts fit together, and the engineering decisions worth knowing before changing the code.

The stack is intentionally lean: Next.js 16 (App Router) on Vercel, Drizzle ORM over libSQL on Turso, Upstash Redis for caching + rate limiting, and the official Fantasy Premier League public API as the source of truth for player scores.

## Read in this order

1. **[01-architecture.md](01-architecture.md)** — stack overview, request flow, deployment model, environment variables.
2. **[02-data-model.md](02-data-model.md)** — every table in `src/lib/db/schema.ts`, what it stores, and how the core entities relate.
3. **[03-formats.md](03-formats.md)** — per-format implementation map. Where each format's scoring, generate, and advance logic live; how tie IDs map to playoff positions.
4. **[04-scoring-pipeline.md](04-scoring-pipeline.md)** — the score handler's internals (`POST /api/gameweeks/[gw]`) including FPL fetching, captain resolution, chip processing, and bonus/hit calculation.
5. **[05-auto-processing.md](05-auto-processing.md)** — the superadmin "Run Auto-Processing" flow. Per-GW unit of work, the 5 rate-limited expensive endpoints, idempotency guarantees.
6. **[06-caching.md](06-caching.md)** — the three Upstash cache layers, their TTLs, and the invalidation flow.
7. **[07-deployment.md](07-deployment.md)** — Vercel Hobby constraints, Turso/Upstash setup, env var checklist.
8. **[08-engineering-decisions.md](08-engineering-decisions.md)** — notable tradeoffs and why we made them.
9. **[09-environments.md](09-environments.md)** — the local test, staging and production tiers: what each one points at, why nothing is shared between them, and how to set up a new one.
10. **[10-accounts-and-membership.md](10-accounts-and-membership.md)** — how people sign in and play in many leagues: legacy vs members-mode leagues, `team_members`, how every team-scoped API resolves its team, and the guard that keeps this repo off production's database.

## Quick start for new engineers

```sh
cd jpl-leagues
cp .env.example .env.local            # fill in Turso + Upstash URLs
npm install
npm run db:push                       # apply schema to your Turso DB
npm run dev                           # http://localhost:3000
```

A local SQLite file (`dev.db`) is supported as an alternative to Turso for offline development — see [07-deployment.md](07-deployment.md).

## Where things live (one-pager)

| Concern | Path |
|---|---|
| App Router pages | `src/app/**` |
| Per-league public pages | `src/app/[leagueSlug]/**` |
| Admin dashboard | `src/app/admin/[leagueId]/page.tsx` |
| Superadmin dashboard | `src/app/superadmin/page.tsx` |
| Drizzle schema | `src/lib/db/schema.ts` |
| Auth + sessions | `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/viewer.ts` |
| Which team a request acts as | `src/lib/team-actor.ts` (see [10-accounts-and-membership.md](10-accounts-and-membership.md)) |
| Allowed databases | `src/lib/db/target-guard.ts` — local `file:` or the `jpl-india` Turso DB only |
| FPL client + cache | `src/lib/fpl.ts`, `src/lib/fpl-cache.ts` |
| Format scoring | `src/lib/formats/tvt/`, `src/lib/formats/continental-championship/`, `src/lib/formats/auction/` |
| Playoff windows + advance | `src/lib/playoffs/advance-windows.ts`, `src/app/api/admin/[leagueId]/advance-playoffs/route.ts` |
| Auto-processing orchestration | `src/lib/cron/process-all.ts` |
| Backup generation | `src/lib/backup/generate.ts`, `src/lib/backup/xlsx-zip.ts` |
| Format-aware palette | `src/lib/format-palette.ts` |
