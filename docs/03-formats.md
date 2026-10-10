# 03 · League formats — implementation map

This document maps each league format to its **code paths** — scoring processor, advance helper, tie IDs, schedule constants. Use it as a directory when you need to change format behaviour.

A league's `format` field is one of:

- `"tvt"` — Team-vs-Team head-to-head, sizes 8 / 16 / 32 (distinguished by `teamSize`).
- `"continental-championship"` — three parallel competitions (JPL + Cup Groups + JCL/JEL).
- `"auction"` — bid-based squad construction.

The `format` + `teamSize` combo drives every routing decision (scoring processor, advance dispatcher, palette, help/rules component).

---

## TVT (Team-vs-Team)

### Scoring

`src/lib/formats/tvt/scoring.ts`
- `calculateTVTTeamScore({ fplScore, transferHits, isCaptain }[])` — sums the two players, doubles the captain, subtracts transfer hits.
- `calculateTVTTeamScoreAsync(...)` — same shape but async + FPL-fetching variant.
- `determineMatchResult(homeScore, awayScore)` — returns `{ homeMatchPoints, awayMatchPoints }` per the 2/1/0 H2H scoring.

### Processor

The TVT processor lives inline in [`src/app/api/gameweeks/[gw]/route.ts`](../src/app/api/gameweeks/[gw]/route.ts) (the `// TVT FORMAT (default)` section). For each unprocessed fixture it:

1. Resolves both teams' captain picks (auto-assigning if missing).
2. Parallel-fetches FPL scores for all 4 players (2 per team).
3. Applies carry-forward hit deduction from prior GW.
4. Processes chips (`W` / `D` / `C` / `SL` / `CB` / `UD`).
5. Writes the `results` row.
6. After every fixture in the GW: awards a single Bonus Point per group to the team with the highest margin of victory.

### Playoff schedule

`src/lib/playoffs/advance-windows.ts` — `getPlayoffAdvanceGws(format, teamSize, playoffStartGw)`:

| Size | Advance window | Tie IDs |
|---|---|---|
| 8  | `{playoffStartGw, +1, +2}` (typically GW36/37/38) | `8T-SF-A`, `8T-SF-B`, `8T-FINAL`, `8T-3RD` |
| 16 | 8 GWs starting at `playoffStartGw` | `16T-FINAL`, `16T-CFINAL`, `16T-C3RD`, plus QF/SF nodes |
| 32 | `{31, 32, 33, 34, 35, 36, 37, 38}` | `RO16-A..H` (with C-31-A..F consolation), `QF-A..D`, `SF-A`, `SF-B`, `Final`, plus Challenger ladder `C-32-A..C`, `C-34-A..B`, `C-35-A..D`, `C-36-A..B`, `C-37-A..B`, `C-38-A` |

### Advance dispatcher

`src/app/api/admin/[leagueId]/advance-playoffs/route.ts` — `advancePlayoffsImpl(leagueId, gwNumber)`:
- For TVT 8 / 16: branches into format-specific helpers (`advanceGW33_16T`, `advanceGW36_16T`, etc.).
- For TVT 32: case-by-case on `gwNumber` (31, 32, 33, 34, 35, 36, 37, 38) — each case calls `resolve2LegTie` / `resolve1LegTie` / `markLeg1Done` for that GW's ties and creates next-round ties via `create2LegTie` / `create1LegTie`.

### Generate trigger

`getPlayoffGenerateAction(format, teamSize, playoffStartGw, gw)` — returns an action **once per league** at `playoffStartGw - 1`. For TVT-32 the action is `generate-playoffs` (creates RO16 + C-31). For TVT-8 / 16 the action targets the format's specific bracket creator.

### Winners (Hall of Champions)

`build8TeamWinners` / `build16TeamWinners` / `build32TeamWinners` in [`src/app/api/playoffs/winners/route.ts`](../src/app/api/playoffs/winners/route.ts) map tie IDs to ranked positions. See the position tables in that file for the exact mapping.

---

## JPL Continental Championship

### Scoring

`src/lib/formats/continental-championship/process-gameweek.ts` — `processContinentalChampionshipGameweek(gameweekId, gwNumber, leagueId, force)`.

Stores `leaguePoints` (W=2/D=1/L=0 for JPL) and `cupGroupPoints` (W=2/D=1/L=0 for cup matches) separately on `teams`. Both increment in the same processor run per GW.

