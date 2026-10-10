/**
 * Which database this codebase may touch.
 *
 * This repo (jpl-leagues-accounts) carries schema changes — migration 0025, accounts and
 * membership — that production must not receive while they are built and tested. Production's
 * Turso database is `jpl-leagues`; this repo's is `jpl-leagues-accounts`. Anything else is
 * refused before a connection is opened: the app (src/lib/db/index.ts), drizzle-kit
 * (drizzle.config.ts: db:push / db:migrate / db:studio) and scripts/apply-0025-accounts-membership.mjs,
 * which repeats this check because plain node scripts can't import TypeScript.
 *
 * Local `file:` databases (tests, dev) are always allowed.
 */

export const ALLOWED_TURSO_DB = "jpl-leagues-accounts";

/** Throws unless `url` is a local file: database or this repo's own Turso database. */
export function assertSafeDbTarget(url: string): void {
  if (url.startsWith("file:")) return;
  let host = "";
  try {
    host = new URL(url.replace(/^libsql:/, "https:")).hostname;
  } catch {
    // fall through to the refusal
  }
  // Turso hostnames are `<db>-<org>.<region>.turso.io`.
  if (host.startsWith(`${ALLOWED_TURSO_DB}-`)) return;
  throw new Error(
    `Refusing to use database "${host || "unparseable URL"}". This repo may only use the ` +
      `"${ALLOWED_TURSO_DB}" Turso database or a local file: database — never production's.`,
  );
}
