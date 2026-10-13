/**
 * Cricket tournament uploads, through the real superadmin API: validate is a dry run that writes
 * nothing; commit re-validates, refuses on errors (422) or a stale preview (409), and applies
 * atomically; points re-uploads replace a fixture's points.
 *
 * Run with: npm run test:e2e -- tests/league-types/cricket-uploads.spec.ts
 */

import { test, expect } from "@playwright/test";
import {
  MINI_CRICKET,
  apiSignInSuperadmin,
  commitCricketSheet,
  createCricketTournament,
  miniPoints,
  uniqueSlug,
  uploadCricketSheet,
  validateCricketSheet,
} from "../harness";

test.describe.serial("cricket: tournament uploads", () => {
  let tournamentId = "";

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    tournamentId = (await createCricketTournament(request, uniqueSlug("upl"))).id;
  });

  test("admin: players can't come before teams, and validate writes nothing", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const v = await validateCricketSheet(request, tournamentId, "players", MINI_CRICKET.players);
    expect(v.status).toBe(200);
    expect(v.body.canCommit).toBe(false);
    expect(v.body.issues?.some((i) => /Upload the Teams sheet first/.test(i.message))).toBe(true);

    const teams = await validateCricketSheet(request, tournamentId, "teams", MINI_CRICKET.teams);
    expect(teams.body.counts?.inserts).toBe(4);
    const data = await request.get(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=teams`).then((r) => r.json());
    expect(data.rows).toHaveLength(0);
  });

  test("admin: a sheet with errors is refused on commit, the fixed one goes in", async ({ request }) => {
    await apiSignInSuperadmin(request);
    await uploadCricketSheet(request, tournamentId, "teams", MINI_CRICKET.teams);

    const bad = [...MINI_CRICKET.players, { player_id: "X1", name: "Nobody", team: "GT", role: "BAT", base_price: 20 }];
    const v = await validateCricketSheet(request, tournamentId, "players", bad);
    expect(v.body.errorCount).toBe(1);
    const c = await commitCricketSheet(request, tournamentId, "players", bad, v.body.validationHash);
    expect(c.status).toBe(422);

    const ok = await uploadCricketSheet(request, tournamentId, "players", MINI_CRICKET.players);
    expect(ok.counts?.inserts).toBe(24);
    await uploadCricketSheet(request, tournamentId, "fixtures", MINI_CRICKET.fixtures);
    const fixtures = await request.get(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=fixtures`).then((r) => r.json());
    expect(fixtures.rows).toHaveLength(6);
    expect(fixtures.rows[0].startsIst).toBe("2026-04-01 19:30");
  });

  test("admin: re-uploading the same sheet changes nothing", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const v = await validateCricketSheet(request, tournamentId, "players", MINI_CRICKET.players);
    expect(v.body.counts).toMatchObject({ inserts: 0, updates: 0, deletes: 0, unchanged: 24 });
  });

  test("admin: points re-upload replaces that fixture's points only", async ({ request }) => {
    await apiSignInSuperadmin(request);
    await uploadCricketSheet(request, tournamentId, "points", [...miniPoints(1), ...miniPoints(2)]);
    const second = await uploadCricketSheet(request, tournamentId, "points", miniPoints(1, 10));
    expect(second.counts).toMatchObject({ fixtures: 1, replacedRows: 12, inserts: 12 });

    const fixtures = await request.get(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=fixtures`).then((r) => r.json());
    const f1 = fixtures.rows.find((f: { fixtureNo: number }) => f.fixtureNo === 1);
    const f2 = fixtures.rows.find((f: { fixtureNo: number }) => f.fixtureNo === 2);
    expect(f1.status).toBe("completed");
    expect(f2.pointsRows).toBe(12);
    const pts = await request.get(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=points&fixtureId=${f1.id}`).then((r) => r.json());
    const expected = miniPoints(1, 10).map((p) => p.points).sort((a, b) => Number(b) - Number(a));
    expect(pts.rows.map((r: { points: number }) => r.points)).toEqual(expected);
  });

  test("admin: a preview made before another upload can't be committed", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const stale = await validateCricketSheet(request, tournamentId, "points", miniPoints(3));
    await uploadCricketSheet(request, tournamentId, "points", miniPoints(4));
    const c = await commitCricketSheet(request, tournamentId, "points", miniPoints(3), stale.body.validationHash);
    expect(c.status).toBe(409);
  });

  test("admin: a scored fixture can't be dropped from the fixtures sheet", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const v = await validateCricketSheet(request, tournamentId, "fixtures", MINI_CRICKET.fixtures.slice(1));
    expect(v.body.canCommit).toBe(false);
    expect(v.body.issues?.some((i) => /Mini Cup fixture 1 is missing from the file but has points/.test(i.message))).toBe(true);
  });
});

