/**
 * Cricket league backups (console Backup tab), through the real admin API: the download zip, stored
 * snapshots (by hand and when the player auction completes), and restore — which brings squads,
 * franchises, purses, penalties and team names back exactly, and refuses (writing nothing) a backup
 * that names a player the tournament doesn't have, or any restore while a session is running.
 *
 * Run with: npm run test:e2e -- tests/league-types/cricket-backup.spec.ts
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import JSZip from "jszip";
import { asc, eq } from "drizzle-orm";
import { apiSignInSuperadmin, createCricketAuctionLeague, seedMiniTournament, testDb, uniqueSlug, type CricketLeagueRef } from "../harness";
import {
  cricketAuctionLots,
  cricketFranchiseOwnership,
  cricketPlayers,
  cricketSquadPlayers,
  cricketTeamState,
  cricketTeams,
} from "../../src/lib/db/schema-cricket";
import { teams } from "../../src/lib/db/schema";

const admin = async (request: APIRequestContext, slug: string, body: Record<string, unknown>) => {
  await apiSignInSuperadmin(request);
  const res = await request.post(`/api/admin/${slug}/cricket/auction`, { data: body });
  return { status: res.status(), body: await res.json() };
};

/** Everything a restore must bring back, keyed by codes and names so ids can change. */
async function stateOf(leagueId: string) {
  const db = testDb();
  const [squads, franchises, states, names] = await Promise.all([
    db
      .select({ teamId: cricketSquadPlayers.teamId, code: cricketPlayers.code, price: cricketSquadPlayers.price })
      .from(cricketSquadPlayers)
      .innerJoin(cricketPlayers, eq(cricketPlayers.id, cricketSquadPlayers.playerId))
      .where(eq(cricketSquadPlayers.leagueId, leagueId)),
    db
      .select({ teamId: cricketFranchiseOwnership.teamId, code: cricketTeams.code, price: cricketFranchiseOwnership.price })
      .from(cricketFranchiseOwnership)
      .innerJoin(cricketTeams, eq(cricketTeams.id, cricketFranchiseOwnership.cricketTeamId))
      .where(eq(cricketFranchiseOwnership.leagueId, leagueId)),
    db.select().from(cricketTeamState).where(eq(cricketTeamState.leagueId, leagueId)).orderBy(asc(cricketTeamState.teamId)),
    db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.leagueId, leagueId)).orderBy(asc(teams.id)),
  ]);
  const key = (r: { teamId: string; code: string; price: number }) => `${r.teamId}:${r.code}:${r.price}`;
  return {
    squads: squads.map(key).sort(),
    franchises: franchises.map(key).sort(),
    money: states.map((s) => [s.teamId, s.purse, s.spent, s.penaltySlots]),
    names,
  };
}

