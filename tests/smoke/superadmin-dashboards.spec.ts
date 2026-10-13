/**
 * The superadmin's three dashboards: General (/superadmin), Football (/superadmin/football) and
 * Cricket (/superadmin/cricket). Each shows only its own tabs, a sport dashboard lists only that
 * sport's leagues and creates leagues of that sport, and old Football links on /superadmin land on
 * Football.
 *
 * Run with: npm run test:e2e -- tests/smoke/superadmin-dashboards.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import {
  apiSignInSuperadmin,
  createCricketAuctionLeague,
  createTvtLeague,
  seedMiniTournament,
  uiSignInSuperadmin,
  uniqueSlug,
  type CricketLeagueRef,
  type LeagueRef,
} from "../harness";

const tabLabels = async (page: Page) =>
  (await page.getByRole("group", { name: "Section" }).first().getByRole("button").allInnerTexts()).map((t) => t.trim());

test.describe.serial("superadmin: three dashboards", () => {
  let fpl: LeagueRef;
  let cricket: CricketLeagueRef;
  let tournamentName = "";

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    fpl = await createTvtLeague(request, { teams: 8, name: `Dash FPL ${uniqueSlug("x")}` });
    tournamentName = uniqueSlug("dash");
    const t = await seedMiniTournament(request, tournamentName);
    cricket = await createCricketAuctionLeague(request, { tournamentId: t.id });
  });

  test("the nav offers General, Football, Cricket and Help", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto("/superadmin");
    for (const label of ["General", "Football", "Cricket", "Help"]) {
      await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
    }
  });

  test("General: Admins, Users and Feedback only", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto("/superadmin");
    await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
    expect(await tabLabels(page)).toEqual(["Admins", "Users", "Feedback"]);
  });

  test("Football: FPL leagues only, and the wizard starts at the FPL formats", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto("/superadmin/football");
    await expect(page.getByRole("heading", { level: 1, name: "Football" })).toBeVisible();
    expect(await tabLabels(page)).toEqual(["Leagues", "Operations", "PL Standings", "Score Adjustments"]);
    await expect(page.getByText(fpl.slug, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(cricket.slug, { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "+ Create League" }).click();
    await expect(page.getByRole("heading", { name: "Select Format" })).toBeVisible();
    await expect(page.getByRole("button", { name: /FPL Classic/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Classic Cricket Auction/ })).toHaveCount(0);
  });

  test("Cricket: cricket leagues and tournaments; the wizard offers the cricket format", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto("/superadmin/cricket");
    await expect(page.getByRole("heading", { level: 1, name: "Cricket" })).toBeVisible();
    expect(await tabLabels(page)).toEqual(["Leagues", "Tournaments"]);
    await expect(page.getByText(cricket.slug, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(fpl.slug, { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "+ Create League" }).click();
    await expect(page.getByRole("button", { name: /Classic Cricket Auction/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /FPL Classic/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Tournaments", exact: true }).click();
    await expect(page).toHaveURL(/\/superadmin\/cricket\?tab=tournaments$/);
    await expect(page.getByRole("heading", { name: "New tournament" })).toBeVisible();
    await expect(page.getByText(tournamentName).first()).toBeVisible();
  });

  test("a tab survives a reload, and old Football links on /superadmin land on Football", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto("/superadmin/cricket?tab=tournaments");
    await expect(page.getByRole("heading", { name: "New tournament" })).toBeVisible();

    await page.goto("/superadmin?tab=operations");
    await expect(page).toHaveURL(/\/superadmin\/football\?tab=operations$/);
    await expect(page.getByRole("heading", { level: 1, name: "Football" })).toBeVisible();
  });

  test("league admins' list groups leagues under Football and Cricket", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 2, name: /Football/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Cricket/ })).toBeVisible();
  });
});
