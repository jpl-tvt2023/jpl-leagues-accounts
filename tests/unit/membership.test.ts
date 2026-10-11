/**
 * Membership rules (src/lib/membership.ts) against a real SQLite database built from schema.ts:
 * racing joins, owner succession, teammate slots, and recovery transfers that refuse to overwrite.
 *
 * Run with: npm run test:unit   (builds ./membership-unit.db, gitignored)
 */

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const DB_FILE = "membership-unit.db";
process.env.DATABASE_URL = `file:./${DB_FILE}`;
process.env.SESSION_SECRET ??= "unit-test-secret-that-is-at-least-32-characters";

let m: typeof import("../../src/lib/membership");
let d: typeof import("../../src/lib/db");
let eq: typeof import("drizzle-orm").eq;

const LEAGUE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

before(async () => {
  for (const s of ["", "-shm", "-wal", "-journal"]) rmSync(DB_FILE + s, { force: true });
  const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], { env: process.env, shell: true, encoding: "utf8" });
  assert.equal(push.status, 0, `drizzle-kit push failed:\n${push.stdout}\n${push.stderr}`);
  m = await import("../../src/lib/membership");
  d = await import("../../src/lib/db");
  ({ eq } = await import("drizzle-orm"));
  await d.fkReady;
  const { db, leagues, teams, players, users } = d;
  await db.insert(leagues).values([
    { id: LEAGUE, slug: "unit-members", name: "Unit", sport: "fpl", format: "tvt", season: "2026-27", teamSize: 3, authMode: "members" },
    { id: OTHER, slug: "unit-other", name: "Other", sport: "fpl", format: "tvt", season: "2026-27", teamSize: 1, authMode: "members" },
  ]);
  // createdAt staggered so "first open team" is deterministic.
  const t0 = Date.now();
  await db.insert(teams).values([
    { id: "t1", leagueId: LEAGUE, name: "T1", teamLoginId: "unit-t1", password: "", createdAt: new Date(t0) },
    { id: "t2", leagueId: LEAGUE, name: "T2", teamLoginId: "unit-t2", password: "", createdAt: new Date(t0 + 1) },
    { id: "t3", leagueId: LEAGUE, name: "T3", teamLoginId: "unit-t3", password: "", createdAt: new Date(t0 + 2) },
    { id: "o1", leagueId: OTHER, name: "O1", teamLoginId: "unit-o1", password: "", createdAt: new Date(t0) },
  ]);
  await db.insert(players).values([
    { id: "p1", teamId: "t1", name: "P1", fplId: "1", createdAt: new Date(t0) },
    { id: "p2", teamId: "t1", name: "P2", fplId: "2", createdAt: new Date(t0 + 1) },
  ]);
  const user = (id: string) => ({ id, email: `${id}@unit.test`, password: "", name: id, role: "user", username: id });
  await db.insert(users).values(["u1", "u2", "u3", "u4", "u5", "u6", "u7"].map(user));
});

const teamOf = async (userId: string, leagueId = LEAGUE) => (await m.teamOfUserInLeague(userId, leagueId))?.teamId ?? null;

test("joins claim teams in order; the same person can't join twice", async () => {
  assert.equal(await m.claimOpenSlot(LEAGUE, "u1", null), "t1");
  assert.equal(await m.claimOpenSlot(LEAGUE, "u2", null), "t2");
  await assert.rejects(m.claimOpenSlot(LEAGUE, "u1", null), (e: Error & { code?: string }) => e.code === "already-member");
});

test("two people racing for the last team: exactly one gets it", async () => {
  const results = await Promise.allSettled([m.claimOpenSlot(LEAGUE, "u3", null), m.claimOpenSlot(LEAGUE, "u4", null)]);
  const won = results.filter((r) => r.status === "fulfilled");
  const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(won.length, 1);
  assert.equal((won[0] as PromiseFulfilledResult<string>).value, "t3");
  assert.equal(lost[0].reason.code, "league-full");
  assert.equal(await m.countOpenSlots(LEAGUE), 0);
});

