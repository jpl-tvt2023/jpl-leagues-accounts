# Environments

## This repository: jpl-leagues-accounts

This repo carries the accounts and membership work ([10-accounts-and-membership.md](10-accounts-and-membership.md)). It runs on its **own** stack, so nothing here can reach production:

| Tier | Database | Redis | Google sign-in | Runs on |
|---|---|---|---|---|
| **Local test** | `file:./test.db` | none (optional test Upstash) | test sign-in (`TEST_AUTH_ENABLED=1`, set in `.env.test`) | `localhost:3100` |
| **Local dev** | `file:./dev.db`, or the accounts Turso DB | none | a dev OAuth client for `http://localhost:3000` | `localhost:3000` |
| **Accounts deployment** | Turso **`jpl-india`** | none for now | its own OAuth client | Vercel project **`jpl-india`** |

Guardrails:
- `src/lib/db/target-guard.ts` refuses every database except a local `file:` one or `jpl-india`. That covers the app, `drizzle-kit`, and the 0025 apply script.
- Git `upstream` (the production repo) is fetch-only: its push URL is deliberately invalid.
- Never copy production's `.env.local` into this repo.
- If you add Redis, give it a **new** Upstash database. Never share production's: the `fpl:scoring-active` lock below is global.

**Previews and Google.** Google only accepts redirect URIs registered exactly, and preview URLs change per deployment. So previews sign people in through `POST /api/test-auth/signin` with `TEST_AUTH_ENABLED=1`, set in the **Preview** scope only. The route also refuses to run when `VERCEL_ENV=production`.

The rest of this page describes the production repository's tiers.

---

Three tiers, each with its own database and its own Redis. Nothing is shared
between them, and the reasons for that are worth understanding before you wire
up a fourth.

| Tier | Database | Redis | FPL | Runs on |
|---|---|---|---|---|
| **Local test** | `file:./test.db` | optional test Upstash | in-app stub | `localhost:3100` |
| **Staging** | Turso `jpl-leagues-staging` (copy of prod) | staging Upstash | **real** | Vercel Preview |
| **Production** | Turso `jpl-leagues` | production Upstash | **real** | Vercel Production |

## Why separate Redis per tier

Not every cache key is league-scoped. `fpl:scoring-active`, `fpl:bootstrap:latest`
and `rl:*` are global, and the staging database is a *copy* of production — so it
reuses production's league UUIDs, which means even the league-scoped keys would
alias.

The sharp edge is the scoring lock. `fpl:scoring-active` makes every background
FPL call refuse for 120 seconds so that scoring gets the whole rate-limit budget
(see [04-scoring-pipeline.md](04-scoring-pipeline.md)). On a shared Redis, a
staging scoring run would silently switch production's live scores off for two
minutes. Sharing one database across tiers is not a small economy; it is a
production incident waiting for a coincidence.

---

## Local test

`.env.test` is **committed** — it holds only a SQLite path and a throwaway
session secret, so a new contributor can run the suite with no accounts and no
setup:

```sh
npm run test:reset      # wipe + reapply schema + seed superadmin
npm run test:e2e        # Playwright
npm run test:unit       # node --test via tsx
```

All FPL traffic is served by an in-app deterministic stub
(`src/app/api/test-fpl-stub/`), pointed to by `FPL_BASE_URL`. The gateway refuses
to reach the real FPL API when `TEST_FPL_STUB=1`, so a misconfigured run fails
loudly instead of quietly generating live traffic.

### Adding a test Redis (optional)

Most of the suite does not need one. The caching, single-flight and scoring-lock
paths do — without Redis every helper in `fpl-cache.ts` no-ops, so
`tests/league-types/redis-paths.spec.ts` skips.

To enable: create a **dedicated** Upstash database, then

```sh
cp .env.test.local.example .env.test.local   # fill in, then set TEST_REDIS_CONFIRM=1
```

`.env.test.local` is gitignored and is loaded **first**, so its values override
the blanks in `.env.test`. Never put real tokens in `.env.test` itself — that file
is force-included in `.gitignore` and would be pushed.

Two things to know:

