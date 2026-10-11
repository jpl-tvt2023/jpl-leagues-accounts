# 07 · Deployment

The platform deploys as a single Next.js app on Vercel. There are no separate workers, queues, or background jobs.

## Vercel Hobby constraints (the box we built inside)

| Constraint | Limit | How we cope |
|---|---|---|
| Function timeout | 60 seconds | Every long-running operation is split into bounded units (see `processOneLeagueOneGw`). |
| Cron jobs | 2 per project | We don't use them. Auto-processing is browser-orchestrated. |
| Deployment Protection (Standard) | On by default; blocks internal `fetch` with HTML SSO | All internal handler invocations are in-process (no HTTP). |
| Build minutes / bandwidth | Generous on Hobby | Not a concern at our scale. |

Upgrading to Pro lifts the function timeout to 300s and unlocks Bypass-for-Automation, but the current architecture doesn't need either.

## Environment variables

Set these in Vercel Project Settings → Environment Variables (or in `.env.local` for development).

### Required for production

```
DATABASE_URL                          # libsql://... (Turso) or file:./dev.db (local)
TURSO_AUTH_TOKEN                      # Turso JWT (omit for local SQLite)
SESSION_SECRET                        # ≥32 byte random string for HMAC-SHA256 signing
UPSTASH_REDIS_REST_URL                # https://....upstash.io
UPSTASH_REDIS_REST_TOKEN              # Upstash REST token
GOOGLE_CLIENT_ID                      # Google OAuth client (see "Google sign-in" below)
GOOGLE_CLIENT_SECRET                  # its secret
AUTH_ORIGIN                           # this deployment's origin, e.g. https://jpl-india.vercel.app
```

`DATABASE_URL` must be the **`jpl-india`** Turso database or a local `file:` one. `src/lib/db/target-guard.ts` refuses anything else, production's `jpl-leagues` included.

### Optional

```
CRON_SECRET                           # Bearer token for the legacy /api/cron/process-scores route
VERCEL_GIT_COMMIT_SHA                 # Auto-set by Vercel; used in audit_logs descriptions
NEXT_PUBLIC_IOS_HANDOFF               # "1" turns on the iOS home-screen sign-in handoff — only if testing shows it's needed
TEST_AUTH_ENABLED                     # "1" enables POST /api/test-auth/signin. Tests and previews ONLY — never production
```

## Google sign-in

People sign in with Google ([10-accounts-and-membership.md](10-accounts-and-membership.md)). Each environment needs its own OAuth client, because Google only accepts redirect URIs registered exactly.

1. **Google Cloud Console → APIs & Services → OAuth consent screen.**
   - User type: External. App name "JPL India"; support email. Leave the app logo empty: uploading one makes Google require brand verification first.
   - App homepage: your site. **Privacy policy: `https://<your-domain>/privacy`**, which is required before you publish.
   - Scopes: only `openid`, `email` and `profile`. These are non-sensitive scopes, so Google needs no app verification review.
   - Publishing status: **In production**. While it's in Testing, only listed test users can sign in.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorised JavaScript origins: `https://<your-domain>`
   - Authorised redirect URIs: `https://<your-domain>/api/auth/google/callback`
   - For local development, add `http://localhost:3000` and `http://localhost:3000/api/auth/google/callback` to a *separate* dev client.
3. **Copy the client ID and secret** into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set `AUTH_ORIGIN=https://<your-domain>`.
   - Without `AUTH_ORIGIN`, the request's own origin is used, which is fine locally.
   - Behind a custom domain, set it, or the redirect URI won't match.

Vercel preview URLs change with every deployment, so they can't be registered. Previews sign people in with `TEST_AUTH_ENABLED=1` instead (see [09-environments.md](09-environments.md)).

If Google sign-in is not configured, the Continue with Google button lands back on `/signin` with a "not set up" message — and **nobody can sign in at all**: Google is the only way in, for admins and the superadmin too. There is no password fallback.

### The first superadmin

Admins are created from the superadmin page, so the very first superadmin is seeded from the command line, with no password. Their first Google sign-in with that email links the account:

```powershell
$env:DATABASE_URL = "libsql://jpl-india-<org>.<region>.turso.io"
$env:TURSO_AUTH_TOKEN = turso db tokens create jpl-india
$env:SUPERADMIN_EMAIL = "<the superadmin's Google account email>"
npm run seed:admin
```

It refuses any database but `jpl-india` or a local `file:` one, and is safe to run twice. Superadmins never play, so it won't promote an account that's already on a team.

### Failure modes when missing

