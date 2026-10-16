/**
 * Classic Cricket Auction engine, through the real API: a live franchise auction (rising floor,
 * auto-nomination on timeout), a live player auction (base-price opening, bid ladder, reserve rule,
 * wishlist auto-nomination, penalty and redemption, corrections), and a simulated auction whose
 * standings must match a hand calculation including the franchise boost.
 *
 * Run with: npm run test:e2e -- tests/league-types/cricket-auction.spec.ts
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  apiSignInSuperadmin,
  apiSignInTeam,
  createCricketAuctionLeague,
  ensureTeamPerson,
  miniPoints,
  pointsGrid,
  seedMiniTournament,
  testDb,
  uiSignInTeam,
  uniqueSlug,
  uploadCricketSheet,
  type CricketLeagueRef,
} from "../harness";
import { cricketFranchiseOwnership, cricketSquadPlayers, cricketTeamState, cricketPlayers, cricketPlayerPoints } from "../../src/lib/db/schema-cricket";

type Snapshot = {
  myTeamId: string | null;
  current: null | {
    sessionId: string;
    type: "franchise" | "player";
    status: string;
    nominatorTeamId: string | null;
    nominationDeadline: string | null;
    intermissionUntil: string | null;
    ring: string[];
    makeupQueue: string[];
    lastOutcome: null | { type: "sold" | "penalised" | "skipped"; teamId: string | null; price?: number; kind?: string; name?: string };
    lot: null | {
      id: string;
      kind: string;
      name: string;
      currentHighBid: number;
      currentHighBidderId: string;
      nextMinBid: number;
      expiresAt: string;
      playerId: number | null;
      cricketTeamId: number | null;
      history: Array<{ teamId: string; amount: number; type: string }>;
    };
  };
  teams: Array<{ id: string; purse: number; maxBid: number; penaltySlots: number; squadSize: number; franchiseId: number | null }>;
  franchises: Array<{ id: number; code: string; openingPrice: number; ownerTeamId: string | null }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function state(request: APIRequestContext, slug: string): Promise<Snapshot> {
  const res = await request.get(`/api/cricket/auction/state?league=${slug}`);
  expect(res.status()).toBe(200);
  return res.json();
}

/** Poll the state (each read also advances the clock) until `pred` holds. */
async function waitFor(request: APIRequestContext, slug: string, pred: (s: Snapshot) => boolean, timeoutMs = 40_000): Promise<Snapshot> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = await state(request, slug);
    if (pred(s)) return s;
    if (Date.now() > end) throw new Error(`timed out waiting; last state: ${JSON.stringify(s.current)}`);
    await sleep(1000);
  }
}

async function admin(request: APIRequestContext, slug: string, body: Record<string, unknown>) {
  await apiSignInSuperadmin(request);
  const res = await request.post(`/api/admin/${slug}/cricket/auction`, { data: body });
  return { status: res.status(), body: await res.json() };
}

