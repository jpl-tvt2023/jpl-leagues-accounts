/**
 * Phase 3 — members-mode leagues: invite links, joining, teammates, approval, admin tools,
 * recovery, and one person playing in two leagues at once.
 *
 * People sign in through the test-only POST /api/test-auth/signin (TEST_AUTH_ENABLED=1 in
 * .env.test); everything after that is the real code path. Runs serially: later tests build on
 * the leagues and people created earlier. See docs/10-accounts-and-membership.md.
 *
 * Run with: npm run test:e2e -- tests/accounts/members-leagues.spec.ts
 */

import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";

type Playwright = PlaywrightWorkerArgs["playwright"];
import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { apiSignInSuperadmin, apiSignInUser, ensureGameweeks, generateFixtures, testDb, schema, uniqueSlug } from "../harness";

const run = Date.now().toString(36);
const email = (who: string) => `${who}-${run}@members.test`;
const uname = (who: string) => `${who}_${run}`.slice(0, 20);

interface League { id: string; slug: string; inviteToken: string }

let tvt: League;
let auction: League;
let baseURL: string;

async function person(pw: Playwright, who: string, withUsername = true): Promise<APIRequestContext> {
  const ctx = await pw.request.newContext({ baseURL });
  await apiSignInUser(ctx, { email: email(who), name: who[0].toUpperCase() + who.slice(1), ...(withUsername ? { username: uname(who) } : {}) });
  return ctx;
}

async function join(ctx: APIRequestContext, token: string) {
  const res = await ctx.post("/api/join", { data: { token }, failOnStatusCode: false });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/** Save FPL teams to the person's list (setup picks from it). The test FPL stub knows any id. */
async function saveFplTeams(ctx: APIRequestContext, ...ids: string[]) {
  const saved = [];
  for (const id of ids) {
    const res = await ctx.post("/api/me/fpl-teams", { data: { fplEntryId: id } });
    expect(res.status(), await res.text()).toBe(200);
    saved.push((await res.json()).fplTeam);
  }
  return saved;
}

async function myTeamIn(userEmail: string, leagueId: string): Promise<string | null> {
  const db = testDb();
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, userEmail)).limit(1);
  if (!u) return null;
  const [m] = await db
    .select({ teamId: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.userId, u.id), eq(schema.teamMembers.leagueId, leagueId)))
    .limit(1);
  return m?.teamId ?? null;
}

async function createMembersLeague(request: APIRequestContext, format: "tvt" | "auction", name?: string): Promise<League> {
  await apiSignInSuperadmin(request);
  const slug = uniqueSlug(format === "tvt" ? "mt" : "ma");
  const res = await request.post("/api/superadmin/leagues", {
    data:
      format === "tvt"
        ? { slug, name: name ?? `Members TVT ${run}`, sport: "fpl", format: "tvt", season: "2025-26", teamSize: 8, enabledChips: ["D", "W", "C"], authMode: "members" }
        : { slug, name: `Members Auction ${run}`, sport: "fpl", format: "auction", season: "2025-26", teamSize: 10, auctionTier: "complete", isSimulated: true, authMode: "members" },
    failOnStatusCode: false,
  });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body.authMode).toBe("members");
  expect(body.invite?.token).toBeTruthy();
  return { id: body.id, slug: body.slug, inviteToken: body.invite.token };
}