test.describe.serial("cricket: group stage, playoffs and uploads by name", () => {
  let tournamentId = "";
  const playoffs = [
    { series: "Mini Cup", fixture_id: "", format: "T20", team_a: "MI", team_b: "CSK", start_time_ist: "2026-04-20 19:30", venue: "" },
    { series: "Mini Cup", fixture_id: "", format: "T20", team_a: "Royal Challengers Bengaluru", team_b: "KKR", start_time_ist: "2026-04-21 19:30", venue: "" },
  ];
  const data = (request: import("@playwright/test").APIRequestContext, kind: string) =>
    request.get(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=${kind}`).then((r) => r.json());

  test.beforeAll(async ({ request }) => {
    await apiSignInSuperadmin(request);
    tournamentId = (await createCricketTournament(request, uniqueSlug("po"))).id;
    await uploadCricketSheet(request, tournamentId, "teams", MINI_CRICKET.teams);
    // Players by name and team only — no player_id column — and one team given by its full name.
    const players = MINI_CRICKET.players.map(({ player_id: _id, ...p }, i) => (i === 0 ? { ...p, team: "Mumbai Indians" } : p));
    await uploadCricketSheet(request, tournamentId, "players", players);
    await uploadCricketSheet(request, tournamentId, "fixtures", MINI_CRICKET.fixtures);
  });

  test("admin: players uploaded without player_id get ids made from their names", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const players = await data(request, "players");
    expect(players.rows.map((p: { code: string }) => p.code)).toContain("mi-player-1");
    expect(players.rows.find((p: { code: string }) => p.code === "mi-player-1").team).toBe("MI");
    // A league tournament with no playoff fixtures yet: counts read "3 + playoffs*".
    expect(players.playoffs).toBe("pending");
  });

  test("admin: playoffs number on from the group stage and leave it alone", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const wrong = await validateCricketSheet(request, tournamentId, "fixtures", [{ ...playoffs[0], fixture_id: 10 }], { stage: "playoff" });
    expect(wrong.body.canCommit).toBe(false);
    expect(wrong.body.issues?.some((i) => /playoffs continue from its group stage: fixture ids 7–7/.test(i.message))).toBe(true);

    const body = await uploadCricketSheet(request, tournamentId, "fixtures", playoffs, { stage: "playoff" });
    expect(body.counts).toMatchObject({ inserts: 2, deletes: 0 });
    const fixtures = await data(request, "fixtures");
    expect(fixtures.rows).toHaveLength(8);
    const po = fixtures.rows.filter((f: { stage: string }) => f.stage === "playoff").map((f: { fixtureNo: number; teamA: string }) => [f.fixtureNo, f.teamA]);
    expect(po.sort()).toEqual([[7, "MI"], [8, "RCB"]]);

    // Re-uploading the group stage doesn't touch the playoffs.
    const group = await validateCricketSheet(request, tournamentId, "fixtures", MINI_CRICKET.fixtures);
    expect(group.body.counts).toMatchObject({ deletes: 0, unchanged: 6 });

    // Playoff matches now count for their teams' players.
    const players = await data(request, "players");
    expect(players.playoffs).toBe("uploaded");
    expect(players.rows.find((p: { code: string }) => p.code === "mi-player-1").playoffMatches).toBe(1);
  });

  test("admin: points by team and player name; a typo gets a suggestion", async ({ request }) => {
    await apiSignInSuperadmin(request);
    const typo = await validateCricketSheet(request, tournamentId, "points", [
      { fixture_id: 7, team: "MI", player: "MI Player 1", points: 10 },
      { fixture_id: 7, team: "CSK", player: "CSK Playr 2", points: 5 },
    ]);
    expect(typo.body.issues?.map((i) => i.message)).toContain('No CSK player called "CSK Playr 2" — did you mean CSK Player 2?');
    const ok = await uploadCricketSheet(request, tournamentId, "points", [
      { fixture_id: 7, team: "Mumbai Indians", player: "mi player 1", points: 10 },
      { fixture_id: 7, team: "CSK", player: "CSK Player 2", points: 5 },
    ]);
    expect(ok.counts).toMatchObject({ inserts: 2, fixtures: 1 });
  });
});