Ghost fixtures (cup-group only): the Ghost's score is `Math.ceil(average of the other 4 human teams' scores)`.

### Cup-group group generation

`src/app/api/admin/[leagueId]/generate-cup-groups/route.ts` — runs once after GW5 standings settle. Snake-seeds 20 teams into 4 cup groups (A/B/C/D), 5 teams each, then generates 10 matchdays' worth of fixtures on even GWs 6-24.

### Playoff schedule (JCL/JEL only)

The advance window is `{27, 29, 33, 35, 37, 38}` (in addition to GW38 for the JPL Champion gating). Tie IDs:
- `JCL-QF-1..4`, `JCL-SF-1..2`, `JCL-FINAL` (2-leg across GW37/38).
- `JEL-QF-1..4`, `JEL-SF-1..2`, `JEL-FINAL` (2-leg across GW37/38).

### Advance dispatcher (Continental Championship branch)

In `advancePlayoffsImpl`, when `format === "continental-championship"`:
- GW27 → mark JCL/JEL QF leg 1 done (`markLeg1Done` for all 8 QF ties).
- GW29 → `resolve2LegTie` for all QFs; create SF ties.
- GW33 → mark SF leg 1 done.
- GW35 → `resolve2LegTie` for all SFs; create JCL/JEL Final ties with concrete winnerIds.
- GW37 → mark Final leg 1 done.
- GW38 → `resolve2LegTie` for JCL-FINAL and JEL-FINAL.

### Winners (Hall of Champions)

`buildContinentalChampionshipWinners` in [`src/app/api/playoffs/winners/route.ts`](../src/app/api/playoffs/winners/route.ts):
- Position 1 — JPL Champion — `desc(teams.leaguePoints)` top row, gated on `isGw38Settled()`.
- Position 2 — JCL Champion — `JCL-FINAL.winnerId`.
- Position 3 — JEL Champion — `JEL-FINAL.winnerId`.

---

## Auction

### Scoring

`src/lib/formats/auction/process-gameweek.ts` — `processAuctionGameweek(gameweekId, gwNumber, leagueId, force)`. Sums each team's active players' FPL points and writes `auction_scores`. Distributes GW payouts to each team's purse based on rank.

`src/lib/formats/auction/economy.ts` — payout schedule (`GW_PAYOUTS`), FMV calculation, refund math.
`src/lib/formats/auction/standings.ts` — `computeAuctionStandings(teams, scores, gwNumbers, squadValues)` returns the standings response.

### Auction state machine

`src/app/api/auction/*` endpoints drive:
- `live-status` — is an auction session currently active.
- `nominate` — admin nominates a player.
- `bid` — team places a bid.
- `mini-auction/...` — start/finalize mini-auction sessions during the season.
- `redeem-slot` — release a player back to the pool.

### Playoffs

Auction has **no playoffs**. `getPlayoffAdvanceGws` returns an empty set for `format === "auction"`. The Winners page shows a single "Season Champion" trophy populated from `desc(teams.leaguePoints)` once GW38 is fully scored.

---

## Format detection patterns in the codebase

There are ~123 places where the code branches on `format === "..."` or `teamSize === N`. The most important entry points:

- **Page-level routing**: `src/app/[leagueSlug]/standings/page.tsx` and `playoffs/page.tsx` dispatch to format-specific components (`ClassicStandings`, `AuctionStandings`, `ContinentalChampionshipPlayoffs`, etc.).
- **Help / Rules**: `src/app/[leagueSlug]/help/page.tsx` and `rules/page.tsx` dispatch to `TvtHelp` / `ContinentalChampionshipHelp` / `TvtRules` / `ContinentalChampionshipRules` / `AuctionRules`.
- **Scoring entry**: `src/app/api/gameweeks/[gw]/route.ts` POST handler — first reads `league.format` and routes to Continental Championship or Auction format processors before falling through to TVT inline.
- **Advance entry**: `advancePlayoffsImpl` switches on `format` first, then on `teamSize`.

The format-aware visual palette is centralised in [`src/lib/format-palette.ts`](../src/lib/format-palette.ts) and consumed via `useFormatPalette()` from `LeagueContext`.

## See also

- [04-scoring-pipeline.md](04-scoring-pipeline.md) — what happens inside the score handler.
- [05-auto-processing.md](05-auto-processing.md) — how the per-GW orchestrator routes work to each format.
- [02-data-model.md](02-data-model.md) — `playoff_ties.status` lifecycle.