test.describe.serial("cricket: auction engine", () => {
  test.setTimeout(240_000);
  let league: CricketLeagueRef;
  let tournamentId = "";
  const teamIndex = new Map<string, number>();

  async function signInAs(request: APIRequestContext, teamId: string) {
    await apiSignInTeam(request, league.slug, teamIndex.get(teamId)!);
  }

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    const t = await seedMiniTournament(request, uniqueSlug("auc"));
    tournamentId = t.id;
    league = await createCricketAuctionLeague(request, { tournamentId, settings: { purse: 5000 } });
    for (let i = 1; i <= league.teamSize; i++) teamIndex.set((await ensureTeamPerson(league.slug, i)).teamId, i);
  });

  test("admin: the player auction can't start before the franchise auction finishes", async ({ request }) => {
    const badPause = await admin(request, league.slug, { action: "create", type: "player", intermissionSeconds: 99 });
    expect(badPause.status).toBe(400);
    const p = await admin(request, league.slug, { action: "create", type: "player", bidTimerSeconds: 4, nominationTimeoutSeconds: 6 });
    expect(p.status).toBe(200);
    const start = await admin(request, league.slug, { action: "start", sessionId: p.body.sessionId });
    expect(start.status).toBe(409);
    expect(start.body.error).toMatch(/franchise auction/);
  });

  test("user: franchise auction — nominate, outbid, sell; the rising floor moves", async ({ request }) => {
    const f = await admin(request, league.slug, { action: "create", type: "franchise", bidTimerSeconds: 4, nominationTimeoutSeconds: 6 });
    expect(f.status).toBe(200);
    expect((await admin(request, league.slug, { action: "start", sessionId: f.body.sessionId })).status).toBe(200);

    let s = await waitFor(request, league.slug, (x) => !!x.current?.nominationDeadline);
    const nominator = s.current!.nominatorTeamId!;
    const rcb = s.franchises.find((x) => x.code === "RCB")!;
    expect(rcb.openingPrice).toBe(800);

    // Not your turn → refused.
    const other = [...teamIndex.keys()].find((id) => id !== nominator)!;
    await signInAs(request, other);
    expect((await request.post("/api/cricket/auction/nominate", { data: { league: league.slug, cricketTeamId: rcb.id } })).status()).toBe(403);

    await signInAs(request, nominator);
    const nom = await request.post("/api/cricket/auction/nominate", { data: { league: league.slug, cricketTeamId: rcb.id } });
    expect(nom.status(), await nom.text()).toBe(200);
    s = await state(request, league.slug);
    expect(s.current!.lot).toMatchObject({ kind: "franchise", currentHighBid: 800, currentHighBidderId: nominator, nextMinBid: 825 });

    // The nominator can't outbid themselves; a bid below the ladder step is refused.
    expect((await request.post("/api/cricket/auction/bid", { data: { league: league.slug, lotId: s.current!.lot!.id, amount: 825 } })).status()).toBe(400);
    await signInAs(request, other);
    expect((await request.post("/api/cricket/auction/bid", { data: { league: league.slug, lotId: s.current!.lot!.id, amount: 810 } })).status()).toBe(400);
    const bid = await request.post("/api/cricket/auction/bid", { data: { league: league.slug, lotId: s.current!.lot!.id, amount: 825 } });
    expect(bid.status(), await bid.text()).toBe(200);
    // The open lot carries its nomination and bids, oldest first.
    s = await state(request, league.slug);
    expect(s.current!.lot!.history.map((h) => [h.type, h.teamId, h.amount])).toEqual([
      ["nomination", nominator, 800],
      ["bid", other, 825],
    ]);

    s = await waitFor(request, league.slug, (x) => !x.current?.lot && !!x.current?.intermissionUntil);
    // The pause after the sale says what was sold, to whom, for how much.
    expect(s.current!.lastOutcome).toMatchObject({ type: "sold", kind: "franchise", teamId: other, price: 825 });
    const owner = s.franchises.find((x) => x.code === "RCB")!;
    expect(owner.ownerTeamId).toBe(other);
    // The feed lists the closed lot with its whole history.
    const feed = await (await request.get(`/api/cricket/auction/feed?league=${league.slug}`)).json();
    expect(feed.lots[0]).toMatchObject({ status: "sold", lotNumber: 1, teamId: other, price: 825 });
    expect(feed.lots[0].logs.map((l: { type: string }) => l.type)).toEqual(["nomination", "bid", "sold"]);
    expect(s.teams.find((t) => t.id === other)!.purse).toBe(5000 - 825);
    // Every franchise still unsold now opens at least at the average sold price (825).
    for (const fr of s.franchises.filter((x) => !x.ownerTeamId)) expect(fr.openingPrice).toBeGreaterThanOrEqual(825);
  });

  test("user: franchise auction — a missed nomination auto-nominates, then everyone ends with one", async ({ request }) => {
    // Let every remaining turn time out: each is auto-nominated for the team and sells to it.
    const s = await waitFor(request, league.slug, (x) => x.teams.every((t) => t.franchiseId !== null), 150_000);
    const owners = new Set(s.franchises.filter((f) => f.ownerTeamId).map((f) => f.ownerTeamId));
    expect(owners.size).toBe(4);
    expect((await admin(request, league.slug, { action: "complete", sessionId: s.current!.sessionId })).status).toBe(200);
    const db = testDb();
    expect(await db.select().from(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, league.id))).toHaveLength(4);
  });

  test("user: player auction — base-price opening, reserve rule, penalty and redemption, wishlist", async ({ request }) => {
    let s = await state(request, league.slug);
    const playerSession = s.current!;
    expect(playerSession.type).toBe("player");
    expect((await admin(request, league.slug, { action: "start", sessionId: playerSession.sessionId })).status).toBe(200);

    // First nominator nominates a WK at base price.
    s = await waitFor(request, league.slug, (x) => !!x.current?.nominationDeadline);
    const first = s.current!.nominatorTeamId!;
    const db = testDb();
    const [wk] = await db.select().from(cricketPlayers).where(and(eq(cricketPlayers.tournamentId, tournamentId), eq(cricketPlayers.code, "MI1")));
    await signInAs(request, first);
    const nom = await request.post("/api/cricket/auction/nominate", { data: { league: league.slug, playerId: wk.id } });
    expect(nom.status(), await nom.text()).toBe(200);
    s = await state(request, league.slug);
    expect(s.current!.lot).toMatchObject({ kind: "player", currentHighBid: wk.basePrice, currentHighBidderId: first });

    // Another team may not bid past its reserve (purse minus 3 more players at the cheapest price).
    const bidder = [...teamIndex.keys()].find((id) => id !== first)!;
    const maxBid = s.teams.find((t) => t.id === bidder)!.maxBid;
    await signInAs(request, bidder);
    const tooMuch = await request.post("/api/cricket/auction/bid", { data: { league: league.slug, lotId: s.current!.lot!.id, amount: maxBid + 25 } });
    expect(tooMuch.status()).toBe(400);
    expect((await tooMuch.json()).error).toMatch(/complete your squad/);
    s = await waitFor(request, league.slug, (x) => !x.current?.lot && !!x.current?.intermissionUntil);
    expect(s.teams.find((t) => t.id === first)!.squadSize).toBe(1);

    // Next nominator: empty wishlist, misses the window → penalty slot; then redeems it.
    s = await waitFor(request, league.slug, (x) => !!x.current?.nominationDeadline && !x.current.intermissionUntil);
    const late = s.current!.nominatorTeamId!;
    // The pause after a missed turn says so.
    s = await waitFor(request, league.slug, (x) => x.teams.find((t) => t.id === late)!.penaltySlots === 1 && x.current?.lastOutcome?.type === "penalised");
    expect(s.current!.lastOutcome).toMatchObject({ type: "penalised", teamId: late });
    await signInAs(request, late);
    const purseBefore = s.teams.find((t) => t.id === late)!.purse;
    const redeem = await request.post("/api/cricket/auction/redeem", { data: { league: league.slug } });
    expect(redeem.status(), await redeem.text()).toBe(200);
    s = await state(request, league.slug);
    expect(s.teams.find((t) => t.id === late)!).toMatchObject({ penaltySlots: 0, purse: purseBefore - 25 });

    // A team with a wishlist gets its first affordable player nominated when its window runs out.
    const [bowler] = await db.select().from(cricketPlayers).where(and(eq(cricketPlayers.tournamentId, tournamentId), eq(cricketPlayers.code, "KKR5")));
    for (const id of teamIndex.keys()) {
      await signInAs(request, id);
      expect((await request.put("/api/cricket/auction/wishlist", { data: { league: league.slug, playerIds: [bowler.id] } })).status()).toBe(200);
    }
    s = await waitFor(request, league.slug, (x) => x.current?.lot?.playerId === bowler.id, 60_000);
    expect(s.current!.lot!.currentHighBid).toBe(bowler.basePrice);
  });

  test("admin: move a sale to another team, checked like a purchase", async ({ request }) => {
    // Hold the auction still so no lot opens mid-move.
    let s = await waitFor(request, league.slug, (x) => !x.current?.lot, 30_000);
    const sessionId = s.current!.sessionId;
    // Whose turn it is can only be set while paused.
    const running = await admin(request, league.slug, { action: "set-nominator", sessionId, direction: "forward" });
    expect(running.status).toBe(409);
    await admin(request, league.slug, { action: "pause", sessionId });
    s = await state(request, league.slug);
    if (s.current?.lot) await admin(request, league.slug, { action: "cancel-lot", sessionId });

    // Turn corrections: one forward, owed turns at the back and the front, and taking them back.
    s = await state(request, league.slug);
    const ring = s.current!.ring;
    const was = ring.indexOf(s.current!.nominatorTeamId!);
    expect((await admin(request, league.slug, { action: "set-nominator", sessionId, direction: "forward" })).status).toBe(200);
    s = await state(request, league.slug);
    expect(s.current!.nominatorTeamId).toBe(ring[(was + 1) % ring.length]);
    expect((await admin(request, league.slug, { action: "grant-turn", sessionId, teamId: ring[2] })).status).toBe(200);
    expect((await admin(request, league.slug, { action: "grant-turn", sessionId, teamId: ring[1], position: "front" })).status).toBe(200);
    expect((await state(request, league.slug)).current!.makeupQueue).toEqual([ring[1], ring[2]]);
    expect((await admin(request, league.slug, { action: "dequeue-makeup", sessionId, teamId: ring[1] })).status).toBe(200);
    expect((await admin(request, league.slug, { action: "dequeue-makeup", sessionId, index: 0 })).status).toBe(200);
    expect((await state(request, league.slug)).current!.makeupQueue).toEqual([]);

    const db = testDb();
    const purses = async () => new Map((await db.select().from(cricketTeamState).where(eq(cricketTeamState.leagueId, league.id))).map((r) => [r.teamId, r.purse]));
    const [sale] = await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id));
    const to = [...teamIndex.keys()].find((id) => id !== sale.teamId)!;
    const before = await purses();

    const same = await admin(request, league.slug, { action: "transfer-sale", lotId: sale.lotId, toTeamId: sale.teamId });
    expect(same.status).toBe(400);
    const tooMuch = await admin(request, league.slug, { action: "transfer-sale", lotId: sale.lotId, toTeamId: to, price: 1_000_000 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/complete your squad/);

    const moved = await admin(request, league.slug, { action: "transfer-sale", lotId: sale.lotId, toTeamId: to, price: sale.price + 5 });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const after = await purses();
    expect(after.get(sale.teamId)).toBe(before.get(sale.teamId)! + sale.price);
    expect(after.get(to)).toBe(before.get(to)! - (sale.price + 5));
    const [row] = await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.id, sale.id));
    expect(row).toMatchObject({ teamId: to, price: sale.price + 5 });
    s = await state(request, league.slug);
    expect(s.teams.find((t) => t.id === to)!.purse).toBe(after.get(to));

    // Every team owns a franchise, so none can take another.
    const [franchise] = await db.select().from(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, league.id));
    const other = [...teamIndex.keys()].find((id) => id !== franchise.teamId)!;
    const fr = await admin(request, league.slug, { action: "transfer-sale", lotId: franchise.lotId, toTeamId: other });
    expect(fr.status).toBe(400);
    expect(fr.body.error).toMatch(/already own a franchise/);

    expect((await admin(request, league.slug, { action: "resume", sessionId })).status).toBe(200);
  });

  test("admin: undo a sale, and completing with short squads needs force", async ({ request }) => {
    let s = await waitFor(request, league.slug, (x) => !x.current?.lot, 30_000);
    const db = testDb();
    const sold = await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id));
    expect(sold.length).toBeGreaterThanOrEqual(2);
    const sale = sold[0];
    const [before] = await db.select().from(cricketTeamState).where(eq(cricketTeamState.teamId, sale.teamId));
    expect((await admin(request, league.slug, { action: "undo-sale", lotId: sale.lotId })).status).toBe(200);
    const [after] = await db.select().from(cricketTeamState).where(eq(cricketTeamState.teamId, sale.teamId));
    expect(after.purse).toBe(before.purse + sale.price);

    await admin(request, league.slug, { action: "pause", sessionId: s.current!.sessionId });
    s = await state(request, league.slug);
    if (s.current?.lot) await admin(request, league.slug, { action: "cancel-lot", sessionId: s.current.sessionId });
    const plain = await admin(request, league.slug, { action: "complete", sessionId: s.current!.sessionId });
    expect(plain.status).toBe(409);
    expect(plain.body.error).toMatch(/short of a full squad/);
    expect((await admin(request, league.slug, { action: "complete", sessionId: s.current!.sessionId, force: true })).status).toBe(200);

    // Squads are final now: no undoing or moving a sale, of a player or of a franchise.
    const [fr] = await db.select().from(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, league.id));
    expect((await admin(request, league.slug, { action: "undo-sale", lotId: fr.lotId })).status).toBe(409);
    const [sq] = await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id));
    const elsewhere = [...teamIndex.keys()].find((id) => id !== sq.teamId);
    expect((await admin(request, league.slug, { action: "transfer-sale", lotId: sq.lotId, toTeamId: elsewhere })).status).toBe(409);
  });
});

