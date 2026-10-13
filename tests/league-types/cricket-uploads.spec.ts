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