test.describe.serial("cricket: backup and restore", () => {
  test.setTimeout(180_000);
  let league: CricketLeagueRef;
  let tournamentId = "";

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    tournamentId = (await seedMiniTournament(request, uniqueSlug("bak"))).id;
    league = await createCricketAuctionLeague(request, { tournamentId, settings: { purse: 5000 } });
    const sim = await admin(request, league.slug, { action: "simulate" });
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
  });

  test("admin: the download is a zip with backup.json and readable sheets", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const res = await request.get(`/api/admin/${league.slug}/cricket/backup`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/zip");
    const zip = await JSZip.loadAsync(await res.body());
    expect(Object.keys(zip.files).sort()).toEqual(["backup.json", "franchises.xlsx", "penalties.xlsx", "settings.xlsx", "squads.xlsx", "teams.xlsx"]);
    const backup = JSON.parse(await zip.file("backup.json")!.async("string"));
    const state = await stateOf(league.id);
    expect(backup.squads).toHaveLength(state.squads.length);
    expect(backup.franchises).toHaveLength(4);
    expect(backup.league.slug).toBe(league.slug);
  });

  test("admin: a snapshot taken by hand restores everything after a reset", async ({ request }) => {
    await apiSignInSuperadmin(request);
    // A renamed team, so names are covered too.
    const list = await request.get(`/api/admin/${league.slug}/cricket/teams`).then((r) => r.json());
    await request.patch(`/api/admin/${league.slug}/cricket/teams`, { data: { teamId: list.teams[0].id, name: "Backed Up XI" } });
    const before = await stateOf(league.id);

    const taken = await request.post(`/api/admin/${league.slug}/cricket/backups`);
    expect(taken.status()).toBe(201);
    const listed = await request.get(`/api/admin/${league.slug}/cricket/backups`).then((r) => r.json());
    const snap = listed.backups.find((b: { trigger: string }) => b.trigger === "manual");
    expect(snap).toBeTruthy();

    expect((await admin(request, league.slug, { action: "reset" })).status).toBe(200);
    await request.patch(`/api/admin/${league.slug}/cricket/teams`, { data: { teamId: list.teams[0].id, name: "Something Else" } });
    expect((await stateOf(league.id)).squads).toHaveLength(0);

    const restored = await request.post(`/api/admin/${league.slug}/cricket/restore`, { data: { backupId: snap.id } });
    expect(restored.status(), await restored.text()).toBe(200);
    expect(await stateOf(league.id)).toEqual(before);

    // Every restored purchase has its sold lot, so undo, move and the sales feed keep working.
    const db = testDb();
    const squads = await db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, league.id));
    const lots = await db.select().from(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, league.id));
    for (const s of squads) {
      const lot = lots.find((l) => l.id === s.lotId);
      expect(lot).toMatchObject({ status: "sold", currentHighBidderId: s.teamId, currentHighBid: s.price, playerId: s.playerId });
    }
  });

  test("admin: a backup naming a player the tournament doesn't have is refused, and nothing changes", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const before = await stateOf(league.id);
    const res = await request.get(`/api/admin/${league.slug}/cricket/backup`);
    const zip = await JSZip.loadAsync(await res.body());
    const backup = JSON.parse(await zip.file("backup.json")!.async("string"));
    backup.squads[0].playerCode = "NOPE";
    backup.squads[0].playerName = "Nobody";
    zip.file("backup.json", JSON.stringify(backup));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const bad = await request.post(`/api/admin/${league.slug}/cricket/restore`, {
      multipart: { file: { name: "backup.zip", mimeType: "application/zip", buffer } },
    });
    expect(bad.status()).toBe(422);
    expect((await bad.json()).error).toMatch(/Nobody \(NOPE\)/);
    expect(await stateOf(league.id)).toEqual(before);
  });

  test("admin: no restore while a session runs; completing the player auction keeps a snapshot", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const other = await createCricketAuctionLeague(request, { tournamentId, settings: { purse: 5000, franchiseAuctionEnabled: false } });
    const created = await admin(request, other.slug, { action: "create", type: "player", bidTimerSeconds: 30, nominationTimeoutSeconds: 60 });
    expect(created.status).toBe(200);
    expect((await admin(request, other.slug, { action: "start", sessionId: created.body.sessionId })).status).toBe(200);
    const snap = await request.post(`/api/admin/${other.slug}/cricket/backups`).then((r) => r.json());

    const running = await request.post(`/api/admin/${other.slug}/cricket/restore`, { data: { backupId: snap.backup.id } });
    expect(running.status()).toBe(422);
    expect((await running.json()).error).toMatch(/running — pause it first/);

    expect((await admin(request, other.slug, { action: "pause", sessionId: created.body.sessionId })).status).toBe(200);
    const done = await admin(request, other.slug, { action: "complete", sessionId: created.body.sessionId, force: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const listed = await request.get(`/api/admin/${other.slug}/cricket/backups`).then((r) => r.json());
    expect(listed.backups.map((b: { trigger: string }) => b.trigger)).toContain("player-auction-complete");
  });
});