test.describe.serial("cricket: simulated auction and scoring", () => {
  let league: CricketLeagueRef;
  let tournamentId = "";

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    tournamentId = (await seedMiniTournament(request, uniqueSlug("sim"))).id;
    league = await createCricketAuctionLeague(request, { tournamentId, settings: { purse: 5000, franchiseBoostPercent: 50 } });
  });

  test("admin: simulate fills every squad and franchise", async ({ request }) => {
    const sim = await admin(request, league.slug, { action: "simulate" });
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
    expect(sim.body.franchises).toBe(4);
    expect(sim.body.players).toBeGreaterThanOrEqual(16);
    const again = await admin(request, league.slug, { action: "simulate" });
    expect(again.status).toBe(409);
  });

  test("user: standings match a hand calculation with the franchise boost", async ({ request }) => {
    await apiSignInSuperadmin(request);
    await uploadCricketSheet(request, tournamentId, "points", pointsGrid([...miniPoints(1), ...miniPoints(2), ...miniPoints(3)]));
    const db = testDb();
    const [squads, franchises, players, points] = await Promise.all([
      db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id)),
      db.select().from(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, league.id)),
      db.select().from(cricketPlayers).where(eq(cricketPlayers.tournamentId, tournamentId)),
      db.select().from(cricketPlayerPoints).where(eq(cricketPlayerPoints.tournamentId, tournamentId)),
    ]);
    const teamOfPlayer = new Map(players.map((p) => [p.id, p.teamId]));
    const franchiseOf = new Map(franchises.map((f) => [f.teamId, f.cricketTeamId]));
    const expected = new Map<string, number>();
    for (const sq of squads) {
      const raw = points.filter((p) => p.playerId === sq.playerId).reduce((s, p) => s + p.points, 0);
      const boosted = franchiseOf.get(sq.teamId) === teamOfPlayer.get(sq.playerId);
      expected.set(sq.teamId, (expected.get(sq.teamId) ?? 0) + (boosted ? raw * 1.5 : raw));
    }
    const view = await request.get(`/api/cricket/league?league=${league.slug}`).then((r) => r.json());
    for (const row of view.standings.rows as Array<{ teamId: string; total: number }>) {
      expect(row.total).toBeCloseTo(expected.get(row.teamId) ?? 0, 2);
    }
    // Teams are named after their franchise.
    expect(view.teams.every((t: { franchise: { name: string } | null; name: string }) => t.franchise && t.name === t.franchise.name)).toBe(true);
  });
});

