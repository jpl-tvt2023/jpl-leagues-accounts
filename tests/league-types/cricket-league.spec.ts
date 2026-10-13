/**
 * Classic Cricket Auction leagues: creation (settings, purses), the cricket pages, and the fences
 * that keep a cricket league out of FPL code paths.
 *
 * Run with: npm run test:e2e -- tests/league-types/cricket-league.spec.ts
 */

import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  apiSignInSuperadmin,
  createCricketAuctionLeague,
  seedMiniTournament,
  testDb,
  uiSignInSuperadmin,
  uniqueSlug,
  type CricketLeagueRef,
} from "../harness";
import { cricketLeagueConfig, cricketTeamState } from "../../src/lib/db/schema-cricket";
import { teams } from "../../src/lib/db/schema";

test.describe.serial("cricket: league", () => {
  let league: CricketLeagueRef;
  let tournamentId = "";

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    tournamentId = (await seedMiniTournament(request, uniqueSlug("lg"))).id;
    league = await createCricketAuctionLeague(request, { tournamentId });
  });

  test("admin: creating the league stores its settings and every team's purse", async () => {
    const db = testDb();
    const [config] = await db.select().from(cricketLeagueConfig).where(eq(cricketLeagueConfig.leagueId, league.id));
    expect(config).toMatchObject({ tournamentId, purse: 1000, franchiseAuctionEnabled: true, franchiseBoostPercent: 20 });
    const states = await db.select().from(cricketTeamState).where(eq(cricketTeamState.leagueId, league.id));
    expect(states).toHaveLength(4);
    expect(states.every((s) => s.purse === 1000 && s.spent === 0)).toBe(true);
  });

  test("admin: bad settings and a sport/format mismatch are refused", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const bad = await request.post("/api/superadmin/leagues", {
      data: { slug: uniqueSlug("ckbad"), name: "Bad", sport: "cricket", format: "cricket-auction", season: "2026", teamSize: 4, cricket: { tournamentId, purse: 1000, squadRules: { minSize: 10, maxSize: 5 }, franchiseBoostPercent: 20, penaltyRedeemPrice: 0 } },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toMatch(/Minimum squad size is larger/);
    const mismatch = await request.post("/api/superadmin/leagues", {
      data: { slug: uniqueSlug("ckbad"), name: "Bad", sport: "fpl", format: "cricket-auction", season: "2026", teamSize: 4 },
    });
    expect(mismatch.status()).toBe(400);
  });

  test("user: the league view has teams, the pool and fixtures, and zero points before any auction", async ({ request }) => {
    const res = await request.get(`/api/cricket/league?league=${league.slug}`);
    expect(res.status()).toBe(200);
    const view = await res.json();
    expect(view.teams).toHaveLength(4);
    expect(view.players).toHaveLength(24);
    expect(view.fixtures).toHaveLength(6);
    expect(view.realTeams.map((t: { code: string }) => t.code)).toEqual(["CSK", "KKR", "MI", "RCB"]);
    expect(view.standings.rows.every((r: { total: number }) => r.total === 0)).toBe(true);
    expect(view.standings.complete).toBe(false);
  });

  test("user: every cricket page renders", async ({ page }) => {
    for (const p of ["standings", "fixtures", "players", "squads", "rules", "help", "winners", "auction"]) {
      const res = await page.goto(`/${league.slug}/cricket/${p}`);
      expect(res?.status(), p).toBeLessThan(400);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.getByText(/gameweek|GKP/i)).toHaveCount(0);
    }
  });

  test("user: FPL pages of a cricket league send you to the cricket ones", async ({ page }) => {
    await page.goto(`/${league.slug}`);
    await expect(page).toHaveURL(new RegExp(`/${league.slug}/cricket/standings$`));
    await page.goto(`/${league.slug}/playoffs`);
    await expect(page).toHaveURL(new RegExp(`/${league.slug}/cricket/standings$`));
    await page.goto(`/${league.slug}/teams`);
    await expect(page).toHaveURL(new RegExp(`/${league.slug}/cricket/squads$`));
  });

  test("admin: FPL machinery refuses or skips a cricket league", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const standings = await request.get(`/api/standings?leagueSlug=${league.slug}`);
    expect(standings.status()).toBe(400);
    const gws = await request.post(`/api/admin/${league.slug}/create-gameweeks`);
    expect(gws.status()).toBe(400);
    const plan = await request.post("/api/admin/process-all/plan");
    if (plan.ok()) {
      const body = await plan.json();
      expect(JSON.stringify(body)).not.toContain(league.id);
    }

    // The FPL auction's league- and team-keyed endpoints refuse it too.
    const [team] = await testDb().select({ id: teams.id }).from(teams).where(eq(teams.leagueId, league.id)).limit(1);
    const wish = await request.post("/api/auction/wishlist", { data: { leagueId: league.id, teamId: team.id, fplElementId: 1, playerName: "Someone" } });
    expect(wish.status()).toBe(400);
    expect((await wish.json()).error).toMatch(/FPL auction/);
    const redeem = await request.post("/api/auction/redeem-slot", { data: { teamId: team.id } });
    expect((await redeem.json()).error).toMatch(/FPL auction/);
    expect((await request.get(`/api/auction/unsold?leagueId=${league.id}`)).status()).toBe(400);
    expect((await request.get(`/api/auction/finance?leagueId=${league.id}&allTeams=true`)).status()).toBe(400);
    expect((await request.get(`/api/auction/finance?teamId=${team.id}`)).status()).toBe(400);
    expect((await request.get(`/api/auction/club-tiers?leagueId=${league.id}`)).status()).toBe(400);
  });

  test("admin: the cricket console and its auction tab render; FPL's console sends you there", async ({ page }) => {
    await uiSignInSuperadmin(page);
    await page.goto(`/admin/${league.slug}`);
    await expect(page).toHaveURL(new RegExp(`/admin/${league.slug}/cricket$`));
    await expect(page.getByRole("tab", { name: "Auction" }).or(page.getByRole("button", { name: "Auction" })).first()).toBeVisible();
    await page.getByRole("tab", { name: "Auction" }).or(page.getByRole("button", { name: "Auction" })).first().click();
    await expect(page.getByText("+ Franchise auction")).toBeVisible();
    await page.goto(`/${league.slug}/cricket/auction`);
    await expect(page.getByText(/hasn't been set up yet/)).toBeVisible();
  });

  test("admin: settings save before the auction, and the season can be marked complete", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const cfg = await request.get(`/api/admin/${league.slug}/cricket/config`).then((r) => r.json());
    expect(cfg.settingsLocked).toBe(false);
    const res = await request.patch(`/api/admin/${league.slug}/cricket/config`, { data: { ...cfg.settings, purse: 1200 } });
    expect(res.status(), await res.text()).toBe(200);
    const view = await request.get(`/api/cricket/league?league=${league.slug}`).then((r) => r.json());
    expect(view.teams.every((t: { purse: number }) => t.purse === 1200)).toBe(true);

    expect((await request.post(`/api/admin/${league.slug}/cricket/complete`, { data: { complete: true } })).status()).toBe(200);
    const done = await request.get(`/api/cricket/league?league=${league.slug}`).then((r) => r.json());
    expect(done.standings.complete).toBe(true);
    await request.post(`/api/admin/${league.slug}/cricket/complete`, { data: { complete: false } });
  });
});
