/**
 * resolveTeamActor and friends (src/lib/team-actor.ts), plus the league-scoped viewer
 * (src/lib/viewer.ts), against a real SQLite database built from schema.ts.
 *
 * These are the authorization rules every team-scoped API now goes through, so each case below is
 * a way a request could otherwise act as the wrong team: an old team-login token, a person naming
 * a team they are not on, a revoked session still working.
 *
 * Run with: npm run test:unit   (builds ./team-actor-unit.db, gitignored, ~5 s)
 */

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const DB_FILE = "team-actor-unit.db";
process.env.DATABASE_URL = `file:./${DB_FILE}`;
process.env.SESSION_SECRET ??= "unit-test-secret-that-is-at-least-32-characters";

// Imported after the env is set (see before()).
let mod: {
  auth: typeof import("../../src/lib/auth");
  actor: typeof import("../../src/lib/team-actor");
  viewer: typeof import("../../src/lib/viewer");
  db: typeof import("../../src/lib/db");
};

const ids = {
  leagueA: "11111111-1111-4111-8111-111111111111", // members league "alpha"
  leagueB: "22222222-2222-4222-8222-222222222222", // members league "bravo"
  leagueL: "33333333-3333-4333-8333-333333333333", // legacy league "legacy"
  teamA1: "a1", teamA2: "a2", teamB1: "b1", teamL1: "l1", teamL2: "l2",
  alice: "u-alice", bob: "u-bob", admin: "u-admin",
};

before(async () => {
  for (const suffix of ["", "-shm", "-wal", "-journal"]) rmSync(DB_FILE + suffix, { force: true });
  const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], { env: process.env, shell: true, encoding: "utf8" });
  assert.equal(push.status, 0, `drizzle-kit push failed:\n${push.stdout}\n${push.stderr}`);

  mod = {
    auth: await import("../../src/lib/auth"),
    actor: await import("../../src/lib/team-actor"),
    viewer: await import("../../src/lib/viewer"),
    db: await import("../../src/lib/db"),
  };
  const { db, leagues, teams, users, teamMembers, leagueAdmins } = mod.db;
  await mod.db.fkReady;

  const league = (id: string, slug: string, authMode: "legacy" | "members") =>
    ({ id, slug, name: slug, sport: "fpl", format: "tvt", season: "2026-27", authMode });
  await db.insert(leagues).values([
    league(ids.leagueA, "alpha", "members"),
    league(ids.leagueB, "bravo", "members"),
    league(ids.leagueL, "legacy", "legacy"),
  ]);
  const team = (id: string, leagueId: string) => ({ id, leagueId, name: id, teamLoginId: `key-${id}`, password: "" });
  await db.insert(teams).values([
    team(ids.teamA1, ids.leagueA), team(ids.teamA2, ids.leagueA), team(ids.teamB1, ids.leagueB),
    team(ids.teamL1, ids.leagueL), team(ids.teamL2, ids.leagueL),
  ]);
  const user = (id: string, role: string) => ({ id, email: `${id}@example.com`, password: "", name: id, role, username: id });
  await db.insert(users).values([user(ids.alice, "user"), user(ids.bob, "user"), user(ids.admin, "admin")]);
  await db.insert(teamMembers).values([
    // Alice plays in two leagues; Bob is her teammate in alpha; the admin also plays in bravo.
    { id: "m1", teamId: ids.teamA1, leagueId: ids.leagueA, userId: ids.alice, role: "owner" },
    { id: "m2", teamId: ids.teamB1, leagueId: ids.leagueB, userId: ids.alice, role: "owner" },
    { id: "m3", teamId: ids.teamA1, leagueId: ids.leagueA, userId: ids.bob, role: "member" },
    { id: "m4", teamId: ids.teamB1, leagueId: ids.leagueB, userId: ids.admin, role: "member" },
  ]);
  await db.insert(leagueAdmins).values({ id: "la1", leagueId: ids.leagueA, userId: ids.admin });
});

const session = async (id: string, type: "user" | "admin" | "superadmin", sv?: number) =>
  (await mod.auth.verifySession(await mod.auth.createSession(id, type, { sv })))!;

test("no session → unauthenticated", async () => {
  assert.deepEqual(await mod.actor.resolveTeamActorForSession(null, { league: "alpha" }), { denial: "unauthenticated" });
});

test("an old team-login token no longer verifies, so it can't act as its team", async () => {
  // Team logins are gone; createSession only signs what it's given.
  const token = await mod.auth.createSession(ids.teamL1, "team" as never);
  assert.equal(await mod.auth.verifySession(token), null);
});

test("nobody acts for a team in a league that hasn't been switched to Google sign-in yet", async () => {
  for (const id of [ids.alice, ids.bob, ids.admin]) {
    const s = await session(id, id === ids.admin ? "admin" : "user");
    assert.equal((await mod.actor.resolveTeamActorForSession(s, { league: "legacy" })).denial, "forbidden");
    assert.equal((await mod.actor.resolveTeamActorForSession(s, { teamId: ids.teamL2 })).denial, "forbidden");
  }
});

test("a person must name a league or a team", async () => {
  const s = await session(ids.alice, "user");
  assert.equal((await mod.actor.resolveTeamActorForSession(s)).denial, "league-required");
});

