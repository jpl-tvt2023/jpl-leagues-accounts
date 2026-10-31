/**
 * Database error descriptions and the one-retry wrapper (src/lib/db/errors.ts).
 *
 * Drizzle's DrizzleQueryError carries the SQL and every bound param in `.message`, and the libSQL
 * error that explains the failure only on `.cause`. The FPL Classic sync stored `.message`, so the
 * Operations tab showed "Failed query: select … params: <50 entrant ids>" and never the Turso 502
 * underneath. These tests pin that the stored text is the statement's shape plus the cause chain,
 * with no params, and that the retry runs at most twice.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DrizzleQueryError } from "drizzle-orm";
import { LibsqlError } from "@libsql/client";
import { describeDbError, withDbRetry } from "../../src/lib/db/errors";

const ENTRANT_ID = "3f2b8c1e-9d4a-4e6f-b7a2-5c8d1e0f9a3b";
const SELECT_ENTRY_GWS =
  'select "entrant_id", "gw" from "fpl_classic_entry_gws" where "fpl_classic_entry_gws"."entrant_id" in (?, ?)';

/* ── Drizzle query failures ─────────────────────────────────────────────── */

test("a Drizzle failure is described by its statement and full cause chain, never its params", () => {
  const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const fetchFailed = new TypeError("fetch failed", { cause: reset });
  const libsql = new LibsqlError("Server returned HTTP status 502", "SERVER_ERROR", undefined, undefined, fetchFailed);
  const err = new DrizzleQueryError(SELECT_ENTRY_GWS, [ENTRANT_ID, 7], libsql);

  const text = describeDbError(err);
  assert.equal(
    text,
    "Database error (select from fpl_classic_entry_gws): SERVER_ERROR: Server returned HTTP status 502 → TypeError: fetch failed → read ECONNRESET",
  );
  assert.ok(!text.includes(ENTRANT_ID), "a bound param leaked into the description");
  assert.ok(!text.includes("Failed query"), "Drizzle's own message leaked into the description");
});

test("insert and update statements are described by verb and table", () => {
  const cause = new LibsqlError("UNIQUE constraint failed", "SQLITE_CONSTRAINT");
  const insert = new DrizzleQueryError(
    'insert into "fpl_classic_entry_gws" ("id", "entrant_id", "gw") values (?, ?, ?) on conflict do nothing',
    ["row-id", ENTRANT_ID, 7],
    cause,
  );
  const update = new DrizzleQueryError(
    'update "fpl_classic_config" set "settled_through_gw" = ?, "last_sync_error" = ? where "fpl_classic_config"."league_id" = ?',
    [7, null, "league-id"],
    cause,
  );

  assert.equal(describeDbError(insert), "Database error (insert into fpl_classic_entry_gws): SQLITE_CONSTRAINT: UNIQUE constraint failed");
  assert.equal(describeDbError(update), "Database error (update fpl_classic_config): SQLITE_CONSTRAINT: UNIQUE constraint failed");
});

test("a non-libSQL cause with a code gets the code prefixed", () => {
  const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  const err = new DrizzleQueryError(SELECT_ENTRY_GWS, [ENTRANT_ID], cause);
  assert.equal(describeDbError(err), "Database error (select from fpl_classic_entry_gws): ECONNRESET: socket hang up");
});

test("the cause chain stops after three levels", () => {
  const level4 = new Error("level 4");
  const level3 = new Error("level 3", { cause: level4 });
  const level2 = new Error("level 2", { cause: level3 });
  const level1 = new Error("level 1", { cause: level2 });
  const text = describeDbError(new DrizzleQueryError(SELECT_ENTRY_GWS, [], level1));

  assert.equal(text, "Database error (select from fpl_classic_entry_gws): level 1 → level 2 → level 3");
  assert.ok(!text.includes("level 4"));
});

test("a Drizzle failure with no cause says so", () => {
  const err = new DrizzleQueryError(SELECT_ENTRY_GWS, [ENTRANT_ID], undefined);
  assert.equal(describeDbError(err), "Database error (select from fpl_classic_entry_gws): no underlying error was reported");
});

/* ── everything else ────────────────────────────────────────────────────── */

test("a plain Error or a string passes through unchanged", () => {
  assert.equal(describeDbError(new Error("League configuration not found")), "League configuration not found");
  assert.equal(describeDbError("FPL unavailable"), "FPL unavailable");
});

test("a very long message is capped at 400 characters", () => {
  const text = describeDbError(new Error("x".repeat(5000)));
  assert.equal(text.length, 400);
  assert.ok(text.endsWith("…"));
});

/* ── withDbRetry ────────────────────────────────────────────────────────── */

test("withDbRetry returns the second attempt's value after one failure", async (t) => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  const value = await withDbRetry("test", async () => {
    calls++;
    if (calls === 1) throw new Error("first attempt failed");
    return "second";
  }, { delayMs: 0 });

  assert.equal(value, "second");
  assert.equal(calls, 2);
});

test("withDbRetry does not retry a success", async () => {
  let calls = 0;
  const value = await withDbRetry("test", async () => {
    calls++;
    return "first";
  }, { delayMs: 0 });

  assert.equal(value, "first");
  assert.equal(calls, 1);
});

test("withDbRetry rethrows the second failure after exactly two calls", async (t) => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  await assert.rejects(
    withDbRetry("test", async () => {
      calls++;
      throw new Error(`attempt ${calls} failed`);
    }, { delayMs: 0 }),
    /attempt 2 failed/,
  );
  assert.equal(calls, 2);
});