test("an invite's use limit holds", async () => {
  const invite = await m.createLeagueInvite(OTHER, null, { maxUses: 1 });
  assert.equal(await m.claimOpenSlot(OTHER, "u5", invite.id), "o1");
  const loaded = await m.loadInvite(invite.token);
  assert.equal(loaded?.problem, "used-up");
});

test("regenerating a league invite revokes the old one", async () => {
  const first = await m.createLeagueInvite(LEAGUE, null);
  const second = await m.createLeagueInvite(LEAGUE, null);
  assert.equal((await m.loadInvite(first.token))?.problem, "revoked");
  assert.notEqual((await m.loadInvite(second.token))?.problem, "revoked");
});

test("a teammate joins unlinked, then claims only a free FPL slot; the team then refuses a third person", async () => {
  // u1 owns t1 (which already has two FPL slots) and says in setup that p1 is theirs.
  await m.saveOwnPlayer("t1", "u1", { name: "P1", fplId: "1" }, "p1");
  const invite = await m.createPartnerInvite("t1", "u1");
  assert.equal(await m.joinAsPartner(invite, "u6"), "t1");
  const [row] = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "u6"));
  assert.equal(row.role, "member");
  assert.equal(row.playerId, null); // no guessing: setup asks
  assert.equal(m.needsSetup({ format: "tvt", isProfileComplete: true, playerId: row.playerId }), true);

  const code = (c: string) => (e: Error & { code?: string }) => e.code === c;
  await assert.rejects(m.saveOwnPlayer("t1", "u6", { name: "Six", fplId: "6" }), code("pick-slot")); // team is full of slots
  await assert.rejects(m.saveOwnPlayer("t1", "u6", { name: "Six", fplId: "6" }, "p1"), code("slot-taken"));
  await assert.rejects(m.saveOwnPlayer("t1", "u6", { name: "Six", fplId: "1" }, "p2"), code("duplicate-fpl-id"));
  const saved = await m.saveOwnPlayer("t1", "u6", { name: "Six", fplId: "6" }, "p2");
  assert.deepEqual(saved, { playerId: "p2", teamComplete: true });
  const slots = await m.teamSlots("t1");
  assert.deepEqual(slots.map((s) => `${s.id}:${s.fplId}:${s.userId}`), ["p1:1:u1", "p2:6:u6"]);

  const again = await m.createPartnerInvite("t1", "u1");
  await assert.rejects(m.joinAsPartner(again, "u7"), (e: Error & { code?: string }) => e.code === "team-full" || e.code === "already-member");
});

test("an owner enters a partner who won't sign in; the team is complete once every slot is filled", async () => {
  const code = (c: string) => (e: Error & { code?: string }) => e.code === c;
  await assert.rejects(m.savePartnerByOwner("t2", "u2", { name: "Mate", fplId: "21" }), code("needs-own-slot"));
  assert.equal((await m.saveOwnPlayer("t2", "u2", { name: "Two", fplId: "20" })).teamComplete, false);
  await assert.rejects(m.savePartnerByOwner("t2", "u5", { name: "Mate", fplId: "21" }), code("not-owner"));
  const first = await m.savePartnerByOwner("t2", "u2", { name: "Mate", fplId: "21" });
  assert.equal(first.teamComplete, true);
  const edited = await m.savePartnerByOwner("t2", "u2", { name: "Mate B", fplId: "22" });
  assert.equal(edited.playerId, first.playerId); // the same slot, edited
  const [t2] = await d.db.select().from(d.teams).where(eq(d.teams.id, "t2"));
  assert.equal(t2.isProfileComplete, true);
  const slots = await m.teamSlots("t2");
  assert.deepEqual(slots.map((s) => [s.fplId, s.userId]).sort(), [["20", "u2"], ["22", null]]);
});

test("removing the owner promotes the teammate (one owner per team)", async () => {
  const [owner] = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "u1"));
  await m.removeMember(LEAGUE, owner.id);
  const [mate] = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "u6"));
  assert.equal(mate.role, "owner");
});

test("transferring ownership swaps roles without ever having two owners", async () => {
  await m.assignToTeam(LEAGUE, "t1", "u1", null); // back on as teammate
  const [u1] = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "u1"));
  assert.equal(u1.role, "member");
  await m.transferOwnership(LEAGUE, u1.id);
  const rows = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.teamId, "t1"));
  assert.deepEqual(rows.map((r) => `${r.userId}:${r.role}`).sort(), ["u1:owner", "u6:member"]);
});

