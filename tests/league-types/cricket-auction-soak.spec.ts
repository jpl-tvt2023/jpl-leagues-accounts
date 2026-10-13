/**
 * Cricket auction under concurrency: 12 pollers hammer the state endpoint (each read advances the
 * session's clock, like every connected browser's stream does) while turns time out and
 * auto-nominate from wishlists. Afterwards: turns followed the ring with no skips or double turns,
 * every lot sold exactly once, and every purse adds up.
 *
 * Opt-in, and best run on its own (see playwright.config.ts):
 *   SOAK=1 npm run test:e2e -- tests/league-types/cricket-auction-soak.spec.ts
 */

import { test, expect } from "@playwright/test";
import { asc, eq, inArray } from "drizzle-orm";
import {
  MINI_CRICKET,
  apiSignInSuperadmin,
  apiSignInTeam,
  createCricketAuctionLeague,
  ensureTeamPerson,
  seedMiniTournament,
  testDb,
  uniqueSlug,
} from "../harness";
import {
  cricketAuctionBidLogs,
  cricketAuctionLots,
  cricketAuctionSessions,
  cricketPlayers,
  cricketSquadPlayers,
  cricketTeamState,
} from "../../src/lib/db/schema-cricket";

const LOTS = 8;
const POLLERS = 12;

test("system: concurrent pollers never skip, double or double-sell", async ({ request }) => {
  test.setTimeout(300_000);
  await apiSignInSuperadmin(request);
  const t = await seedMiniTournament(request, uniqueSlug("soak"));
  const league = await createCricketAuctionLeague(request, {
    tournamentId: t.id,
    settings: { purse: 5000, franchiseAuctionEnabled: false, squadRules: { minSize: 4, maxSize: 5, roleMin: { WK: 0, BAT: 0, AR: 0, BOWL: 0 }, roleMax: {}, maxPerRealTeam: null, maxOverseas: null } },
  });

  // Every team gets a long wishlist so every timeout auto-nominates.
  const db = testDb();
  const players = await db.select().from(cricketPlayers).where(eq(cricketPlayers.tournamentId, t.id));
  const ids = players.map((p) => p.id);
  for (let i = 1; i <= league.teamSize; i++) {
    await ensureTeamPerson(league.slug, i);
    await apiSignInTeam(request, league.slug, i);
    const rotated = [...ids.slice(i * 5), ...ids.slice(0, i * 5)];
    expect((await request.put("/api/cricket/auction/wishlist", { data: { league: league.slug, playerIds: rotated } })).status()).toBe(200);
  }
  expect(MINI_CRICKET.players.length).toBe(ids.length);

  await apiSignInSuperadmin(request);
  const created = await request.post(`/api/admin/${league.slug}/cricket/auction`, { data: { action: "create", type: "player", bidTimerSeconds: 2, nominationTimeoutSeconds: 2 } });
  const sessionId = (await created.json()).sessionId;
  expect((await request.post(`/api/admin/${league.slug}/cricket/auction`, { data: { action: "start", sessionId } })).status()).toBe(200);

  const lotCount = async () =>
    (await db.select({ id: cricketAuctionLots.id }).from(cricketAuctionLots).where(eq(cricketAuctionLots.sessionId, sessionId))).filter(Boolean).length;
  const end = Date.now() + 240_000;
  while ((await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id))).length < LOTS && Date.now() < end) {
    await Promise.all(Array.from({ length: POLLERS }, () => request.get(`/api/cricket/auction/state?league=${league.slug}`)));
    await new Promise((r) => setTimeout(r, 400));
  }
  expect(await lotCount()).toBeGreaterThanOrEqual(LOTS);
  await request.post(`/api/admin/${league.slug}/cricket/auction`, { data: { action: "pause", sessionId } });

  const [session] = await db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.id, sessionId));
  const ring: string[] = JSON.parse(session.ringOrder);
  const lots = await db.select().from(cricketAuctionLots).where(eq(cricketAuctionLots.sessionId, sessionId)).orderBy(asc(cricketAuctionLots.createdAt));
  const sold = lots.filter((l) => l.status === "sold");

  // No cancelled duplicates, and each sold lot logged "sold" exactly once.
  expect(lots.filter((l) => l.status === "cancelled")).toHaveLength(0);
  const logs = await db.select().from(cricketAuctionBidLogs).where(inArray(cricketAuctionBidLogs.lotId, sold.map((l) => l.id)));
  for (const l of sold) expect(logs.filter((g) => g.lotId === l.id && g.type === "sold")).toHaveLength(1);

  // Turns follow the ring exactly: lot k was nominated by ring[k mod n].
  sold.forEach((l, k) => expect(l.nominatorTeamId, `lot ${k + 1}`).toBe(ring[k % ring.length]));

  // Each squad row matches a sold lot, and purses add up.
  const squad = await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id));
  expect(new Set(squad.map((s) => s.playerId)).size).toBe(squad.length);
  expect(squad.length).toBe(sold.length);
  const states = await db.select().from(cricketTeamState).where(eq(cricketTeamState.leagueId, league.id));
  for (const s of states) {
    const spent = squad.filter((q) => q.teamId === s.teamId).reduce((sum, q) => sum + q.price, 0);
    expect(s.purse).toBe(5000 - spent);
  }
});
