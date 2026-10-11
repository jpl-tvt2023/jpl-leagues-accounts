# JPL India — Functional QA Testing Plan

This document is the durable brief for any agent (or human tester) running a project-wide
functional QA pass on the JPL India codebase. The goal is **discovery only** — produce a ranked
list of bugs. Fixes happen in follow-up PRs.

## Role

You are a **software test analyst**. Walk the codebase by user flow, not by file. For each major
flow, look for what would break, mislead, or confuse a real user — both functional defects and
cosmetic / copy / layout problems. No skip lists; everything is in scope.

## Conditions / assumptions

- Working directory: `jpl-leagues-accounts/` (this repo; its database is `jpl-india`, never production's)
- Read-only inspection. Do NOT mutate DB state, run migrations, or invoke production cleanups.
- Codebase is Next.js (App Router) + Drizzle ORM + libsql/Turso. Tailwind for styling.
- Reference league: `demo-auction`. Other formats exist (TVT, Triple Crown, classic). Everyone signs in with Google; people join leagues via invite (old team-login leagues must be switched to Google sign-in first) — see `docs/10-accounts-and-membership.md`.
- The most recent fix wave covered: double-sell guard, proactive squad-full skip, admin heartbeat,
  pending_release in `ownerOfPlayer`, composition warning on auto-complete, trade `bonusSlots`,
  pause/resume time shift, wishlist+unsold tabs, squad-header rewrite, 14→15 sweep, auto-backup
  triggers. Treat these as recently-shipped and **re-test them for regressions**, not skip them.

## Severity bar

- **P0 — Data corruption or security**: wrong money/points/ownership written to DB; auth bypass;
  privilege escalation; cross-league data leak; concurrent state corruption.
- **P1 — User-blocking or wrong-result**: feature doesn't work; user sees incorrect
  score/standing/squad; flow can't be completed; admin action silently fails.
- **P2 — Misleading or fragile**: UI claims X but backend does Y; missing error handling on a
  realistic path; race condition that hasn't bitten yet; broken edge case.
- **P3 — Polish**: copy issues that mislead; tooltip math wrong; formats that break at extreme
  counts; broken empty states; mobile layout that breaks at common widths.

## Report shape (use this exact structure)

```markdown
## Findings

### [P0/P1/P2/P3] Title — 1-line summary
**Where:** path/file.ts:line  (+ optional second path:line for related code)
**Repro:** 1-3 sentences on how to trigger or observe
**Why it's wrong:** 1-2 sentences on the expected behavior
**Confirmed / Hypothesis:** "Confirmed by reading code" OR "Hypothesis — needs verification"
**Notes:** scope of impact / blast radius / similar code that might share the bug
```

Cap each finding at ~6 lines. Sort by severity. If a severity tier has zero findings, omit it.
Target 15-25 findings total across all severities.

## Domains to inspect

The agent **must** touch every domain. For domains where the agent finds nothing, write an explicit
`Domain N / <name> — walked, no findings` line in the report so coverage is verifiable.

1. **Auth / setup / membership** — Google sign-in (the only sign-in), session expiry, super-admin gates, setup wizard,
   and which team a request acts as.
   - `src/app/api/auth/*`, `src/app/signin/page.tsx`, `src/app/setup/TeamSetup.tsx`, `src/lib/auth.ts`,
     `src/lib/team-actor.ts`, `src/lib/viewer.ts`, `src/middleware.ts`.
   - **P0 checks (membership / IDOR):** a person can never act as a team they aren't on, by naming another
     team's id or another league; an old team-login token is refused outright; removing a member or
     bumping `users.session_version` revokes access on the very next request; every team-scoped route goes
     through `resolveTeamActor` / `sessionActsAsTeam` / `sessionTeamIdInLeague` (`tests/unit/team-actor-guard.test.ts`).
   - Planned (Phases 2–3): Google sign-in and email auto-link, username rules, invite expiry / max uses /
     revoke, approval mode, the iOS home-screen handoff, account replacement and transfer.
   - Partner setup (`tests/accounts/members-leagues.spec.ts`): owner and partner each enter only their own FPL
     details; the team stays pending until both slots are filled; the owner can enter a partner who won't sign
     in, whom the partner later takes over; a teammate can't rename the team or enter the partner.
2. **Dashboard** — per-format dashboards. Cross-format consistency. Rank/points math.
   - `src/app/dashboard/page.tsx`, `src/app/api/team/dashboard/route.ts`.
3. **Standings** — classic + auction + cup; live-cache invalidation; tie-breakers.
   - `src/app/api/standings/route.ts`, `src/app/[leagueSlug]/_components/standings/*`.
4. **GW Results** — per-GW table, captain points, chips, scoring edge cases, sub-entry expand.
   - `src/app/[leagueSlug]/_components/gw-results/*`, `src/app/api/auction/gw-summary/route.ts`.
5. **Squad / Teams pages** — composition rules, FMV vs purchase price display, release flow.
   - `src/app/[leagueSlug]/squad/page.tsx`, `src/app/[leagueSlug]/teams/page.tsx`.
6. **Marketplace / Trade** — propose → accept/reject/expire/admin-veto lifecycle; cash flow; FMV
   floor; new `bonusSlots` validation in `validateTradeProposal`.
   - `src/app/api/auction/trade/*`, `src/lib/formats/auction/marketplace.ts`.
7. **Players page** — filters (position/team/ownership/search), pagination, sort stability.
   - `src/app/[leagueSlug]/players/page.tsx`, `src/app/api/auction/players/route.ts`.
8. **Admin (per-league)** — bulk upload, captain override, scoring re-process, restore, manager
   management, backup tab.
   - `src/app/admin/[leagueId]/page.tsx`, all `src/app/api/admin/[leagueId]/**`.
9. **Superadmin** — league CRUD, admin assignments, PL standings, score adjustments.
   - `src/app/superadmin/page.tsx`, `src/app/api/superadmin/**`.
10. **Notifications** — creation, read state, delivery, bell badge counts, in-app feed.
    - `src/lib/notifications.ts`, `src/app/api/notifications/route.ts`, `NotificationBell` component.
11. **Backup / Restore** — snapshot creation, restore from .zip vs DB row, cross-league + cross-format
    guards, restore-auction route, auto-snapshot triggers.
    - `src/lib/backup/*`, `src/app/api/admin/[leagueId]/backups/**`,
      `src/app/api/admin/[leagueId]/restore-auction/route.ts`.
12. **Cron / process-all** — GW finalization, playoff brackets/advance, finance settlement, FPL
    bootstrap caching.
    - `src/lib/cron/process-all.ts`, `src/app/api/cron/process-scores/route.ts`,
      `src/lib/playoffs/*`.
13. **TVT format** — H2H scheduling, byes, captain enforcement.
    - `src/lib/formats/triple-crown/process-gameweek.ts` (shared), TVT scoring path.
14. **Triple Crown format** — cup groups, ghost team, snake seeding.
    - `src/lib/formats/triple-crown/*`, `src/app/api/triple-crown/cup-standings/route.ts`.
15. **Auction format — Primary tier** (`leagues.auctionTier = "primary"`) — feature surface
    differs from `complete`. Confirm what's disabled stays disabled; what's enabled works.
16. **Auction format — Complete tier** (`leagues.auctionTier = "complete"`) — full feature surface.
    Re-test recent fix wave (A-E) for regressions: nominate, bid, resolve, club-auction, wishlist+
    unsold tabs, releases (incl. pending_release), pause/resume time-shift, composition warning,
    snapshot triggers, trade validation with bonus slots, double-sell guards.
    - `src/lib/formats/auction/*`, all `src/app/api/auction/**`,
      `src/app/[leagueSlug]/auction/page.tsx`.
17. **Mobile / responsive layout** — render every page mentally at ~375px (iPhone SE) and ~768px
    (iPad portrait). Flag any text truncation, overlapping controls, hidden buttons, tables that
    don't horizontal-scroll, modals that don't fit. This is a first-class domain.
18. **Cosmetic / copy** — tooltip math correctness, label/heading wording, empty-state messages,
    error-message clarity, currency formatting, date/timezone display. Surface anything misleading
    or confusing.

## Confirmed vs Hypothesis rubric

Every finding must carry one of these labels:

- **Confirmed by reading code** — the agent traced the bug through the file, can cite the exact
  line that's wrong, and the consequence is unambiguous.
- **Hypothesis — needs verification** — the agent suspects a bug but couldn't trace it without
  running the code. Acceptable to include but flagged so the user knows to verify before fixing.

## Out of scope

- Performance / bundle size / SQL-N+1 (note briefly if egregious, but not the focus).
- Proposing fixes — discovery only.

## Coverage checklist (the agent must include this at the end of the report)

```
Domain 1  / Auth + setup                     — ✓ inspected
Domain 2  / Dashboard                        — ✓ inspected
Domain 3  / Standings                        — ✓ inspected
Domain 4  / GW Results                       — ✓ inspected
Domain 5  / Squad + Teams                    — ✓ inspected
Domain 6  / Marketplace + Trade              — ✓ inspected
Domain 7  / Players page                     — ✓ inspected
Domain 8  / Admin per-league                 — ✓ inspected
Domain 9  / Superadmin                       — ✓ inspected
Domain 10 / Notifications                    — ✓ inspected
Domain 11 / Backup + Restore                 — ✓ inspected
Domain 12 / Cron + process-all               — ✓ inspected
Domain 13 / TVT format                       — ✓ inspected
Domain 14 / Triple Crown format              — ✓ inspected
Domain 15 / Auction primary tier             — ✓ inspected
Domain 16 / Auction complete tier            — ✓ inspected
Domain 17 / Mobile + responsive              — ✓ inspected
Domain 18 / Cosmetic + copy                  — ✓ inspected
```

## Re-run instructions

To re-run this audit in the future:

1. Read this file. Confirm the "Shipped work index" section in the plan file is up-to-date so the
   agent knows what's been fixed since last audit.
2. Launch an Explore agent with the prompt:
   > "Read `TESTING_PLAN.md` in the repo root. Execute the QA audit per that brief. Return your
   > report in the exact shape specified."
3. Surface the agent's report to the user with a short triage paragraph.