test("replacing an account moves the seat, but not onto someone already in the league", async () => {
  const [u2] = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "u2"));
  await assert.rejects(m.replaceMemberAccount(LEAGUE, u2.id, "u3"), (e: Error & { code?: string }) => e.code === "already-member");
  await m.replaceMemberAccount(LEAGUE, u2.id, "u7");
  assert.equal(await teamOf("u7"), "t2");
  assert.equal(await teamOf("u2"), null);
});

test("transferAllMemberships refuses conflicts and revokes the old account", async () => {
  // u5 (in OTHER) → u3 (in LEAGUE): no overlap, so it moves.
  const before = (await d.db.select({ sv: d.users.sessionVersion }).from(d.users).where(eq(d.users.id, "u5")))[0].sv;
  const res = await m.transferAllMemberships("u5", "u3");
  assert.equal(res.moved, 1);
  assert.equal(await teamOf("u3", OTHER), "o1");
  const after = (await d.db.select({ sv: d.users.sessionVersion }).from(d.users).where(eq(d.users.id, "u5")))[0].sv;
  assert.equal(after, before + 1);
  // u7 (t2) → u3 (t3): both in LEAGUE — refuse rather than overwrite.
  await assert.rejects(m.transferAllMemberships("u7", "u3"), (e: Error & { code?: string }) => e.code === "conflict");
  assert.equal(await teamOf("u7"), "t2");
});

test("releasing a team empties it and turns off its teammate invites", async () => {
  const invite = await m.createPartnerInvite("t1", "u1");
  await m.releaseTeam(LEAGUE, "t1");
  assert.equal((await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.teamId, "t1"))).length, 0);
  assert.equal((await m.loadInvite(invite.token))?.problem, "revoked");
  assert.equal(await m.countOpenSlots(LEAGUE), 1);
});

test("a superadmin can never be put on a team, by any route", async () => {
  await d.db.insert(d.users).values({ id: "sa", email: "sa@unit.test", password: "", name: "SA", role: "superadmin" });
  const isSuperadminRefusal = (e: Error & { code?: string }) => e.code === "superadmin";
  await assert.rejects(m.claimOpenSlot(LEAGUE, "sa", null), isSuperadminRefusal);
  await assert.rejects(m.fileJoinRequest(LEAGUE, "sa", (await m.createLeagueInvite(LEAGUE, null)).id), isSuperadminRefusal);
  await assert.rejects(m.joinAsPartner(await m.createPartnerInvite("t2", "u7"), "sa"), isSuperadminRefusal);
  await assert.rejects(m.assignToTeam(LEAGUE, "t1", "sa", null), isSuperadminRefusal);
  const [seat] = await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "u7"));
  await assert.rejects(m.replaceMemberAccount(LEAGUE, seat.id, "sa"), isSuperadminRefusal);
  // Recovery transfers can't hand a superadmin teams, nor make someone with teams a superadmin.
  await assert.rejects(m.transferAllMemberships("u7", "sa"), isSuperadminRefusal);
  await assert.rejects(m.transferAllMemberships("sa", "u3"), isSuperadminRefusal);
  assert.equal(await teamOf("u7"), "t2");
  assert.equal((await d.db.select().from(d.teamMembers).where(eq(d.teamMembers.userId, "sa"))).length, 0);
});

test("superadmins skip onboarding; everyone else picks a username first", async () => {
  const { postSignInPath } = await import("../../src/lib/accounts");
  assert.equal(postSignInPath({ username: null, role: "superadmin" }, "/"), "/superadmin");
  assert.equal(postSignInPath({ username: null, role: "superadmin" }, "/admin/x"), "/admin/x");
  assert.equal(postSignInPath({ username: null, role: "admin" }, "/"), "/onboarding");
  assert.equal(postSignInPath({ username: null, role: "user" }, "/join/abc"), "/onboarding?next=%2Fjoin%2Fabc");
  assert.equal(postSignInPath({ username: "alice", role: "user" }, "/"), "/");
});
