/**
 * Phase 2 — people: sign-in, onboarding, profile, devices, deletion, admin privileges.
 *
 * Google can't be driven from a test, so people sign in through the test-only
 * POST /api/test-auth/signin (TEST_AUTH_ENABLED=1 in .env.test). Everything after the session
 * cookie is minted is the real code path. See docs/10-accounts-and-membership.md.
 *
 * Run with: npm run test:e2e -- tests/accounts/identity.spec.ts
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { eq } from "drizzle-orm";
import { apiSignInSuperadmin, apiSignInUser, createTvtLeague, testDb, schema } from "../harness";

const run = Date.now().toString(36);
const email = (who: string) => `${who}-${run}@accounts.test`;

const WHATSAPP_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 WhatsApp/2.23.24.82";

async function me(request: APIRequestContext) {
  return (await request.get("/api/auth/me")).json();
}

test.describe("people: sign-in and onboarding", () => {
  test("a new person is signed in but has no username until onboarding", async ({ request }) => {
    await apiSignInUser(request, { email: email("newbie"), name: "New Bie" });
    const body = await me(request);
    expect(body.authenticated).toBe(true);
    expect(body.type).toBe("user");
    expect(body.needsUsername).toBe(true);
    expect(body.user.name).toBe("New Bie");
  });

  test("username rules, availability and uniqueness", async ({ request, playwright, baseURL }) => {
    await apiSignInUser(request, { email: email("picker") });
    const check = async (u: string) => (await request.get(`/api/me/profile?checkUsername=${encodeURIComponent(u)}`)).json();

    expect((await check("admin")).available).toBe(false);
    expect((await check("ab")).available).toBe(false);
    const name = `picker_${run}`.slice(0, 20);
    expect((await check(`@${name.toUpperCase()}`)).available).toBe(true); // normalised

    const set = await request.patch("/api/me/profile", { data: { username: name } });
    expect(set.status()).toBe(200);
    expect((await me(request)).user.username).toBe(name);

    // Someone else can't take it now.
    const other = await playwright.request.newContext({ baseURL });
    await apiSignInUser(other, { email: email("copycat") });
    expect((await (await other.get(`/api/me/profile?checkUsername=${name}`)).json()).available).toBe(false);
    expect((await other.patch("/api/me/profile", { data: { username: name } })).status()).toBe(409);
    await other.dispose();
  });

  test("onboarding page: pick a username and land on next", async ({ page }) => {
    await apiSignInUser(page.request, { email: email("onboarder"), name: "On Boarder" });
    await page.goto("/onboarding?next=/account");
    await page.getByLabel("Username").fill(`onb_${run}`.slice(0, 20));
    await expect(page.getByText(/is available/)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/account");
    await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  });

  test("a new person is in no leagues yet", async ({ request }) => {
    await apiSignInUser(request, { email: email("loner"), username: `loner_${run}`.slice(0, 20) });
    const leagues = await (await request.get("/api/me/leagues")).json();
    expect(leagues).toMatchObject({ teams: [], adminOf: [], allLeagues: false, pending: [] });
  });

  test("there is no password sign-in: the old routes are gone", async ({ request }) => {
    await apiSignInUser(request, { email: email("googleonly") });
    for (const path of ["/api/auth/signin", "/api/auth/change-password"]) {
      const res = await request.post(path, { data: { identifier: email("googleonly"), password: "anything-at-all-1" }, failOnStatusCode: false });
      expect(res.status(), path).toBe(404);
    }
  });

  test("an old team-login session cookie is not a session", async ({ request, baseURL }) => {
    // Forged with the right shape but no valid signature — and even a validly signed one is
    // refused for its type (tests/unit/auth-accounts.test.ts covers that half).
    const payload = Buffer.from(JSON.stringify({ id: "some-team", type: "team", exp: 9999999999 })).toString("base64url");
    const res = await request.get("/api/auth/me", { headers: { cookie: `session=${payload}.deadbeef` } });
    expect((await res.json()).authenticated).toBe(false);
    expect(baseURL).toBeTruthy();
  });
});

test.describe("people: devices and deletion", () => {
  test("sign out of all other devices revokes the other session, keeps this one", async ({ playwright, baseURL }) => {
    const phone = await playwright.request.newContext({ baseURL });
    const laptop = await playwright.request.newContext({ baseURL });
    const who = { email: email("twodevices"), username: `twodev_${run}`.slice(0, 20) };
    await apiSignInUser(phone, who);
    await apiSignInUser(laptop, who);
    expect((await me(phone)).authenticated).toBe(true);

    expect((await laptop.post("/api/me/sessions")).status()).toBe(200);
    expect((await me(laptop)).authenticated).toBe(true);
    expect((await me(phone)).authenticated).toBe(false);
    await phone.dispose();
    await laptop.dispose();
  });

  test("deleting the account needs the username typed, then signs out", async ({ request }) => {
    const username = `leaver_${run}`.slice(0, 20);
    await apiSignInUser(request, { email: email("leaver"), username });
    expect((await request.delete("/api/me", { data: { confirm: "nope" } })).status()).toBe(400);
    expect((await request.delete("/api/me", { data: { confirm: username } })).status()).toBe(200);
    expect((await me(request)).authenticated).toBe(false);
    const rows = await testDb().select().from(schema.users).where(eq(schema.users.email, email("leaver")));
    expect(rows).toHaveLength(0);
  });
});

test.describe("admins: created by email, promoted, demoted", () => {
  test("superadmin creates an admin by email; they get league access; removal revokes it on the next request", async ({ request, playwright, baseURL }) => {
    await apiSignInSuperadmin(request);
    const league = await createTvtLeague(request, { teams: 8 });
    const created = await request.post("/api/superadmin/admins", { data: { name: "Email Admin", email: email("emailadmin") } });
    expect(created.status()).toBe(200);
    const admin = await created.json();
    expect(admin.signIn).toBe("pending");
    expect((await request.post("/api/superadmin/league-assignments", { data: { userId: admin.id, leagueId: league.id } })).ok()).toBe(true);

    // Stands in for their first Google sign-in with that email.
    const adminCtx = await playwright.request.newContext({ baseURL });
    await apiSignInUser(adminCtx, { email: email("emailadmin") });
    expect((await me(adminCtx)).type).toBe("admin");
    expect((await adminCtx.get(`/api/admin/${league.id}/create-team`)).status()).toBe(200);

    expect((await request.delete(`/api/superadmin/admins/${admin.id}`)).ok()).toBe(true);
    expect((await adminCtx.get(`/api/admin/${league.id}/create-team`)).status()).toBe(403);
    await adminCtx.dispose();
  });

  test("promoting an existing player takes effect without signing in again", async ({ request, playwright, baseURL }) => {
    const player = await playwright.request.newContext({ baseURL });
    await apiSignInUser(player, { email: email("riser"), username: `riser_${run}`.slice(0, 20) });
    expect((await me(player)).type).toBe("user");

    await apiSignInSuperadmin(request);
    const promoted = await (await request.post("/api/superadmin/admins", { data: { name: "Riser", email: email("riser") } })).json();
    expect(promoted.promoted).toBe(true);

    // /api/auth/me re-mints the session at the new role.
    expect((await me(player)).type).toBe("admin");
    expect((await player.get("/api/admin/my-leagues")).status()).toBe(200);

    // Removing a person who has an account demotes them back to a player and kills old sessions.
    await testDb().insert(schema.userIdentities).values({
      id: `ident-${run}`, userId: promoted.id, provider: "google", providerSubject: `sub-${run}`, email: email("riser"),
    });
    const removed = await (await request.delete(`/api/superadmin/admins/${promoted.id}`)).json();
    expect(removed.demoted).toBe(true);
    expect((await me(player)).authenticated).toBe(false);
    await player.dispose();
  });
});

test.describe("Google entry points", () => {
  test("in-app browsers get the open-in-browser screen, not the Google button", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: WHATSAPP_UA });
    const page = await ctx.newPage();
    await page.goto("/signin?next=/account");
    await expect(page.getByRole("heading", { name: /Open this page in Chrome to sign in/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open in Chrome" })).toHaveAttribute("href", /^intent:\/\/.*\/signin\?next=%2Faccount|^intent:\/\/.*\/signin\?next=\/account/);
    await ctx.close();
  });

  test("/api/auth/google turns in-app browsers back to /signin", async ({ request }) => {
    const res = await request.get("/api/auth/google?next=/join/abc", { headers: { "user-agent": WHATSAPP_UA }, maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/signin?inapp=1&next=%2Fjoin%2Fabc");
  });

  test("an off-site next is dropped", async ({ request }) => {
    const res = await request.get("/api/auth/google?next=//evil.example.com", { maxRedirects: 0 });
    expect(res.headers()["location"]).not.toContain("evil.example.com");
  });

  test("a regular browser sees Continue with Google first", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
    // Google is the only way in: no password form.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});