test.describe.serial("cricket: auction room", () => {
  test("user: sees the lot and bids from the room", async ({ page, request }) => {
    test.setTimeout(180_000);
    await apiSignInSuperadmin(request);
    const t = await seedMiniTournament(request, uniqueSlug("room"));
    const league = await createCricketAuctionLeague(request, { tournamentId: t.id, settings: { purse: 5000 } });
    const teamIdx = new Map<string, number>();
    for (let i = 1; i <= league.teamSize; i++) teamIdx.set((await ensureTeamPerson(league.slug, i)).teamId, i);
    const f = await admin(request, league.slug, { action: "create", type: "franchise", bidTimerSeconds: 60, nominationTimeoutSeconds: 120 });
    await admin(request, league.slug, { action: "start", sessionId: f.body.sessionId });
    const s = await waitFor(request, league.slug, (x) => !!x.current?.nominationDeadline);
    const nominator = s.current!.nominatorTeamId!;
    await apiSignInTeam(request, league.slug, teamIdx.get(nominator)!);
    const mi = s.franchises.find((x) => x.code === "MI")!;
    expect((await request.post("/api/cricket/auction/nominate", { data: { league: league.slug, cricketTeamId: mi.id } })).status()).toBe(200);

    const other = [...teamIdx.keys()].find((id) => id !== nominator)!;
    await uiSignInTeam(page, league.slug, teamIdx.get(other)!);
    await page.goto(`/${league.slug}/cricket/auction`);
    await expect(page.getByRole("heading", { name: "Mumbai Indians" })).toBeVisible();
    await page.getByRole("button", { name: /^Bid ₹/ }).first().click();
    await expect(page.getByText("You're the highest bidder")).toBeVisible({ timeout: 15_000 });
  });
});
