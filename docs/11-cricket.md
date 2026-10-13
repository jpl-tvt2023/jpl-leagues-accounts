# 11 · Cricket — the Classic Cricket Auction

Cricket is its own sport module. It shares only the generic league plumbing with football (`leagues`,
team identity and membership, auth, the UI shell); its logic lives in `src/lib/sports/cricket/`, its
tables in `src/lib/db/schema-cricket.ts`, its pages under `src/app/[leagueSlug]/cricket/`. The FPL
code is untouched by it.

The one format so far is **Classic Cricket Auction** (`format = "cricket-auction"`, `sport = "cricket"`):
managers build squads of real players in live auctions, every squad player scores their fantasy points
from every match, and the highest total wins. No captains, no transfers, no gameweeks.

## Data: tournaments and uploads

There is no cricket API. A **tournament** (e.g. "IPL 2026") is uploaded by the superadmin at
`/superadmin/cricket` as four spreadsheets, and any number of leagues play on it.

| Sheet | Columns (aliases accepted, see `sheets/columns.ts`) | Replaces |
|---|---|---|
| Teams | `team_code`, `name`, `base_price` (franchise opening price, lakhs) | the whole list |
| Players | `player_id`, `name`, `team`, `role` (WK/BAT/AR/BOWL), `base_price` (lakhs), `overseas` (Y/N), `Test`, `ODI`, `T20` (expected matches) | the whole list |
| Fixtures | `series`, `fixture_id` (restarts at 1 per series), `format` (Test/ODI/T20), `team_a`, `team_b`, `start_time_ist`, `time`, `venue` | the whole list |
| Points | `series` (optional with one series), `fixture_id`, `player_id`, `points` | each fixture in the file |

- **Flow.** The browser parses the file (SheetJS, `sheets/client.ts`) and posts its rows to
  `POST /api/superadmin/cricket/tournaments/[id]/upload`. `mode: "validate"` is a dry run returning every
  error/warning with its row, insert/update/delete counts, a preview and a hash. `mode: "commit"`
  re-validates; it returns **409** if the hash no longer matches (someone uploaded since — the hash
  includes the tournament's `data_version`) and **422** on errors. A commit is one atomic `db.batch`
  that also bumps `data_version` and writes a `cricket_uploads` audit row.
- **Safety.** A row still in use can't be deleted (a team with players or fixtures, a player with points
  or in a squad, a fixture with points). A scored fixture can't change teams. Moving an owned player to
  another team after an auction started is an *overridable* error: the superadmin may tick "override",
  which is recorded in the audit row.
- **Times.** The sheet is IST (UTC+5:30); `ist.ts` reads ISO text, day-first text and Excel serials and
  stores UTC.
- **Fixture status.** Uploading points marks a fixture `completed`. The superadmin can mark one
  `abandoned` (it then doesn't count toward completion), reinstate it, or clear its points.

## League settings (`cricket_league_config`)

Set in the create wizard (`components/cricket/CricketSettingsForm.tsx`) and the league console's
Settings tab: tournament (fixed), purse, squad rules (min/max size, role min/max, max per real team,
max overseas — `squad-rules.ts`), franchise auction on/off (league tournaments only) and boost %, penalty
redeem price, bid and nomination timers. Everything but the timers locks once any auction session
exists. Money is **lakhs** everywhere (`formatLakhs`: 200 → "₹2 Cr").

## Auctions (`src/lib/sports/cricket/auction/`)

| File | Role |
|---|---|
| `rules.ts` | Pure: bid ladder, rising floor, squad checks, reserve rule |
| `data.ts` | Loads the pool (cached per data version) and league state; eligibility checks |
| `engine.ts` | Turns, lots, bids, sales, timeouts, `tick` |
| `actions.ts` | Sessions, corrections, reset, redemption, wishlists, simulator |
| `snapshot.ts` | The room's state as one JSON payload |

- **Order.** Franchise session (if enabled) → player session. One of each; no mini-auctions. The admin
  creates, schedules, starts, pauses/resumes and completes them (league admins and the superadmin).
- **Bid ladder.** +5 L under ₹1 Cr, +10 L to ₹2 Cr, +20 L to ₹5 Cr, +25 L above.
- **Reserve rule.** A team may never bid more than its purse less (players still needed for the
  minimum squad × cheapest unsold base price).
- **Franchise auction.** One per team, from the same purse. A franchise opens at
  `max(base price, average sold so far rounded onto the ladder)` — the "rising floor", so the last
  franchises aren't a bargain. On a missed turn a random unsold franchise the team can afford is
  nominated with them as opening bidder; none affordable → the turn is skipped.
- **Player auction.** A lot opens at the player's base price with the nominator as first bidder. On a
  missed turn the first affordable, allowed wishlist player is nominated; otherwise the team gets a
  penalty slot (one fewer squad slot), which it can redeem for the league's price until the player
  auction ends.
- **Concurrency.** Every connected room's SSE stream (`/api/cricket/auction/stream`) runs `tick` every
  2s, as do state reads. Like the FPL engine, every turn move is a compare-and-swap on the state the
  caller saw, and "lot sold + purchase + purse + pause" and "claim window + open lot" each commit in one
  transaction. Bids are a CAS on the current high bid. A 12-poller soak
  (`tests/league-types/cricket-auction-soak.spec.ts`) checks turns follow the ring exactly.
- **Corrections.** Cancel the open lot (same team nominates again), undo a sale (refund; unsold again),
  give a team a make-up turn, reset the whole auction. Completing the player auction with short squads
  needs `force`. The superadmin can **simulate** both auctions instantly for rehearsals and tests.

## Scoring (`scoring.ts`)

Pure and computed on demand — no gameweeks and no processing step:

- every squad player's uploaded points count;
- a player from the franchise their manager owns scores `points × boost%` extra (applied to the total,
  negatives included);
- tiebreakers: total, synergy (boost) points, the team's highest-scoring player, purse left;
- complete when every non-abandoned fixture has points, or when the admin marks it complete.

`league.ts` builds the **league view** every cricket page renders (teams named after their franchise,
standings with per-player and per-fixture breakdown, the pool with owners, fixtures, auction sessions)
and caches it under `crk:league:v1:{leagueId}:d{dataVersion}:s{stateVersion}` (`cache.ts`, its own Redis
client). Uploads bump `data_version`; sales, settings and session changes bump `state_version` — so old
entries are simply never read again.

## Keeping cricket out of FPL code

`src/lib/sports/registry.ts` declares each format's capabilities. Cricket has no gameweeks, so:
gameweek/TVT routes return 400 for it (`route-guards.ts`), the auto-processing plan skips it,
`/api/standings` and the team dashboard refuse it, the league layout redirects any FPL page of a cricket
league to its `/cricket/*` counterpart (`cricket/routes.ts`), and the FPL admin console sends it to
`/admin/[slug]/cricket`.

## Later (not built yet)

Multi-series windows (tournament `kind = "window"` and per-series fixtures are already modelled),
IPL retention across seasons (keep `player_id` stable across uploads), Triple Crown per-format tables
(points are stored per fixture with its format), and chips.