test("a person resolves to their team in the named league — by slug, id or team", async () => {
  const s = await session(ids.alice, "user");
  const inAlpha = { teamId: ids.teamA1, leagueId: ids.leagueA, userId: ids.alice, memberRole: "owner" };
  assert.deepEqual((await mod.actor.resolveTeamActorForSession(s, { league: "alpha" })).actor, inAlpha);
  assert.deepEqual((await mod.actor.resolveTeamActorForSession(s, { league: ids.leagueA })).actor, inAlpha);
  assert.deepEqual((await mod.actor.resolveTeamActorForSession(s, { teamId: ids.teamA1 })).actor, inAlpha);
  // Same person, other league: switching leagues is just naming a different one.
  assert.equal((await mod.actor.resolveTeamActorForSession(s, { league: "bravo" })).actor?.teamId, ids.teamB1);
});

test("a teammate resolves to the same team with their own role", async () => {
  const s = await session(ids.bob, "user");
  const { actor } = await mod.actor.resolveTeamActorForSession(s, { league: "alpha" });
  assert.equal(actor?.teamId, ids.teamA1);
  assert.equal(actor?.memberRole, "member");
});

test("a person is refused where they are not a member", async () => {
  const bob = await session(ids.bob, "user");
  assert.equal((await mod.actor.resolveTeamActorForSession(bob, { league: "bravo" })).denial, "forbidden");
  assert.equal((await mod.actor.resolveTeamActorForSession(bob, { league: "legacy" })).denial, "forbidden");
  // Another team in a league they ARE in.
  assert.equal((await mod.actor.resolveTeamActorForSession(bob, { teamId: ids.teamA2 })).denial, "forbidden");
  // A team id and a league that disagree.
  const alice = await session(ids.alice, "user");
  assert.equal((await mod.actor.resolveTeamActorForSession(alice, { teamId: ids.teamA1, league: "bravo" })).denial, "forbidden");
});

test("an unknown league is refused, not treated as 'no league'", async () => {
  const s = await session(ids.alice, "user");
  assert.equal((await mod.actor.resolveTeamActorForSession(s, { league: "no-such-league" })).denial, "forbidden");
});

test("admins can play too: an admin's membership resolves like anyone's", async () => {
  const s = await session(ids.admin, "admin");
  assert.equal((await mod.actor.resolveTeamActorForSession(s, { league: "bravo" })).actor?.teamId, ids.teamB1);
  assert.equal((await mod.actor.resolveTeamActorForSession(s, { league: "alpha" })).denial, "forbidden");
});

test("bumping session_version revokes older tokens immediately", async () => {
  const { db, users } = mod.db;
  const { eq } = await import("drizzle-orm");
  const old = await session(ids.bob, "user"); // minted at version 0
  assert.ok((await mod.actor.resolveTeamActorForSession(old, { league: "alpha" })).actor);

  await db.update(users).set({ sessionVersion: 1 }).where(eq(users.id, ids.bob));
  try {
    assert.equal((await mod.actor.resolveTeamActorForSession(old, { league: "alpha" })).denial, "forbidden");
    assert.deepEqual(await mod.actor.listSessionTeamIds(old), []);
    const fresh = await session(ids.bob, "user", 1);
    assert.equal((await mod.actor.resolveTeamActorForSession(fresh, { league: "alpha" })).actor?.teamId, ids.teamA1);
  } finally {
    await db.update(users).set({ sessionVersion: 0 }).where(eq(users.id, ids.bob));
  }
});

test("listSessionTeamIds spans every league a person plays in", async () => {
  assert.deepEqual((await mod.actor.listSessionTeamIds(await session(ids.alice, "user"))).sort(), [ids.teamA1, ids.teamB1]);
  assert.deepEqual(await mod.actor.listSessionTeamIds(await session(ids.admin, "admin")), [ids.teamB1]);
  assert.deepEqual(await mod.actor.listSessionTeamIds(null), []);
});

test("sessionActsAsTeam and sessionTeamIdInLeague", async () => {
  const alice = await session(ids.alice, "user");
  assert.equal(await mod.actor.sessionActsAsTeam(alice, ids.teamA1), true);
  assert.equal(await mod.actor.sessionActsAsTeam(alice, ids.teamA2), false);
  assert.equal(await mod.actor.sessionActsAsTeam(alice, null), false);
  assert.equal(await mod.actor.sessionTeamIdInLeague(alice, ids.leagueB), ids.teamB1);
  assert.equal(await mod.actor.sessionTeamIdInLeague(alice, "legacy"), null);
  assert.equal(await mod.actor.sessionTeamIdInLeague(null, "alpha"), null);
});

test("viewer: teamId is the viewer's team in THIS league only", async () => {
  const alice = await session(ids.alice, "user");
  const inAlpha = await mod.viewer.resolveViewerForLeague(alice, ids.leagueA);
  assert.equal(inAlpha.authenticated, true);
  assert.equal(inAlpha.type, "user");
  assert.equal(inAlpha.username, ids.alice);
  assert.equal(inAlpha.teamId, ids.teamA1);
  assert.equal((await mod.viewer.resolveViewerForLeague(alice, ids.leagueB)).teamId, ids.teamB1);
  assert.equal((await mod.viewer.resolveViewerForLeague(alice, ids.leagueL)).teamId, undefined);
});

test("viewer: isLeagueAdmin for this league's admins only", async () => {
  const admin = await session(ids.admin, "admin");
  assert.equal((await mod.viewer.resolveViewerForLeague(admin, ids.leagueA)).isLeagueAdmin, true);
  assert.equal((await mod.viewer.resolveViewerForLeague(admin, ids.leagueB)).isLeagueAdmin, false);
});

test("viewer: a revoked or deleted person reads as signed out", async () => {
  const stale = await session(ids.alice, "user", 7); // users row is at version 0
  assert.equal((await mod.viewer.resolveViewerForSession(stale)).authenticated, false);
  const ghost = await session("u-nobody", "user");
  assert.equal((await mod.viewer.resolveViewerForSession(ghost)).authenticated, false);
});
