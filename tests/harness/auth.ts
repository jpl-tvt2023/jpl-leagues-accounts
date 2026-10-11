/**
 * Auth helpers for tests.
 *
 * Everyone signs in with Google, which a test can't drive, so every helper here goes through the
 * test-only POST /api/test-auth/signin (needs TEST_AUTH_ENABLED=1, set in .env.test). It signs in
 * as a person by email, creating the account on first use.
 *
 *   - `apiSignIn*` put the session cookie in a Playwright `APIRequestContext` — for API-only specs.
 *   - `uiSignIn*` put it in the browser context behind `page` (page.request shares its cookie jar)
 *     and then open the page a real sign-in would land on.
 *
 * "Signing in as team N" means signing in as that team's owner: a test person made the owner of
 * the team on first use (ensureTeamPerson), and on no other team.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { APIRequestContext, Page } from "@playwright/test";
import { TEST_SUPERADMIN, teamLoginId, teamPersonEmail } from "./constants";
import { testDb, schema } from "./db";

export interface SignedInUser {
  id: string;
  username: string | null;
  role: string;
}

/**
 * Sign in as a PERSON without Google. Creates the account on first use; pass `username` to skip
 * onboarding. The session cookie lands in `request`.
 */
export async function apiSignInUser(
  request: APIRequestContext,
  opts: { email: string; username?: string; name?: string; role?: "user" | "admin" | "superadmin" },
): Promise<SignedInUser> {
  const res = await request.post("/api/test-auth/signin", { data: opts, failOnStatusCode: false });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`apiSignInUser(${opts.email}) failed: ${res.status()} ${body?.error ?? ""}`);
  return body.user;
}

export async function apiSignInSuperadmin(request: APIRequestContext): Promise<void> {
  const user = await apiSignInUser(request, { email: TEST_SUPERADMIN.email });
  if (user.role !== "superadmin") {
    throw new Error(
      `${TEST_SUPERADMIN.email} is not a superadmin (role ${user.role}). Did you run \`npm run test:reset\`?`,
    );
  }
}

/** Sign in as an existing admin (or any existing account) by email. */
export async function apiSignInAdmin(request: APIRequestContext, email: string): Promise<void> {
  await apiSignInUser(request, { email });
}

/** A short, valid, stable username for a team's test person (`^[a-z0-9_]{3,20}$`). */
function teamUsername(teamId: string): string {
  return `t_${createHash("sha1").update(teamId).digest("hex").slice(0, 12)}`;
}

/**
 * Make sure team `index` of league `slug` has its test person as owner, and return that person's
 * sign-in details. Idempotent. Writes straight to the test database, like the rest of the harness.
 */
export async function ensureTeamPerson(
  slug: string,
  index: number,
): Promise<{ email: string; username: string; teamId: string; leagueId: string }> {
  const db = testDb();
  const key = teamLoginId(slug, index);
  const [team] = await db
    .select({ id: schema.teams.id, leagueId: schema.teams.leagueId })
    .from(schema.teams)
    .where(sql`LOWER(${schema.teams.teamLoginId}) = ${key.toLowerCase()}`)
    .limit(1);
  if (!team) throw new Error(`ensureTeamPerson: no team with key ${key}`);

  const email = teamPersonEmail(slug, index);
  const username = teamUsername(team.id);
  let [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) {
    user = { id: randomUUID() };
    await db.insert(schema.users).values({
      id: user.id,
      email,
      password: "",
      name: `Team ${index} owner`,
      role: "user",
      mustChangePassword: false,
      username,
    });
  }

  const [member] = await db
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, team.id), eq(schema.teamMembers.userId, user.id)))
    .limit(1);
  if (!member) {
    await db.insert(schema.teamMembers).values({
      id: randomUUID(),
      teamId: team.id,
      leagueId: team.leagueId,
      userId: user.id,
      role: "owner",
    });
  }
  return { email, username, teamId: team.id, leagueId: team.leagueId };
}

/** Sign in as team `index` of league `slug` (its owner). Team APIs then need `?league=<slug>`. */
export async function apiSignInTeam(request: APIRequestContext, slug: string, index: number): Promise<void> {
  const { email } = await ensureTeamPerson(slug, index);
  await apiSignInUser(request, { email });
}

export async function apiSignOut(request: APIRequestContext): Promise<void> {
  await request.post("/api/auth/signout").catch(() => {});
}

/** Sign the browser behind `page` in as a person, then open `landing` (default: the home page). */
export async function uiSignInUser(
  page: Page,
  opts: { email: string; username?: string; name?: string; role?: "user" | "admin" | "superadmin" },
  landing = "/",
): Promise<void> {
  await apiSignInUser(page.request, opts);
  await page.goto(landing);
  await page.waitForLoadState("networkidle");
}

export async function uiSignInSuperadmin(page: Page): Promise<void> {
  await uiSignInUser(page, { email: TEST_SUPERADMIN.email }, "/superadmin");
}

/** Sign in as team `index` of league `slug` and open its dashboard, as a real sign-in would. */
export async function uiSignInTeam(page: Page, slug: string, index: number): Promise<void> {
  const { email } = await ensureTeamPerson(slug, index);
  await uiSignInUser(page, { email }, `/${slug}/dashboard`);
}