- **`npm run test:reset` runs `FLUSHDB`** against whatever Redis is configured.
  Page caches live for 25 hours, so without the flush a database wipe leaves the
  previous run's caches serving leagues that no longer exist. It refuses to run
  without `TEST_REDIS_CONFIRM=1`, which is the only thing standing between the
  script and a mis-pasted production URL.
- **`RATE_LIMIT_ENABLED=0` is set in `.env.test`** and must stay that way. The
  limiter keys off Redis, and the suite drives every request from one IP while
  signing in up to 32 teams in a single `beforeAll` — against a 5/min cap on
  `/api/auth/signin`. Configure a test Redis without this flag and every spec
  starts failing with 429s.

The flag is deliberately explicit rather than derived from `NODE_ENV`: `next dev`
forces `NODE_ENV=development` no matter what the env file says, which is the same
trap that once made the FPL stub route silently 404 every request.

---

## Staging

A Vercel **Preview** deployment pointed at a copy of production. It exists to
answer one question that no local test can: does the new code render correctly
against real data, and does it still match the current live site everywhere it
should? The test suite runs on synthetic fixtures with fake FPL IDs, so it cannot
tell you whether the real 32-team standings table still looks right.

### Variables (Preview scope only)

Set in Vercel → Settings → Environment Variables, with **only** the Preview
checkbox ticked:

| Variable | Value |
|---|---|
| `DATABASE_URL` | staging Turso `libsql://…` |
| `TURSO_AUTH_TOKEN` | staging token — never production's |
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | staging Upstash REST pair |
| `SESSION_SECRET` | **different** random value, ≥32 chars |
| `CRON_SECRET` | different value, or omit |

`DATABASE_URL` is what actually redirects the deployment: it resolves *before*
`TURSO_CONNECTION_URL` (`src/lib/db/index.ts`), so setting it is enough even
though production is configured through the `TURSO_*` pair.

`SESSION_SECRET` must differ. Sharing production's would make production session
cookies valid on staging, and vice versa. Below 32 characters `src/lib/auth.ts`
throws — lazily, so it surfaces as a 500 on the first authenticated request
rather than a build failure.

`CRON_SECRET` is an **admin master key**: `src/middleware.ts` accepts it in place
of a session on every `/api/admin/*` route. Never reuse production's.

Do **not** set `TEST_FPL_STUB` or `FPL_BASE_URL` on staging. The stub keeps state
on `globalThis` and cannot work across serverless instances, and the flag would
expose `/api/test-fpl-stub/*` publicly. Staging uses real FPL — that is the point.

### Creating the staging database

Copying a Turso database is CLI-only; the dashboard only visualises branch
lineage after the fact.

```sh
turso db create jpl-leagues-staging --from-db jpl-leagues   # copy-on-write, seconds
turso db show   jpl-leagues-staging                          # the libsql:// URL
turso db tokens create jpl-leagues-staging                   # the auth token
```

Schema is applied by hand — there is no migrate-on-deploy hook — so after any
schema change remember to `db:push` against staging as well as production.

⚠️ The copy contains **real participant data**. Give it its own token and keep the
URL private.

### Reaching a preview URL

Push a branch; Vercel builds a Preview. If the URL returns a Vercel SSO page,
that is Deployment Protection — log in with an account on the project, or disable
protection for Preview in Settings.

### Prove the isolation before trusting anything

A staging site accidentally pointed at production would pass every parity check
while proving nothing. So, first:

1. On the preview URL, sign in and **rename a team**.
2. Confirm production still shows the old name.
3. Confirm the staging Upstash key count grows while production's does not.

---

## Known hazard: local dev points at production

`.env.local` holds **production** Turso and Upstash credentials, so
`npm run dev` reads and writes the live database and the live cache — including
the global `fpl:scoring-active` key, which means a local scoring run can suppress
production's live scores for two minutes.

This is deliberate (it is how the app has always been run locally) but it is a
loaded gun. For anything that writes, prefer:

```sh
npm run db:push:dev && npm run seed:dev   # local dev.db via .env.dev
```

If you only need to read production data, that is what staging is for.
