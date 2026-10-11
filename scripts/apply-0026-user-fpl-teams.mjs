// Apply migration 0026 (saved FPL teams) idempotently.
//
// Reads drizzle/0026_user_fpl_teams.sql itself, so the SQL lives in one place:
//   CREATE [UNIQUE] INDEX n  → skipped if index n exists
//   CREATE TABLE n           → skipped if table n exists
//   INSERT OR IGNORE ...     → always run; it copies each users.fpl_entry_id into user_fpl_teams and
//                              skips any already there, so re-running adds nothing new
// Safe to run against test, dev and the jpl-india database in turn, and safe to re-run.
//
// Additive — no existing row is rewritten, which the row-count check at the end verifies.
//
// Run with:
//   npx dotenv -e .env.local -- node scripts/apply-0026-user-fpl-teams.mjs
//
// THEN mark it applied so `npm run db:migrate` does not try to re-run it:
//   npx dotenv -e .env.local -- node scripts/seed-drizzle-migrations-table.mjs

import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL ?? process.env.TURSO_CONNECTION_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("Missing DATABASE_URL / TURSO_CONNECTION_URL");
  process.exit(1);
}

// Never production. Mirrors src/lib/db/target-guard.ts (plain node can't import TypeScript).
const ALLOWED_TURSO_DB = "jpl-india";
if (!url.startsWith("file:")) {
  let host = "";
  try { host = new URL(url.replace(/^libsql:/, "https:")).hostname; } catch {}
  if (!host.startsWith(ALLOWED_TURSO_DB + "-")) {
    console.error("Refusing to run against \"" + (host || "unparseable URL") + "\": only the " + ALLOWED_TURSO_DB + " Turso database or a local file: database.");
    process.exit(1);
  }
}

const client = createClient({ url, authToken });

async function exists(type, name) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
    args: [type, name],
  });
  return res.rows.length > 0;
}

async function count(table) {
  const res = await client.execute("SELECT count(*) AS n FROM " + table);
  return Number(res.rows[0].n);
}

/** What a statement creates, so it can be skipped when that already exists. */
async function alreadyApplied(stmt) {
  let m = stmt.match(/^CREATE (?:UNIQUE )?INDEX `?(\w+)`?/i);
  if (m) return { label: "index " + m[1], done: await exists("index", m[1]) };
  m = stmt.match(/^CREATE TABLE `?(\w+)`?/i);
  if (m) return { label: "table " + m[1], done: await exists("table", m[1]) };
  m = stmt.match(/^INSERT OR IGNORE INTO `?(\w+)`?/i);
  if (m) return { label: "backfill " + m[1], done: false };
  throw new Error("Unrecognised statement — refusing to run it unguarded:\n" + stmt);
}

const sqlPath = path.resolve("drizzle", "0026_user_fpl_teams.sql");
const statements = fs
  .readFileSync(sqlPath, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

console.log("Target: " + url.slice(0, 45) + (url.length > 45 ? "…" : ""));
console.log(statements.length + " statements in " + path.basename(sqlPath) + "\n");

const guarded = ["users", "players", "team_members"];
const before = {};
for (const t of guarded) before[t] = await count(t);

let applied = 0;
for (const stmt of statements) {
  const { label, done } = await alreadyApplied(stmt);
  if (done) {
    console.log("[skip]  " + label);
    continue;
  }
  const res = await client.execute(stmt);
  applied++;
  console.log("[apply] " + label + (label.startsWith("backfill") ? " (" + res.rowsAffected + " row(s) copied)" : ""));
}

let changed = false;
for (const t of guarded) {
  const after = await count(t);
  if (after !== before[t]) {
    changed = true;
    console.error("ROW COUNT CHANGED on " + t + ": " + before[t] + " → " + after);
  }
}

console.log("\n" + applied + " applied, " + (statements.length - applied) + " already present.");
console.log("user_fpl_teams now holds " + (await count("user_fpl_teams")) + " row(s).");
if (changed) process.exit(1);
console.log("Row counts unchanged on " + guarded.join(", ") + ".");
