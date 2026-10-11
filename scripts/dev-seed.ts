import "dotenv/config";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { users } from "../src/lib/db/schema";
import { randomUUID } from "crypto";

/**
 * Seed a local dev superadmin (npm run seed:dev, against .env.dev's file: database).
 *
 * Everyone signs in with Google — there are no passwords. Locally, either:
 *  - set DEV_SUPERADMIN_EMAIL to your own Google account and sign in through a dev OAuth client
 *    (docs/07-deployment.md), or
 *  - set TEST_AUTH_ENABLED=1 in .env.dev and sign in as this email with
 *    POST /api/test-auth/signin { "email": "<it>" } (never set that flag anywhere real).
 */
const DEV_SUPERADMIN = {
  email: (process.env.DEV_SUPERADMIN_EMAIL || "dev@jplindia.local").trim().toLowerCase(),
  name: "Dev Superadmin",
};

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith("file:")) {
    throw new Error(
      `dev-seed.ts refuses to run unless DATABASE_URL is file: (got ${dbUrl ?? "<unset>"}). This script is dev-only.`
    );
  }

  const client = createClient({ url: dbUrl });
  const db = drizzle(client);

  const existing = await db.select().from(users).where(eq(users.email, DEV_SUPERADMIN.email)).limit(1);
  if (existing.length > 0) {
    console.log(`Superadmin ${DEV_SUPERADMIN.email} already exists — skipping.`);
    return;
  }

  await db.insert(users).values({
    id: randomUUID(),
    email: DEV_SUPERADMIN.email,
    name: DEV_SUPERADMIN.name,
    password: "",
    role: "superadmin",
    mustChangePassword: false,
  });

  console.log(`Seeded superadmin: ${DEV_SUPERADMIN.email} — sign in with Google (or test sign-in), no password.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
