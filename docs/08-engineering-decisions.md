# 08 · Engineering decisions

This document captures the notable tradeoffs in the codebase. Each item is a short rationale for "why is it this way?" so a future engineer doesn't unwind a decision without understanding the constraint that drove it.

## 1. In-process handler calls (not internal HTTP)

The auto-processing orchestrator (`processOneLeagueOneGw`) imports the score / generate / advance route handlers directly and invokes them with a constructed `NextRequest`, rather than making same-origin `fetch` calls.

**Why:** Vercel Deployment Protection blocks internal HTTP roundtrips with an HTML SSO redirect, breaking JSON parsing on every call. The earlier `fetch`-based architecture also paid ~250ms of edge + middleware overhead per call, and ~70 calls per per-league run added up to minutes of pure roundtrip time.

In-process invocation costs ~microseconds, sidesteps the edge entirely, and reuses the same Drizzle connection pool. Helper: `callHandlerDirect(handler, url, ctx, opts)` in [`src/lib/sports/fpl/cron/process-all.ts`](../src/lib/sports/fpl/cron/process-all.ts).

## 2. Per-(league × GW) unit of work

The auto-processing loop fires one bounded HTTP call per `(league, gw)` pair instead of one per league (which would do all GWs server-side).

**Why:** Vercel Hobby's 60-second function ceiling. Per-league calls were occasionally blowing 60s for the largest formats (TVT-32 with advance work across 8 playoff GWs). Per-GW units are bounded ≤ ~15s on the worst day. They also give the user live progress updates as each chip flips state in the UI.

## 3. Fail-open rate limiter

`rateLimit()` in [`src/middleware.ts`](../src/middleware.ts) wraps the Upstash `incr`/`expire` calls in try/catch. On any Redis error, it returns `true` (allow the request) and logs the error.

**Why:** A rate limiter that crashes blocks all real traffic. Better to occasionally let through a request past the limit than to hang the entire app on a transient Upstash blip. The first version of this code didn't have the try/catch and caused a real outage when Upstash had a brief connectivity issue.

## 4. Idempotent advance + pre-flight skip

Every playoff advance helper (`resolve2LegTie`, `markLeg1Done`, `create2LegTie`) is idempotent — they short-circuit on `status="complete"` or use `onConflictDoNothing`. On top of that, `hasAdvanceWork(leagueId, gw)` queries `playoff_ties` for any tie not in `complete` status and **skips the dispatcher entirely** when there's nothing to do.

**Why:** The advance dispatcher does ~30 DB roundtrips per call (tie reads, getTie pairs, idempotent inserts). For a fully-caught-up league, that's wasted work. The pre-flight check is one cheap SQL query; on a fully-resolved league it shaves 10-15s per per-league run.

Idempotency itself matters because re-clicking "Run Auto-Processing" is the recovery mechanism for any error — we need it to always be safe.

## 5. FPL `finished` gate, not `data_checked`

The GW eligibility check in `computePlan` uses `events[gw].finished === true` as the trigger, not `events[gw].data_checked === true`.

**Why:** FPL flips `finished=true` immediately when all matches in the GW end. It flips `data_checked=true` 1-2 days later, after bonus points have been distributed. Gating on `data_checked` would delay scoring (and therefore advance) by up to 48 hours — too slow for users who want to see standings on Monday morning.

The tradeoff: scoring runs early and captures `entry_history.points` before bonus reconciliation. Re-running scoring after bonus reconciliation is supported via the per-league admin "Reprocess" button (force=true), but not automatic. This was an explicit decision: speed > full bonus accuracy on the day-of.

## 6. League-scoped DB queries everywhere

Every query that doesn't naturally include a leagueId now filters by it explicitly. Earlier versions had `/api/standings` and `/api/fixtures` loading **every team across every league** and filtering in memory.

**Why:** For multi-league deployments this meant the cold-cache load path made thousands of sequential FPL roundtrips (`processedGws` × `allFplIds`) and timed out. The fix is a `where: eq(teams.leagueId, leagueId)` clause at the top of the query. Five route files got this treatment in one pass.

## 7. Page cache as a single blob per league

`standings:{leagueId}`, `fixtures:{leagueId}`, `playoffs:{leagueId}` are JSON blobs in Upstash, populated on first compute, deleted on any write. 25-hour TTL.

**Why:** The Hall of Champions, standings table, and bracket views are the most-hit reads. Computing them from DB each time means thousands of joins for each visitor. The blob cache makes the typical read sub-100ms.

A smarter cache (per-row, per-section invalidation) would let us avoid full recomputes on small writes — but the current invalidation flow is dead simple and the recompute itself is fast enough that we haven't needed precision invalidation.

## 8. Backups stored as JSON row arrays (not binary xlsx)

The `backups` table has `teamsJson`, `fixturesJson`, `captainsJson`, `chipsJson` columns storing **JSON arrays of importable row shapes**, not pre-rendered .xlsx files.

**Why:** If we change the xlsx column layout next year, old binary snapshots become stale. JSON rows survive formatting changes — the writer renders them to xlsx on demand. Round-trippability through the import endpoints stays guaranteed.

The downside: re-rendering on download costs a few hundred ms vs serving a pre-built blob. We accept that tradeoff for snapshot longevity.

## 9. No passwords in backups

