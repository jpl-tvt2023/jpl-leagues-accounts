import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, leagueAdmins, userIdentities } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { isSuperAdmin } from "@/lib/privilege";
import { generateId } from "@/lib/id";

export async function GET(request: NextRequest) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const adminRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      username: users.username,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.role, ["admin", "superadmin"]))
    .orderBy(users.createdAt);

  // Include league assignments for each admin
  const adminIds = adminRows.map((a) => a.id);
  const assignments =
    adminIds.length > 0
      ? await db
          .select({ userId: leagueAdmins.userId, leagueId: leagueAdmins.leagueId })
          .from(leagueAdmins)
          .where(inArray(leagueAdmins.userId, adminIds))
      : [];

  const googleLinked = new Set(
    adminIds.length > 0
      ? (await db.select({ userId: userIdentities.userId }).from(userIdentities).where(inArray(userIdentities.userId, adminIds))).map((r) => r.userId)
      : [],
  );

  const assignmentMap: Record<string, string[]> = {};
  for (const a of assignments) {
    if (!assignmentMap[a.userId]) assignmentMap[a.userId] = [];
    assignmentMap[a.userId].push(a.leagueId);
  }

  const admins = adminRows.map((a) => ({
    ...a,
    // Google linked, or not yet (created by email, waiting for their first Google sign-in to link).
    signIn: googleLinked.has(a.id) ? "google" : "pending",
    assignedLeagueIds: assignmentMap[a.id] ?? [],
  }));

  return NextResponse.json({ admins });
}

/**
 * POST /api/superadmin/admins { name, email }
 * Make someone an admin. Everyone signs in with Google, so there is nothing to hand over.
 * - New email: the account links on their first Google sign-in with that (verified) email.
 * - Email of an existing player account: promoted to admin in place.
 */
export async function POST(request: NextRequest) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { name, email } = body;

  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  // Input-shape validation. Without these guards the route accepts malformed emails like 'a' and
  // arbitrarily long fields.
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    return NextResponse.json({ error: "name must be 1-100 characters" }, { status: 400 });
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    return NextResponse.json({ error: "email must be a valid email address (max 254 chars)" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const [existing] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${normalizedEmail}`).limit(1);
  if (existing) {
    if (existing.role === "admin" || existing.role === "superadmin") {
      return NextResponse.json({ error: "An admin with that email already exists" }, { status: 409 });
    }
    // A player becomes an admin. Their next request picks the role up (/api/auth/me re-mints).
    await db.update(users).set({ role: "admin", updatedAt: new Date() }).where(eq(users.id, existing.id));
    return NextResponse.json({
      success: true, promoted: true, id: existing.id, name: existing.name, email: existing.email, username: existing.username,
      role: "admin", signIn: "google", assignedLeagueIds: [],
    });
  }

  const id = generateId();

  try {
    await db.insert(users).values({
      id,
      name,
      email: normalizedEmail,
      password: "", // Google-only: never a usable password (see users.password)
      role: "admin",
      mustChangePassword: false,
    });

    return NextResponse.json({
      success: true,
      id,
      name,
      email: normalizedEmail,
      role: "admin",
      signIn: "pending",
      assignedLeagueIds: [],
    });
  } catch {
    return NextResponse.json({ error: "An admin with that email already exists" }, { status: 409 });
  }
}
