// Apply migration 0028 (cricket_fixtures.stage) idempotently: adds the column if it isn't there.
//
// Additive — every existing fixture becomes "group"; no row is otherwise touched, which the row
// count check at the end verifies. Safe to re-run, and against test, dev and jpl-india in turn.
//
// Run with:
//   npx dotenv -e .env.local -- node scripts/apply-0028-cricket-fixture-stage.mjs

import { createClient } from "@libsql/client";

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
const count = async () => Number((await client.execute("SELECT count(*) AS n FROM cricket_fixtures")).rows[0].n);

const before = await count();
const columns = await client.execute("PRAGMA table_info(cricket_fixtures)");
if (columns.rows.some((c) => c.name === "stage")) {
  console.log("[skip] cricket_fixtures.stage already exists");
} else {
  await client.execute("ALTER TABLE `cricket_fixtures` ADD `stage` text DEFAULT 'group' NOT NULL");
  console.log("[apply] cricket_fixtures.stage added (existing fixtures: group)");
}
const after = await count();
if (after !== before) {
  console.error(`Row count changed: ${before} → ${after}`);
  process.exit(1);
}
console.log(`cricket_fixtures rows unchanged (${after}).`);
client.close();