Backup teams files have no password column at all, and a read-only `Members` column instead (who is on each team).

**Why:** teams don't have passwords any more — everyone signs in with Google ([10-accounts-and-membership.md](10-accounts-and-membership.md)). Restore keeps team rows, so memberships survive it.

*History:* while team logins existed, the column held the placeholder `"RESET_REQUIRED"`, because bcrypt hashes can't be reversed and putting them in a downloadable xlsx would have been a security hole.

## 10. Format-aware palette as pure tokens (no CSS variables)

`src/lib/format-palette.ts` exports plain objects of Tailwind class strings per format. Consumers like `<LeagueNav teamSize={...} />` use them via `useFormatPalette()` from `LeagueContext`.

**Why:** Tailwind v4 scans source files for class names and tree-shakes unused ones out of the bundle. Using CSS custom properties would let us swap colors dynamically but would lose Tailwind's compile-time guarantees. Plain class-string tokens give us the same dynamic switching at the cost of one extra hook call, with all the typing and dead-class-stripping benefits Tailwind provides.

A `globals.css` safelist (`@source inline(...)`) ensures the palette classes never get tree-shaken even if they're only referenced via variable lookup.

## 11. No background workers

Everything runs inside the request lifecycle — scoring, advance, bracket generation, backup snapshot, cache invalidation. There's no Inngest, no BullMQ, no Vercel cron worker.

**Why:** Simplicity. The platform's heaviest workflow (auto-processing across all leagues) is operator-triggered and the orchestration is split into bounded ≤15s units. Background workers would add infra cost + state machine complexity for marginal benefit. If we ever need genuinely async work (e.g. nightly bonus-point reconciliation), Vercel cron + the existing `processAllLeagues` server-side wrapper is the natural extension point.

## 12. The league comes from the URL, not the session

A person's session says who they are. The league they are acting in comes from the URL (`?league=<slug>`), and `resolveTeamActor` ([`src/lib/team-actor.ts`](../src/lib/team-actor.ts)) turns the pair into a team through `team_members`.

**Why:**
- The alternative is an "active team" baked into the cookie and swapped on every league switch, like the old device account switcher.
- Then a stale tab keeps acting as whatever team the cookie *now* says. A captain pick submitted from a tab left open on league A would land on the team in league B.
- With the league in the URL there's no shared state to go stale, deep links work, and switching leagues is plain navigation.

## 13. No table rebuilds for accounts

`users.password` and `teams.password` stay NOT NULL, though nothing reads them any more (decision 17); new rows store `""`. `users.role` keeps its old `"admin"` default, so every insert sets the role explicitly.

**Why:**
- SQLite can't drop NOT NULL or change a default in place. It rebuilds the table, and both tables have other tables cascading from them.
- A rebuild on a live Turso database is exactly the kind of migration that can delete rows through a cascade.
- So migration 0025 is purely additive instead.

## 14. Team key kept as an internal identifier

Teams still get a `team_login_id` (`{slug}-Team{N}`), shown as "Team key", even though nobody logs in with it.

**Why:** backups, restores and the captain/chip/fixture importers all match teams by it, so keeping it means they work unchanged. There is no sign-in that accepts it.

## 15. Hand-wired Google OAuth (planned)

Google sign-in will use the small `arctic` OAuth/PKCE client, wired into the existing HMAC session.

**Why not the alternatives:**
- **Auth.js / Better Auth** bring their own session and user model, which would replace the session about 35 route files read.
- **Clerk / Firebase** add per-user cost and move user data off the platform. The membership tables would be needed either way.

## 16. One allowed database

[`src/lib/db/target-guard.ts`](../src/lib/db/target-guard.ts) refuses every database except a local `file:` one or the `jpl-india` Turso database. It runs in the app, in `drizzle.config.ts`, and in the 0025 apply script.

**Why:** this repo carries schema changes production must not receive while they're built and tested. A mis-pasted connection string should fail loudly before connecting, not migrate production.

## 17. Google is the only sign-in

There is no password sign-in of any kind: `/api/auth/signin` and `/api/auth/change-password` are gone, the `team` session type is refused by `verifySession`, and the superadmin has no break-glass password. The first superadmin is seeded by email (`npm run seed:admin`) and links on their first Google sign-in. Confirmations that used to ask for your password (reset season, delete league) ask you to type the league's slug.

**Why:** one way in means one thing to secure, support and explain. Team logins were shared credentials passed around group chats, and admin passwords were the only credentials the platform itself had to store and reset. This brought forward the planned post-2026-27 sunset (phase 4 in [10-accounts-and-membership.md](10-accounts-and-membership.md)) and dropped its break-glass.

**Trade-off:** if Google sign-in is misconfigured, nobody — not even the superadmin — can sign in until it's fixed ([07-deployment.md](07-deployment.md)). Old leagues aren't converted automatically: the superadmin switches each one (`switchLeagueToGoogleSignIn`), and the admin then puts each person on their own team by username, because a league invite would hand out open teams in order.

## See also

- [10-accounts-and-membership.md](10-accounts-and-membership.md) — accounts, membership and the decisions behind them.
- [05-auto-processing.md](05-auto-processing.md) — the orchestration these decisions enable.
- [01-architecture.md](01-architecture.md) — the deployment context driving most of them.
