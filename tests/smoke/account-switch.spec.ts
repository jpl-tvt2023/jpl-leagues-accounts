/**
 * Several accounts on one device.
 *
 * One person can have more than one Google account (say, an admin one and a personal one).
 * Signing in to a second account keeps the first signed in, and the account menu switches between
 * them without signing in again. These specs pin the parts that matter for safety as much as
 * convenience:
 *  - switching really changes who the API thinks you are;
 *  - another open tab of the same browser reloads under the new account instead of quietly acting
 *    as it (in the auction room that would be a bid placed for the wrong team);
 *  - Sign Out signs out only the active account, and "Sign out of all accounts" clears the device.
 *
 * Google can't be driven from a test, so each sign-in goes through the test-only
 * POST /api/test-auth/signin — the same session and accounts cookies a Google sign-in sets.
 *
 * Runs in the desktop `chromium` project (the account menu lives in the desktop app bar; the phone
 * drawer renders the same list).
 *
 * Run with: npm run test:e2e -- tests/smoke/account-switch.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import {
  apiSignInSuperadmin,
  apiSignInUser,
  apiSignOut,
  createTvtLeague,
  ensureTeamPerson,
  setupAllTeams,
  type LeagueRef,
} from "../harness";

let league: LeagueRef;

/** Sign the browser in as team `index`'s owner (keeping any other account) and open that dashboard. */
async function signInAs(page: Page, index: number) {
  const { email } = await ensureTeamPerson(league.slug, index);
  await apiSignInUser(page.request, { email });
  await page.goto(`/${league.slug}/dashboard`);
  await expect(page.getByRole("heading", { name: `Team ${index}`, level: 1 })).toBeVisible({ timeout: 20_000 });
}

async function whoAmI(page: Page): Promise<string | null> {
  const res = await page.request.get("/api/auth/me");
  const body = await res.json();
  return body.authenticated ? (body.user?.name ?? null) : null;
}

const owner = (index: number) => `Team ${index} owner`;
const accountMenu = (page: Page) => page.getByRole("button", { name: "Account", exact: true });

test.describe.serial("Account switcher", () => {
  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    league = await createTvtLeague(request, { teams: 8 });
    await setupAllTeams(request, league.slug, 8, "tvt");
    await apiSignOut(request);
  });

  test("a second sign-in keeps the first account, and the menu switches between them", async ({ page }) => {
    await signInAs(page, 1);
    expect(await whoAmI(page)).toBe(owner(1));

    await signInAs(page, 2);
    expect(await whoAmI(page)).toBe(owner(2));

    await accountMenu(page).click();
    const switchTo1 = page.getByRole("button", { name: new RegExp(owner(1)) });
    await expect(switchTo1).toBeVisible();
    // Switching reloads the page onto the account's landing page (a full navigation, by design).
    // Let it land before navigating, or our goto races it and is interrupted.
    await Promise.all([
      page.waitForURL((url) => url.pathname !== `/${league.slug}/dashboard`, { timeout: 20_000 }),
      switchTo1.click(),
    ]);

    await expect.poll(() => whoAmI(page), { timeout: 20_000 }).toBe(owner(1));
    await page.goto(`/${league.slug}/dashboard`);
    await expect(page.getByRole("heading", { name: "Team 1", level: 1 })).toBeVisible();
  });

  test("another open tab reloads under the newly active account", async ({ page, context }) => {
    await signInAs(page, 1);
    await signInAs(page, 2);

    const other = await context.newPage();
    await other.goto(`/${league.slug}/dashboard`);
    await expect(other.getByRole("heading", { name: "Team 2", level: 1 })).toBeVisible();

    await accountMenu(page).click();
    await page.getByRole("button", { name: new RegExp(owner(1)) }).click();
    await expect.poll(() => whoAmI(page), { timeout: 20_000 }).toBe(owner(1));

    // The background tab heard the switch and reloaded as Team 1's owner on its own.
    await expect(other.getByRole("heading", { name: "Team 1", level: 1 })).toBeVisible({ timeout: 20_000 });
    await other.close();
  });

  test("Sign Out signs out only the active account; sign-in offers the other", async ({ page }) => {
    await signInAs(page, 3);
    await signInAs(page, 4);

    await accountMenu(page).click();
    await page.getByRole("button", { name: "Sign Out", exact: true }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain("/signin");
    expect(await whoAmI(page)).toBeNull();

    const continueAs = page.getByRole("button", { name: new RegExp(`Continue as ${owner(3)}`) });
    await expect(continueAs).toBeVisible();
    await continueAs.click();
    await expect.poll(() => whoAmI(page), { timeout: 20_000 }).toBe(owner(3));
  });

  test("Sign out of all accounts clears the device", async ({ page }) => {
    await signInAs(page, 5);
    await signInAs(page, 6);

    await accountMenu(page).click();
    await page.getByRole("button", { name: "Sign out of all accounts" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).toContain("/signin");
    expect(await whoAmI(page)).toBeNull();

    const accounts = await (await page.request.get("/api/auth/accounts")).json();
    expect(accounts.accounts).toEqual([]);
    await expect(page.getByRole("button", { name: /Continue as/ })).toHaveCount(0);
  });

  test("the accounts list never exposes a session token", async ({ page }) => {
    await signInAs(page, 7);
    const res = await page.request.get("/api/auth/accounts");
    const text = await res.text();
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "session")?.value;
    expect(session).toBeTruthy();
    expect(text).not.toContain(session!);
    const accountsCookie = cookies.find((c) => c.name === "jpl_accounts");
    expect(accountsCookie?.httpOnly).toBe(true);
  });
});
