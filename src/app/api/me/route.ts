import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, inArray, ne, count } from "drizzle-orm";
import { db, teamMembers, users, auditLogs, userIdentities, joinRequests, leagueAdmins, authHandoffs } from "@/lib/db";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { ACCOUNTS_COOKIE_NAME, ACCOUNTS_COOKIE_OPTIONS, encodeAccounts, removeAccount } from "@/lib/auth-accounts";
import { getRequestPerson, sessionTypeForRole } from "@/lib/accounts";
import { generateId } from "@/lib/id";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/me { confirm } — delete the signed-in person's account.
 *
 * `confirm` must be their username (or email, if they never picked one), so a stray click can't
 * do it. Their teams stay in their leagues — a team belongs to the league, not the person:
 * - a team they owned with a teammate passes to that teammate;
 * - a team they were alone on keeps playing, unclaimed, until an admin assigns it.
 * Identities, memberships, admin rights and pending join requests go with the account; captain
 * and chip history keeps its rows with the "submitted by" link cleared.
 */
export async function DELETE(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
  const expected = user.username ?? user.email;
  if (typeof body.confirm !== "string" || body.confirm.trim().toLowerCase() !== expected.toLowerCase()) {
    return NextResponse.json({ error: `Type ${user.username ? "your username" : "your email"} to confirm.` }, { status: 400 });
  }

  if (user.role === "superadmin") {
    const [others] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "superadmin"), ne(users.id, user.id)));
    if ((others?.n ?? 0) === 0) {
      return NextResponse.json({ error: "You're the only platform admin. Make someone else a superadmin first." }, { status: 409 });
    }
  }

  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.role, "owner")));

    // Drop this person's memberships first: at most one owner per team, so the teammate can only
    // be promoted once the old owner row is gone.
    await tx.delete(teamMembers).where(eq(teamMembers.userId, user.id));

    if (owned.length > 0) {
      const successors = await tx
        .select({ id: teamMembers.id, teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, owned.map((o) => o.teamId)))
        .orderBy(asc(teamMembers.createdAt));
      const promoted = new Set<string>();
      for (const s of successors) {
        if (promoted.has(s.teamId)) continue;
        promoted.add(s.teamId);
        await tx.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.id, s.id));
      }
    }

    await tx.insert(auditLogs).values({
      id: generateId(),
      type: "ACCOUNT_DELETED",
      description: `Account ${user.username ? "@" + user.username : user.email} deleted by its owner`,
      userId: user.id,
    });
    // Explicit rather than relying on ON DELETE CASCADE: foreign-key enforcement isn't guaranteed
    // on every connection (the local libsql client opens fresh connections without the pragma).
    await tx.delete(userIdentities).where(eq(userIdentities.userId, user.id));
    await tx.delete(joinRequests).where(eq(joinRequests.userId, user.id));
    await tx.delete(leagueAdmins).where(eq(leagueAdmins.userId, user.id));
    await tx.delete(authHandoffs).where(eq(authHandoffs.userId, user.id));
    await tx.delete(users).where(eq(users.id, user.id));
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  const raw = request.cookies.get(ACCOUNTS_COOKIE_NAME)?.value;
  response.cookies.set(ACCOUNTS_COOKIE_NAME, encodeAccounts(await removeAccount(raw, `${sessionTypeForRole(user.role)}:${user.id}`)), ACCOUNTS_COOKIE_OPTIONS);
  return response;
}
