// Apply migration 0029 (cricket_backups) idempotently: creates the table and its index if missing.
//
// Additive — a new table only; the row counts of leagues and teams are checked unchanged. Safe to
// re-run, and against test, dev and jpl-india in turn.
//
// Run with:
//   npx dotenv -e .env.local -- node scripts/apply-0029-cricket-backups.mjs

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
const exists = async (type, name) =>
  (await client.execute({ sql: "SELECT name FROM sqlite_master WHERE type = ? AND name = ?", args: [type, name] })).rows.length > 0;
const counts = async () => ({
  leagues: Number((await client.execute("SELECT count(*) AS n FROM leagues")).rows[0].n),
  teams: Number((await client.execute("SELECT count(*) AS n FROM teams")).rows[0].n),
});

const before = await counts();
if (await exists("table", "cricket_backups")) {
  console.log("[skip] table cricket_backups");
} else {
  await client.execute(`CREATE TABLE \`cricket_backups\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`league_id\` text NOT NULL,
    \`trigger\` text NOT NULL,
    \`created_by\` text,
    \`payload\` text NOT NULL,
    \`created_at\` integer NOT NULL,
    FOREIGN KEY (\`league_id\`) REFERENCES \`leagues\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  )`);
  console.log("[apply] table cricket_backups");
}
if (await exists("index", "cricket_backups_league")) {
  console.log("[skip] index cricket_backups_league");
} else {
  await client.execute("CREATE INDEX `cricket_backups_league` ON `cricket_backups` (`league_id`,`created_at`)");
  console.log("[apply] index cricket_backups_league");
}
const after = await counts();
if (JSON.stringify(before) !== JSON.stringify(after)) {
  console.error("Row counts changed:", before, after);
  process.exit(1);
}
console.log(`Row counts unchanged on leagues, teams (${after.leagues}, ${after.teams}).`);
client.close();
