/**
 * Saved FPL teams (src/lib/sports/fpl/user-teams.ts) against a real SQLite database built from schema.ts, with
 * a tiny local server standing in for FPL: entry 404 doesn't exist, every other id is a team.
 *
 * Run with: npm run test:unit   (builds ./fpl-teams-unit.db, gitignored)
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const DB_FILE = "fpl-teams-unit.db";
process.env.DATABASE_URL = `file:./${DB_FILE}`;
process.env.SESSION_SECRET ??= "unit-test-secret-that-is-at-least-32-characters";

let f: typeof import("../../src/lib/sports/fpl/user-teams");
let d: typeof import("../../src/lib/db");
let eq: typeof import("drizzle-orm").eq;
let fakeFpl: Server;

before(async () => {
  fakeFpl = createServer((req, res) => {
    const id = /\/entry\/(\d+)\/$/.exec(req.url ?? "")?.[1];
    if (!id || id === "404") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: Number(id), name: `Team ${id}`, player_first_name: "Pat", player_last_name: "Lee" }));
  });
  await new Promise<void>((resolve) => fakeFpl.listen(0, "127.0.0.1", resolve));
  // Read when the FPL gateway module loads, so it must be set before the import below.
  process.env.FPL_BASE_URL = `http://127.0.0.1:${(fakeFpl.address() as AddressInfo).port}`;

  for (const s of ["", "-shm", "-wal", "-journal"]) rmSync(DB_FILE + s, { force: true });
  const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], { env: process.env, shell: true, encoding: "utf8" });
  assert.equal(push.status, 0, `drizzle-kit push failed:\n${push.stdout}\n${push.stderr}`);
  f = await import("../../src/lib/sports/fpl/user-teams");
  d = await import("../../src/lib/db");
  ({ eq } = await import("drizzle-orm"));
  await d.fkReady;
  const user = (id: string) => ({ id, email: `${id}@unit.test`, password: "", name: id, role: "user", username: id });
  await d.db.insert(d.users).values(["a1", "a2"].map(user));
});

after(() => {
  fakeFpl?.close();
});

const primaryOf = async (userId: string) => (await f.listFplTeams(userId)).filter((t) => t.isPrimary).map((t) => t.fplEntryId);

test("the first FPL team saved is primary; names come from FPL; saving it again changes nothing", async () => {
  const first = await f.addFplTeam("a1", "111");
  assert.deepEqual({ ...first, id: "x" }, { id: "x", fplEntryId: "111", teamName: "Team 111", managerName: "Pat Lee", isPrimary: true });
  const second = await f.addFplTeam("a1", 222);
  assert.equal(second.isPrimary, false);
  assert.equal((await f.addFplTeam("a1", "111")).id, first.id);
  assert.equal((await f.listFplTeams("a1")).length, 2);
  assert.deepEqual(await primaryOf("a1"), ["111"]);
});

test("an id FPL doesn't know, or one that isn't a number, is refused", async () => {
  await assert.rejects(f.addFplTeam("a1", "404"), (e: Error & { code?: string }) => e.code === "not-found");
  await assert.rejects(f.addFplTeam("a1", "12ab"), f.FplTeamError);
  await assert.rejects(f.addFplTeam("a1", ""), f.FplTeamError);
});

test("making another one primary moves the flag; there is only ever one", async () => {
  const teams = await f.listFplTeams("a1");
  const other = teams.find((t) => t.fplEntryId === "222")!;
  assert.equal(await f.setPrimaryFplTeam("a1", other.id), true);
  assert.deepEqual(await primaryOf("a1"), ["222"]);
  // Not someone else's.
  assert.equal(await f.setPrimaryFplTeam("a2", other.id), false);
  assert.deepEqual(await primaryOf("a1"), ["222"]);
});

test("removing the primary makes the oldest remaining one primary", async () => {
  const teams = await f.listFplTeams("a1");
  const primary = teams.find((t) => t.isPrimary)!;
  assert.equal(await f.removeFplTeam("a2", primary.id), false); // not theirs
  assert.equal(await f.removeFplTeam("a1", primary.id), true);
  assert.deepEqual(await primaryOf("a1"), ["111"]);
  assert.equal(await f.hasFplTeam("a1", "222"), false);
  assert.equal(await f.hasFplTeam("a1", "111"), true);
});

test("at most ten per person", async () => {
  for (let i = 0; i < f.MAX_FPL_TEAMS; i++) await f.addFplTeam("a2", 5000 + i);
  await assert.rejects(f.addFplTeam("a2", "6000"), (e: Error & { code?: string }) => e.code === "too-many");
  // One already on the list is still fine.
  assert.equal((await f.addFplTeam("a2", 5000)).fplEntryId, "5000");
});

test("deleting the person deletes their FPL teams", async () => {
  await d.db.delete(d.users).where(eq(d.users.id, "a2"));
  assert.deepEqual(await f.listFplTeams("a2"), []);
});
