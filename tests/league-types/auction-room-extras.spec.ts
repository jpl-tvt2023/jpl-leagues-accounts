/**
 * The FPL auction rooms' final results: once a session is over, the team room and the admin room
 * show every team's squad with prices and the purse left. A simulated draft leaves no bids, so this
 * also checks the results come from the squads themselves.
 *
 * Run with: npm run test:e2e -- tests/league-types/auction-room-extras.spec.ts
 */

import { test, expect } from "@playwright/test";
import {
  apiSignInSuperadmin,
  createAndRunInitialAuction,
  createAuctionLeague,
  ensureGameweeks,
  setupAllTeams,
  uiSignInSuperadmin,
  uiSignInTeam,
  type LeagueRef,
} from "../harness";

let league: LeagueRef;
let sessionId = "";

test.describe.serial("Auction rooms (FPL): final results", () => {
  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    league = await createAuctionLeague(request, { tier: "primary", isSimulated: true });
    await setupAllTeams(request, league.slug, league.teamSize, "auction");
    await ensureGameweeks(league.id);
    await apiSignInSuperadmin(request); // setting up the teams signs in as them
    ({ sessionId } = await createAndRunInitialAuction(request, league.id));
  });

  test("user: a finished auction shows every squad and the purse left", async ({ page }) => {
    await uiSignInTeam(page, league.slug, 1);
    await page.goto(`/${league.slug}/auction/${sessionId}`);
    const results = page.getByRole("region", { name: "Final results" });
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results.getByRole("heading", { level: 3 })).toHaveCount(league.teamSize);
    await expect(results).toContainText("left");
    await expect(results).toContainText("(you)");
    await expect(page.getByRole("heading", { name: "Auction log" })).toBeVisible();
  });

  test("admin: the admin room shows the same results", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto(`/admin/${league.slug}/auction/${sessionId}`);
    const results = page.getByRole("region", { name: "Final results" });
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results.getByRole("heading", { level: 3 })).toHaveCount(league.teamSize);
  });
});
