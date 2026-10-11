import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, leagueAdmins, teamMembers, userIdentities } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { isSuperAdmin } from "@/lib/privilege";

/**
 * PATCH /api/superadmin/admins/[userId]
 * Edit an admin user — name or email. Changing the email of an admin who hasn't signed in yet
 * changes which Google account links to them on first sign-in.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const { userId } = await params;
  const body = await request.json();

  // Guard: a superadmin may only mutate their OWN superadmin row; mutating
  // another superadmin's account is forbidden (prevents lockout / role-escalation
  // between platform owners). Non-superadmin (admin) rows fall through.
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role === "superadmin") {
    const callerId = request.headers.get("x-session-id");
    if (target.id !== callerId) {
      return NextResponse.json(
        { error: "Cannot modify another superadmin's account" },
        { status: 403 }
      );
    }
  }

  const updates: {
    name?: string;
    email?: string;
    updatedAt?: Date;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body.email === "string" && body.email.trim()) {
    // Match POST handler's normalization so Google sign-in's link-by-email (which compares
    // case-insensitively) and the unique-email index see a consistent value.
    updates.email = body.email.trim().toLowerCase();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.updatedAt = new Date();

  try {
    await db.update(users).set(updates).where(eq(users.id, userId));
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Email already in use by another admin" }, { status: 409 });
  }
}

/**
 * DELETE /api/superadmin/admins/[userId]
 * Remove someone as an admin.
 * - An account that is also a person on the platform (plays in a league, or has signed in with
 *   Google) is DEMOTED to a player: league assignments removed, role "user", session version
 *   bumped so every open admin session stops working on its next request. Their teams are untouched.
 * - An admin who never signed in and has no team is deleted.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const { userId } = await params;

  // Prevent deleting superadmin accounts via this route
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role === "superadmin") {
    return NextResponse.json({ error: "Cannot delete a superadmin account" }, { status: 403 });
  }

  const [membership] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.userId, userId)).limit(1);
  const [identity] = await db.select({ id: userIdentities.id }).from(userIdentities).where(eq(userIdentities.userId, userId)).limit(1);
  const demote = !!membership || !!identity;

  await db.transaction(async (tx) => {
    await tx.delete(leagueAdmins).where(eq(leagueAdmins.userId, userId));
    if (demote) {
      await tx
        .update(users)
        .set({ role: "user", sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      await tx.delete(users).where(eq(users.id, userId));
    }
  });

  return NextResponse.json({ success: true, demoted: demote });
}
