/**
 * Seed the first superadmin.
 *
 * Everyone signs in with Google, so there is no password: this creates (or promotes) the users row
 * for one email address, and the first Google sign-in with that (verified) email links to it — see
 * findOrCreateGoogleUser in src/lib/accounts.ts. Further admins are added from the superadmin page.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "libsql://jpl-india-<org>.<region>.turso.io"
 *   $env:TURSO_AUTH_TOKEN = turso db tokens create jpl-india
 *   $env:SUPERADMIN_EMAIL = "you@gmail.com"
 *   npm run seed:admin
 *
 * DATABASE_URL may also be a local `file:` database. Like every database command in this repo it
 * refuses anything but those two (src/lib/db/target-guard.ts). Safe to run twice.
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, count, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { joinRequests, teamMembers, users } from "../src/lib/db/schema";
import { assertSafeDbTarget } from "../src/lib/db/target-guard";

async function seed() {
  const url = process.env.DATABASE_URL || process.env.TURSO_CONNECTION_URL;
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.SUPERADMIN_NAME?.trim() || email?.split("@")[0];

  if (!url) {
    console.error("\n❌  Set DATABASE_URL (libsql:// or file:) first.\n");
    process.exit(1);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("\n❌  Set SUPERADMIN_EMAIL to the Google account's email address.\n");
    process.exit(1);
  }
  assertSafeDbTarget(url);

  const db = drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));

  const [existing] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${email}`).limit(1);
  if (existing) {
    if (existing.role === "superadmin") {
      console.log(`\n✓  ${email} is already the superadmin. Nothing to do.\n`);
      return;
    }
    // Superadmins never play (src/lib/membership.ts), so an account that's on a team can't become one.
    const [{ n: teamCount }] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.userId, existing.id));
    if (teamCount > 0) {
      console.error(`\n❌  ${email} is on ${teamCount} team(s). Superadmins can't play: take them off their teams first.\n`);
      process.exit(1);
    }
    await db.update(joinRequests).set({ status: "cancelled", decidedAt: new Date() })
      .where(and(eq(joinRequests.userId, existing.id), eq(joinRequests.status, "pending")));
    // Promoted in place; their next request picks the role up (/api/auth/me re-mints the session).
    await db.update(users).set({ role: "superadmin", updatedAt: new Date() }).where(eq(users.id, existing.id));
    console.log(`\n✓  ${email} promoted from ${existing.role} to superadmin.\n`);
    return;
  }

  await db.insert(users).values({
    id: randomUUID(),
    email,
    name: name!,
    password: "", // Google-only: never a usable password (see users.password)
    role: "superadmin",
    mustChangePassword: false,
  });
  console.log(`\n✓  Superadmin ${email} created.`);
  console.log("   Sign in at /signin with Google using that email — the account links on first sign-in.\n");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