test.describe.serial("members-mode leagues", () => {
  test.beforeAll(async ({ request }, info) => {
    baseURL = (info.project.use.baseURL as string | undefined) ?? `http://localhost:${process.env.TEST_PORT ?? 3100}`;
    tvt = await createMembersLeague(request, "tvt");
    auction = await createMembersLeague(request, "auction");
    await ensureGameweeks(tvt.id);
  });

  test("a league has team keys but no team passwords, and there is no team-key sign-in", async ({ request }) => {
    const teams = await testDb().select().from(schema.teams).where(eq(schema.teams.leagueId, tvt.id));
    expect(teams).toHaveLength(8);
    for (const t of teams) {
      expect(t.teamLoginId).toBeTruthy();
      expect(t.password).toBe("");
    }
    const res = await request.post("/api/auth/signin", { data: { identifier: teams[0].teamLoginId, password: "Team1" }, failOnStatusCode: false });
    expect(res.status()).toBe(404);
  });

  test("a signed-in person in no league sees their account on the home page, not Sign In", async ({ page }) => {
    await apiSignInUser(page.request, { email: email("newbie"), name: "Newbie", username: uname("newbie") });
    await page.goto("/");
    await expect(page.getByText("You're not in a league yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign In" })).toHaveCount(0);

    // Signed out, the same page offers Sign In again.
    await page.request.post("/api/auth/signout");
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account", exact: true })).toHaveCount(0);
  });

  test("join page: a signed-in person joins with one tap and lands on setup", async ({ page }) => {
    await apiSignInUser(page.request, { email: email("alice"), name: "Alice", username: uname("alice") });
    await page.goto(`/join/${tvt.inviteToken}`);
    await expect(page.getByRole("heading", { name: `Members TVT ${run}` })).toBeVisible();
    await expect(page.getByText("8 teams left")).toBeVisible();
    await page.getByRole("button", { name: /^Join / }).click();
    await page.waitForURL(`**/${tvt.slug}/setup`);
    expect(await myTeamIn(email("alice"), tvt.id)).toBeTruthy();
  });

  test("team setup through ?league=: the owner adds only their own details; the team waits for the partner", async ({ playwright }) => {
    const alice = await person(playwright, "alice");
    const setup = await alice.get(`/api/team/setup?league=${tvt.slug}`).then((r) => r.json());
    expect(setup.isProfileComplete).toBe(false);
    expect(setup.needsSetup).toBe(true);
    expect(setup.role).toBe("owner");

    await saveFplTeams(alice, "5001");
    const done = await alice.post(`/api/team/setup?league=${tvt.slug}`, {
      data: { teamName: `Alice FC ${run}`.slice(0, 30), fplId: "5001" },
    });
    expect(done.status(), await done.text()).toBe(200);
    expect((await done.json()).teamComplete).toBe(false);

    const after = await alice.get(`/api/team/setup?league=${tvt.slug}`).then((r) => r.json());
    expect(after.needsSetup).toBe(false); // her part is done: the dashboard opens
    expect(after.isProfileComplete).toBe(false); // the team is pending until the partner is in
    expect(after.mySlot).toMatchObject({ name: "Alice", fplId: "5001" });
    const mine = (await (await alice.get("/api/me/leagues")).json()).teams.find((t: { slug: string }) => t.slug === tvt.slug);
    expect(mine).toMatchObject({ needsSetup: false, isProfileComplete: false });

    const dash = await alice.get(`/api/team/dashboard?league=${tvt.slug}`);
    expect(dash.status()).toBe(200);
    expect((await dash.json()).leagueSlug).toBe(tvt.slug);
    // A person must say which league.
    expect((await alice.get("/api/team/dashboard")).status()).toBe(400);
    await alice.dispose();
  });

  test("teammate invite: the partner joins the same team and adds only their own details", async ({ playwright }) => {
    const alice = await person(playwright, "alice");
    const created = await alice.post(`/api/team/invite?league=${tvt.slug}`);
    expect(created.status()).toBe(200);
    const { invite } = await created.json();

    const bob = await person(playwright, "bob");
    const joined = await join(bob, invite.token);
    expect(joined.status).toBe(200);
    expect(joined.body.status).toBe("joined");
    expect(joined.body.redirectTo).toBe(`/${tvt.slug}/setup`); // his own details next

    const aliceTeam = await myTeamIn(email("alice"), tvt.id);
    expect(await myTeamIn(email("bob"), tvt.id)).toBe(aliceTeam);
    const setup = await (await bob.get(`/api/team/setup?league=${tvt.slug}`)).json();
    expect(setup).toMatchObject({ role: "member", needsSetup: true, ownerName: "Alice", openSlots: [], canAddSlot: true });

    // A teammate can't rename the team (ignored) or enter the partner (owner only).
    await saveFplTeams(bob, "5002");
    const saved = await bob.post(`/api/team/setup?league=${tvt.slug}`, { data: { teamName: "Hijacked", fplId: "5002" } });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).teamComplete).toBe(true);
    expect((await bob.post(`/api/team/partner?league=${tvt.slug}`, { data: { name: "X", fplId: "1" } })).status()).toBe(403);

    const [team] = await testDb().select().from(schema.teams).where(eq(schema.teams.id, aliceTeam!));
    expect(team.name).toBe(`Alice FC ${run}`.slice(0, 30));
    expect(team.isProfileComplete).toBe(true);
    const info = await (await bob.get(`/api/team/invite?league=${tvt.slug}`)).json();
    expect(info.role).toBe("member");
    // Each person is linked to their own FPL slot.
    const fplIdByName = Object.fromEntries(info.members.map((m: { name: string; player: { fplId: string } | null }) => [m.name, m.player?.fplId]));
    expect(fplIdByName).toEqual({ Alice: "5001", Bob: "5002" });

    // The link was single-use.
    const carol = await person(playwright, "carol");
    expect((await join(carol, invite.token)).status).toBe(410);
    await Promise.all([alice.dispose(), bob.dispose(), carol.dispose()]);
  });

  test("a partner who won't sign in: the owner enters them, and they can take the slot over later", async ({ playwright }) => {
    const mia = await person(playwright, "mia");
    expect((await join(mia, tvt.inviteToken)).body.status).toBe("joined");
    const partner = (data: object) => mia.post(`/api/team/partner?league=${tvt.slug}`, { data });

    expect((await partner({ name: "Ned", fplId: "6002" })).status()).toBe(409); // own details first
    await saveFplTeams(mia, "6001");
    await mia.post(`/api/team/setup?league=${tvt.slug}`, { data: { teamName: `Mia FC ${run}`.slice(0, 30), fplId: "6001" } });
    expect((await partner({ name: "Ned", fplId: "6001" })).status()).toBe(409); // that FPL ID is already on the team
    const entered = await partner({ name: "Ned", fplId: "6002" });
    expect(entered.status(), await entered.text()).toBe(200);
    expect((await entered.json()).teamComplete).toBe(true);
    expect((await partner({ name: "Ned P", fplId: "6003" })).status()).toBe(200); // edits the same slot

    const miaTeam = (await myTeamIn(email("mia"), tvt.id))!;
    const rows = () => testDb().select().from(schema.players).where(eq(schema.players.teamId, miaTeam));
    expect(await rows()).toHaveLength(2);
    expect((await (await mia.get(`/api/team/invite?league=${tvt.slug}`)).json()).partnerSlot).toEqual({ name: "Ned P", fplId: "6003" });

    // Ned turns up after all, with the team link, and takes over the slot Mia filled in.
    const { invite } = await (await mia.post(`/api/team/invite?league=${tvt.slug}`)).json();
    const ned = await person(playwright, "ned");
    expect((await join(ned, invite.token)).body.redirectTo).toBe(`/${tvt.slug}/setup`);
    const setup = await (await ned.get(`/api/team/setup?league=${tvt.slug}`)).json();
    expect(setup.canAddSlot).toBe(false);
    expect(setup.openSlots).toHaveLength(1);
    await saveFplTeams(ned, "6004");
    expect((await ned.post(`/api/team/setup?league=${tvt.slug}`, { data: { fplId: "6004" } })).status()).toBe(409); // which slot?
    const took = await ned.post(`/api/team/setup?league=${tvt.slug}`, { data: { fplId: "6004", slotId: setup.openSlots[0].id } });
    expect(took.status(), await took.text()).toBe(200);
    expect((await rows()).map((r) => r.fplId).sort()).toEqual(["6001", "6004"]); // updated, not added
    expect((await partner({ name: "Ned", fplId: "6005" })).status()).toBe(409); // he's in now
    await Promise.all([mia.dispose(), ned.dispose()]);
  });

  test("admin: filling in a missing player 2 completes a pending team", async ({ request, playwright }) => {
    const pat = await person(playwright, "pat");
    expect((await join(pat, tvt.inviteToken)).body.status).toBe("joined");
    await saveFplTeams(pat, "7001");
    await pat.post(`/api/team/setup?league=${tvt.slug}`, { data: { teamName: `Pat FC ${run}`.slice(0, 30), fplId: "7001" } });
    const patTeam = (await myTeamIn(email("pat"), tvt.id))!;

    await apiSignInSuperadmin(request);
    const res = await request.put(`/api/admin/${tvt.id}/update-team`, { data: { teamId: patTeam, player2Id: "", player2Name: "Quin", player2FplId: "7002" } });
    expect(res.status(), await res.text()).toBe(200);
    const [team] = await testDb().select().from(schema.teams).where(eq(schema.teams.id, patTeam));
    expect(team.isProfileComplete).toBe(true);
    expect(await testDb().select().from(schema.players).where(eq(schema.players.teamId, patTeam))).toHaveLength(2);
    await pat.dispose();
  });

  test("saved FPL teams: primary picked by default, only your own, one team per league, switchable", async ({ playwright }) => {
    const quinn = await person(playwright, "quinn");
    // FPL teams are optional until you join an FPL league: an empty list is fine.
    expect((await (await quinn.get("/api/me/fpl-teams")).json()).fplTeams).toEqual([]);
    const [first, second] = await saveFplTeams(quinn, "8001", "8002");
    expect([first.isPrimary, second.isPrimary]).toEqual([true, false]);
    expect((await quinn.patch("/api/me/fpl-teams", { data: { id: second.id } })).status()).toBe(200);

    expect((await join(quinn, tvt.inviteToken)).body.status).toBe("joined");
    const setup = await (await quinn.get(`/api/team/setup?league=${tvt.slug}`)).json();
    expect(setup.myName).toBe("Quinn");
    expect(setup.lock).toBeNull();
    expect(setup.fplTeams.find((t: { isPrimary: boolean }) => t.isPrimary).fplEntryId).toBe("8002");

    const post = (fplId: string) => quinn.post(`/api/team/setup?league=${tvt.slug}`, { data: { teamName: `Quinn FC ${run}`.slice(0, 30), fplId } });
    const notSaved = await post("9999");
    expect(notSaved.status()).toBe(400);
    expect((await notSaved.json()).code).toBe("not-saved");
    expect((await post("8002")).status()).toBe(200);

    // Switch to the other one; the slot plays as Quinn either way.
    const switchTo = (fplId: string) => quinn.post(`/api/team/fpl-team?league=${tvt.slug}`, { data: { fplId } });
    expect((await switchTo("8001")).status()).toBe(200);
    const quinnTeam = (await myTeamIn(email("quinn"), tvt.id))!;
    const [row] = await testDb().select().from(schema.players).where(eq(schema.players.teamId, quinnTeam));
    expect(row).toMatchObject({ fplId: "8001", name: "Quinn" });

    // Alice's FPL team already plays for her team in this league.
    await saveFplTeams(quinn, "5001");
    const taken = await switchTo("5001");
    expect(taken.status()).toBe(409);
    expect((await taken.json()).code).toBe("duplicate-fpl-id");
    const again = await (await quinn.get(`/api/team/setup?league=${tvt.slug}`)).json();
    expect(again.fplTeams.find((t: { fplEntryId: string }) => t.fplEntryId === "5001").takenBy).toBe(`Alice FC ${run}`.slice(0, 30));
    await quinn.dispose();
  });

  test("FPL teams are fixed at the league's first deadline; admins can still change them", async ({ request, playwright }) => {
    const lockLeague = await createMembersLeague(request, "tvt", `Lock TVT ${run}`);
    const rita = await person(playwright, "rita");
    await saveFplTeams(rita, "8101", "8102");
    expect((await join(rita, lockLeague.inviteToken)).body.status).toBe("joined");
    expect((await rita.post(`/api/team/setup?league=${lockLeague.slug}`, { data: { teamName: `Rita FC ${run}`.slice(0, 30), fplId: "8101" } })).status()).toBe(200);

    // Its first fixture is in GW1, with the deadline still ahead.
    const db = testDb();
    const ritaTeam = (await myTeamIn(email("rita"), lockLeague.id))!;
    const [other] = await db.select({ id: schema.teams.id }).from(schema.teams).where(and(eq(schema.teams.leagueId, lockLeague.id), ne(schema.teams.id, ritaTeam))).limit(1);
    const gwId = randomUUID();
    await db.insert(schema.gameweeks).values({ id: gwId, leagueId: lockLeague.id, number: 1, deadline: new Date(Date.now() + 7 * 864e5) });
    await db.insert(schema.fixtures).values({ id: randomUUID(), gameweekId: gwId, homeTeamId: ritaTeam, awayTeamId: other.id });
    const switchTo = (fplId: string) => rita.post(`/api/team/fpl-team?league=${lockLeague.slug}`, { data: { fplId } });
    expect((await switchTo("8102")).status()).toBe(200);

    // The deadline passes: switching is refused, and the team page says why.
    await db.update(schema.gameweeks).set({ deadline: new Date(Date.now() - 60_000) }).where(eq(schema.gameweeks.id, gwId));
    const locked = await switchTo("8101");
    expect(locked.status()).toBe(409);
    expect((await locked.json()).code).toBe("fpl-locked");
    expect((await (await rita.get(`/api/team/invite?league=${lockLeague.slug}`)).json()).fplLock).toMatchObject({ gw: 1 });

    // A league admin can still fix it.
    await apiSignInSuperadmin(request);
    const [player] = await db.select().from(schema.players).where(eq(schema.players.teamId, ritaTeam));
    const fixed = await request.put(`/api/admin/${lockLeague.id}/update-team`, {
      data: { teamId: ritaTeam, player1Id: player.id, player1Name: player.name, player1FplId: "8199" },
    });
    expect(fixed.status(), await fixed.text()).toBe(200);
    expect((await db.select().from(schema.players).where(eq(schema.players.id, player.id)))[0].fplId).toBe("8199");
    await rita.dispose();
  });

  test("one person, two leagues: captain and wishlist each land on the right team", async ({ playwright }) => {
    const alice = await person(playwright, "alice");
    expect((await join(alice, auction.inviteToken)).body.status).toBe("joined");
    const tvtTeam = await myTeamIn(email("alice"), tvt.id);
    const auctionTeam = await myTeamIn(email("alice"), auction.id);
    expect(tvtTeam && auctionTeam && tvtTeam !== auctionTeam).toBeTruthy();

    const mine = await (await alice.get("/api/me/leagues")).json();
    expect(mine.teams.map((t: { slug: string }) => t.slug).sort()).toEqual([tvt.slug, auction.slug].sort());

    // Captain in the TVT league.
    const dash = await (await alice.get(`/api/team/dashboard?league=${tvt.slug}`)).json();
    const playerId = dash.captaincyStatus?.player1?.id;
    expect(playerId).toBeTruthy();
    const cap = await alice.post(`/api/team/captain?league=${tvt.slug}`, { data: { playerId, gameweek: 1 } });
    expect(cap.status(), await cap.text()).toBe(200);
    const [row] = await testDb().select().from(schema.gameweekCaptains).where(eq(schema.gameweekCaptains.playerId, playerId));
    const [player] = await testDb().select().from(schema.players).where(eq(schema.players.id, playerId));
    expect(player.teamId).toBe(tvtTeam);
    expect(row.submittedByUserId).toBeTruthy();

    // Wishlist in the auction league — on her auction team, and only there.
    const wish = await alice.post("/api/auction/wishlist", { data: { leagueId: auction.id, teamId: auctionTeam, fplElementId: 1, playerName: "Test Player" } });
    expect(wish.status(), await wish.text()).toBeLessThan(300);
    const wishes = await testDb().select().from(schema.auctionWishlists).where(eq(schema.auctionWishlists.teamId, auctionTeam!));
    expect(wishes).toHaveLength(1);
    await alice.dispose();
  });

  test("non-members are refused on team and auction routes", async ({ playwright }) => {
    const dave = await person(playwright, "dave");
    expect((await dave.get(`/api/team/dashboard?league=${tvt.slug}`)).status()).toBe(403);
    expect((await dave.post(`/api/team/captain?league=${tvt.slug}`, { data: { playerId: "x", gameweek: 1 } })).status()).toBe(403);
    const aliceAuctionTeam = await myTeamIn(email("alice"), auction.id);
    const res = await dave.post("/api/auction/wishlist", { data: { leagueId: auction.id, teamId: aliceAuctionTeam, fplElementId: 2, playerName: "Nope" } });
    expect(res.status()).toBe(403);
    await dave.dispose();
  });

  test("a person without a username is sent to onboarding first", async ({ playwright }) => {
    const nameless = await person(playwright, "nameless", false);
    const res = await join(nameless, tvt.inviteToken);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("needs-username");
    await nameless.dispose();
  });

  test("approval mode: request → approve gives a team; reject and cancel don't", async ({ request, playwright }) => {
    await apiSignInSuperadmin(request);
    const created = await request.post(`/api/admin/${tvt.id}/invites`, { data: { requiresApproval: true } });
    expect(created.status()).toBe(200);
    const token = (await created.json()).invite.token;
    // The old link stopped working.
    const eve = await person(playwright, "eve");
    expect((await join(eve, tvt.inviteToken)).status).toBe(410);
    tvt.inviteToken = token;

    expect((await join(eve, token)).body.status).toBe("pending");
    expect((await (await eve.get("/api/me/leagues")).json()).pending).toHaveLength(1);

    const frank = await person(playwright, "frank");
    expect((await join(frank, token)).body.status).toBe("pending");
    const gina = await person(playwright, "gina");
    expect((await join(gina, token)).body.status).toBe("pending");
    expect((await gina.delete("/api/join", { data: { leagueId: tvt.id } })).status()).toBe(200);

    const roster = await (await request.get(`/api/admin/${tvt.id}/members`)).json();
    const byEmail = (e: string) => roster.requests.find((r: { email: string }) => r.email === e);
    expect(byEmail(email("gina"))).toBeUndefined();
    expect((await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "approve", requestId: byEmail(email("eve")).id } })).status()).toBe(200);
    expect((await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "reject", requestId: byEmail(email("frank")).id } })).status()).toBe(200);

    expect(await myTeamIn(email("eve"), tvt.id)).toBeTruthy();
    expect(await myTeamIn(email("frank"), tvt.id)).toBeNull();
    expect(await myTeamIn(email("gina"), tvt.id)).toBeNull();
    await Promise.all([eve.dispose(), frank.dispose(), gina.dispose()]);
  });

  test("revoked and used-up invites are refused", async ({ request, playwright }) => {
    await apiSignInSuperadmin(request);
    const once = await (await request.post(`/api/admin/${auction.id}/invites`, { data: { maxUses: 1 } })).json();
    const hank = await person(playwright, "hank");
    expect((await join(hank, once.invite.token)).body.status).toBe("joined");
    const ivy = await person(playwright, "ivy");
    expect((await join(ivy, once.invite.token)).body.code).toBe("used-up");

    const fresh = await (await request.post(`/api/admin/${auction.id}/invites`, { data: {} })).json();
    expect((await request.delete(`/api/admin/${auction.id}/invites`, { data: { inviteId: fresh.invite.id } })).status()).toBe(200);
    expect((await join(ivy, fresh.invite.token)).body.code).toBe("revoked");
    await Promise.all([hank.dispose(), ivy.dispose()]);
  });

  test("a full league says so", async ({ request, playwright }) => {
    // Fill every open auction team directly, then try to join.
    const db = testDb();
    const allTeams = await db.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.leagueId, auction.id));
    const taken = new Set((await db.select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers).where(eq(schema.teamMembers.leagueId, auction.id))).map((r) => r.teamId));
    for (const t of allTeams.filter((t) => !taken.has(t.id))) {
      const uid = randomUUID();
      await db.insert(schema.users).values({ id: uid, email: `${uid}@filler.test`, password: "", name: "Filler", role: "user" });
      await db.insert(schema.teamMembers).values({ id: randomUUID(), teamId: t.id, leagueId: auction.id, userId: uid, role: "owner" });
    }
    await apiSignInSuperadmin(request);
    const invite = await (await request.post(`/api/admin/${auction.id}/invites`, { data: { maxUses: null } })).json();
    const jack = await person(playwright, "jack");
    const res = await join(jack, invite.invite.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("league-full");
    await jack.dispose();
  });

  test("admin: assign by username, replace a lost account, remove", async ({ request, playwright }) => {
    const kim = await person(playwright, "kim");
    const kimNew = await person(playwright, "kimnew");
    await apiSignInSuperadmin(request);
    const roster = await (await request.get(`/api/admin/${tvt.id}/members`)).json();
    const open = roster.teams.find((t: { state: string }) => t.state === "open");
    expect(open).toBeTruthy();

    expect((await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "assign", teamId: open.id, username: uname("kim") } })).status()).toBe(200);
    expect(await myTeamIn(email("kim"), tvt.id)).toBe(open.id);
    expect((await kim.get(`/api/team/dashboard?league=${tvt.slug}`)).status()).not.toBe(403);

    const after = await (await request.get(`/api/admin/${tvt.id}/members`)).json();
    const seat = after.teams.find((t: { id: string }) => t.id === open.id).members[0];
    expect((await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "replace", memberId: seat.id, username: uname("kimnew") } })).status()).toBe(200);
    expect(await myTeamIn(email("kim"), tvt.id)).toBeNull();
    expect(await myTeamIn(email("kimnew"), tvt.id)).toBe(open.id);
    // The old account lost access on its very next request.
    expect((await kim.get(`/api/team/dashboard?league=${tvt.slug}`)).status()).toBe(403);

    expect((await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "remove", memberId: seat.id } })).status()).toBe(200);
    expect(await myTeamIn(email("kimnew"), tvt.id)).toBeNull();
    expect((await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "assign", teamId: open.id, username: "no_such_person_x" } })).status()).toBe(404);
    await Promise.all([kim.dispose(), kimNew.dispose()]);
  });

  test("superadmin transfer moves every membership to a new account and signs the old one out", async ({ request, playwright }) => {
    const lou = await person(playwright, "lou");
    await apiSignInSuperadmin(request);
    // Lou is admin-assigned into an open TVT team.
    const roster = await (await request.get(`/api/admin/${tvt.id}/members`)).json();
    const open = roster.teams.find((t: { state: string }) => t.state === "open");
    await request.post(`/api/admin/${tvt.id}/members`, { data: { action: "assign", teamId: open.id, username: uname("lou") } });
    const louNew = await person(playwright, "lounew");

    const found = await (await request.get(`/api/superadmin/users?q=${run}`)).json();
    const from = found.users.find((u: { email: string }) => u.email === email("lou"));
    const to = found.users.find((u: { email: string }) => u.email === email("lounew"));
    const res = await request.post(`/api/superadmin/users/${from.id}/transfer`, { data: { toUserId: to.id } });
    expect(res.status(), await res.text()).toBe(200);

    expect(await myTeamIn(email("lounew"), tvt.id)).toBe(open.id);
    expect(await myTeamIn(email("lou"), tvt.id)).toBeNull();
    expect((await (await lou.get("/api/auth/me")).json()).authenticated).toBe(false);
    await Promise.all([lou.dispose(), louNew.dispose()]);
  });

  test("backup → restore keeps every membership", async ({ request }) => {
    await apiSignInSuperadmin(request);
    // Restore refuses a backup with no fixtures (it wipes and re-inserts them), so give the league some.
    await generateFixtures(request, tvt.slug);
    const before = await testDb().select({ id: schema.teamMembers.id }).from(schema.teamMembers).where(eq(schema.teamMembers.leagueId, tvt.id));
    expect(before.length).toBeGreaterThan(0);

    const backup = await request.get(`/api/admin/${tvt.id}/backup`);
    expect(backup.status()).toBe(200);
    const zip = await backup.body();
    const restored = await request.post(`/api/admin/${tvt.id}/restore-tvt`, {
      multipart: { file: { name: "backup.zip", mimeType: "application/zip", buffer: zip } },
    });
    expect(restored.status(), await restored.text()).toBe(200);

    const after = await testDb().select({ id: schema.teamMembers.id }).from(schema.teamMembers).where(eq(schema.teamMembers.leagueId, tvt.id));
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  test("league pages: switcher, dashboard and help speak members-mode", async ({ page }) => {
    await apiSignInUser(page.request, { email: email("alice"), username: uname("alice") });
    await page.goto(`/${tvt.slug}/help`);
    await expect(page.getByText("How do I join this league?")).toBeVisible();
    await expect(page.getByText("How do I sign in? (team ID)")).toHaveCount(0);

    // Home: her leagues under Football with their status, and a league she isn't in below them.
    await page.goto("/");
    const football = page.getByRole("region", { name: "Football" });
    const mine = football.getByRole("region", { name: "Your leagues" });
    await expect(mine.getByText(`Members TVT ${run}`)).toBeVisible();
    await expect(mine.getByText(`Members Auction ${run}`)).toBeVisible();
    await expect(mine.getByText("Open dashboard →").first()).toBeVisible();
    await expect(football.getByRole("region", { name: "Other leagues" }).getByText(`Lock TVT ${run}`)).toBeVisible();
    await expect(mine.getByText(`Lock TVT ${run}`)).toHaveCount(0);

    // /dashboard no longer jumps into the last league: there's no one dashboard, so it's home.
    await page.goto(`/${tvt.slug}/dashboard`);
    await page.goto("/dashboard");
    await page.waitForURL((url) => url.pathname === "/");

    // In a league, the league name in the desktop bar switches leagues; the Account menu no
    // longer lists them.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/${tvt.slug}/standings`);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await expect(page.getByText("All my leagues")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /switch league/ }).click();
    await expect(page.getByRole("link", { name: /All my leagues/ })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`Members Auction ${run}`) }).click();
    await page.waitForURL(`**/${auction.slug}/**`);
  });

  // Fixtures exist by now: the backup test above generated them.
  test("Match Center is a nav destination: it opens on your own match", async ({ page }) => {
    await apiSignInUser(page.request, { email: email("alice"), username: uname("alice") });
    const aliceTeam = (await myTeamIn(email("alice"), tvt.id))!;
    await page.goto(`/${tvt.slug}/match-center`);
    // The page stays put and pins the comparison it opened on into the URL — your team on the left.
    await page.waitForURL(new RegExp(`/${tvt.slug}/match-center\\?gw=\\d+&a=${aliceTeam}&b=`));
    await expect(page.getByLabel("First team")).toHaveValue(aliceTeam);
  });

  test("public help and privacy load signed out", async ({ page }) => {
    for (const path of ["/help", "/privacy"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
    }
    await expect(page.getByRole("heading", { name: "What we store, and why" })).toBeVisible();
    await page.goto("/help#in-app-browser");
    await expect(page.locator("#in-app-browser")).toBeVisible();
  });
});
