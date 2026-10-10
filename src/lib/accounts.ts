/**
 * People: finding, linking and creating users rows for sign-in, and minting their sessions.
 * See docs/10-accounts-and-membership.md.
 */

import type { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, userIdentities, users, type User } from "@/lib/db";
import { createSession, isPersonSession, type SessionType } from "@/lib/auth";
import { getRequestSession } from "@/lib/team-actor";
import { generateId } from "@/lib/id";
import type { GoogleProfile } from "@/lib/google-oauth";

export interface SignInResult {
  user: User;
  /** True when this sign-in attached Google to an account that already existed (e.g. an admin). */
  linked: boolean;
  created: boolean;
}

/**
 * The person behind a verified Google profile:
 * 1. an account already linked to this Google account (by `sub`, which never changes);
 * 2. else an existing account with the same (verified) email — this is how admins created
 *    before Google sign-in, or by email from the superadmin page, link on first sign-in;
 * 3. else a new player account, with no username yet (onboarding asks for one).
 */
export async function findOrCreateGoogleUser(profile: GoogleProfile): Promise<SignInResult> {
  if (!profile.emailVerified) throw new Error("Google account email is not verified");

  const byIdentity = await db
    .select({ user: users })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.provider, "google"), eq(userIdentities.providerSubject, profile.sub)))
    .limit(1);
  if (byIdentity[0]) return { user: await touchLogin(byIdentity[0].user, profile), linked: false, created: false };

  const [byEmail] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${profile.email}`).limit(1);
  if (byEmail) {
    await db.insert(userIdentities).values({ id: generateId(), userId: byEmail.id, provider: "google", providerSubject: profile.sub, email: profile.email })
      .onConflictDoNothing();
    return { user: await touchLogin(byEmail, profile), linked: true, created: false };
  }

  const id = generateId();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        email: profile.email,
        password: "", // Google-only: never a usable password (see users.password)
        name: profile.name,
        role: "user", // explicit — the column default is still "admin"
        mustChangePassword: false,
        avatarUrl: profile.picture,
        lastLoginAt: new Date(),
      });
      await tx.insert(userIdentities).values({ id: generateId(), userId: id, provider: "google", providerSubject: profile.sub, email: profile.email });
    });
  } catch (err) {
    // Two first sign-ins racing (two tabs): the loser hits a unique index; the winner's row is it.
    const [winner] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${profile.email}`).limit(1);
    if (winner) return { user: winner, linked: false, created: false };
    throw err;
  }
  const [created] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return { user: created, linked: false, created: true };
}

async function touchLogin(user: User, profile: GoogleProfile): Promise<User> {
  const patch: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() };
  if (!user.avatarUrl && profile.picture) patch.avatarUrl = profile.picture;
  await db.update(users).set(patch).where(eq(users.id, user.id));
  return { ...user, ...patch } as User;
}

/** Session type for a person: their platform role, or "user" for players. */
export function sessionTypeForRole(role: string): Extract<SessionType, "superadmin" | "admin" | "user"> {
  return role === "superadmin" || role === "admin" ? role : "user";
}

/** A session token for this person at their current role and session version. */
export function mintPersonSession(user: Pick<User, "id" | "role" | "sessionVersion">): Promise<string> {
  return createSession(user.id, sessionTypeForRole(user.role), { sv: user.sessionVersion });
}

/** Where a freshly signed-in person goes: onboarding until they have a username, then `next`. */
export function postSignInPath(user: Pick<User, "username">, next: string): string {
  if (!user.username) return `/onboarding${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  return next || "/";
}

/**
 * The signed-in person behind a request, re-read from the database — or null if signed out, a
 * legacy team login, deleted, or revoked. For routes about the person themselves (/api/me/*).
 */
export async function getRequestPerson(request: NextRequest): Promise<User | null> {
  const session = await getRequestSession(request);
  if (!session || !isPersonSession(session)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.id)).limit(1);
  if (!user || user.sessionVersion !== (session.sv ?? 0)) return null;
  return user;
}

/** What the person-facing APIs return about a user. Never the password hash. */
export function publicProfile(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    fplEntryId: user.fplEntryId,
    role: user.role,
  };
}