- **`SESSION_SECRET` missing** → app throws on startup. Deliberate — no insecure default.
- **`DATABASE_URL` missing** → DB calls throw immediately.
- **`TURSO_AUTH_TOKEN` missing or wrong** → every query 401s while the app itself
  starts cleanly, so it looks like a data problem rather than a config one. Note the
  name: earlier revisions of this doc called it `DATABASE_AUTH_TOKEN`, which nothing
  has ever read.
- **`UPSTASH_REDIS_REST_URL/TOKEN` missing** → all caching + rate limiting is bypassed. App works, just slower (cold pages recompute from DB every request).
- **`CRON_SECRET` missing** → `/api/cron/process-scores` returns 500; everything else is fine (the cron route is an emergency-only fallback).

## Turso setup

1. Create a database at [turso.tech](https://turso.tech).
2. Run `turso db tokens create <db-name>` to generate `TURSO_AUTH_TOKEN`.
3. Use the `libsql://...` URL from the dashboard as `DATABASE_URL`.
4. Apply the schema:

   ```sh
   cd jpl-leagues
   npm run db:push
   ```

Migrations live in `drizzle/`. The current latest is `0005_flawless_zzzax.sql` (adds the `backups` table).

## Local SQLite alternative

For offline development:

```
DATABASE_URL=file:./dev.db
# omit TURSO_AUTH_TOKEN
```

Run `npm run db:push:dev` (uses `.env.dev`) and `npm run seed:dev` to populate. The same Drizzle schema applies cleanly.

## Upstash setup

1. Create a free Redis database at [upstash.com](https://console.upstash.com).
2. Choose **REST** access (not native TCP — we use the REST SDK).
3. Copy the REST URL + REST token into env vars.

Free tier covers our cache footprint comfortably (~10k operations/day).

Create it in the Upstash console, not from Vercel's Storage tab: that integration can name the variables `KV_…`, and the app reads only `UPSTASH_REDIS_REST_URL` / `_TOKEN`.

This deployment uses two databases, and neither may be production's (the `fpl:scoring-active` lock is global across everything sharing a database):

- **`jpl-india`** — the site. Set in Vercel for Production and Preview.
- **`jpl-india-test`** — the e2e suite, via the gitignored `.env.test.local` (see `.env.test.local.example`). `npm run test:reset` FLUSHes it, and the suite fills it with stub FPL data, so it must never be the site's database.

## FPL API

No setup required. The platform uses the public read-only FPL endpoints:

- `https://fantasy.premierleague.com/api/bootstrap-static/` — season events list (which GW is `finished`, `data_checked`, current `event` id).
- `https://fantasy.premierleague.com/api/entry/{fplId}/event/{gw}/picks/` — per-manager per-GW picks + scores.

No API key, but FPL applies soft rate limits (~100 req/min per IP). The platform parallelises within a GW + caches per (fplId, gw, leagueId) for 24h to stay well under.

## Removed: Vercel cron

Earlier versions ran a daily Vercel cron job at 09:00 IST that called `/api/cron/process-scores`. Multiple issues led to its removal:

1. Vercel Deployment Protection blocked inner `fetch` calls with HTML SSO redirects.
2. Hobby tier's 60s function timeout killed multi-league runs.
3. CRON_SECRET handling added auth complexity.

The replacement is the browser-orchestrated **Run Auto-Processing** button (see [05-auto-processing.md](05-auto-processing.md)). It's manual but solves all three problems by chunking work into per-(league, GW) calls.

The cron route still exists in code (`/api/cron/process-scores`) gated by `CRON_SECRET` for emergency curl invocations. `vercel.json` no longer schedules it.

## Build & deploy flow

```sh
git push origin main
```

Vercel auto-builds and deploys. Build steps:
1. `npm install`
2. `next build` (compiles app, generates `.next/`)
3. Deploy to Vercel CDN + serverless runtime.

A typical build takes ~90 seconds.

## Health checks

Easiest way to verify a deploy is alive:

- `GET https://your-deploy.vercel.app/api/leagues` should return JSON with the league list (no auth required).
- `GET https://your-deploy.vercel.app/` should serve the landing page HTML.
- `GET https://your-deploy.vercel.app/api/auth/me` returns `{ authenticated: false }` for an anonymous client.
- `GET https://your-deploy.vercel.app/api/auth/google` answers with a 307 redirect to `accounts.google.com`. A redirect back to `/signin?error=google_unavailable` means the Google env vars are missing.
- `POST https://your-deploy.vercel.app/api/test-auth/signin` must return **404** on production.

If any of these hang for >5 seconds, suspect a Turso or Upstash connectivity issue.

## See also

- [01-architecture.md](01-architecture.md) — what's running where.
- [05-auto-processing.md](05-auto-processing.md) — why we built around the 60s timeout instead of upgrading.
