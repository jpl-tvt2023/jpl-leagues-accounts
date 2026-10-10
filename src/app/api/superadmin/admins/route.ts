import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, leagueAdmins, userIdentities } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { isSuperAdmin } from "@/lib/privilege";
import { generateId } from "@/lib/id";
import bcrypt from "bcryptjs";

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
      mustChangePassword: users.mustChangePassword,
      username: users.username,
      hasPassword: sql<number>`${users.password} <> ''`,
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

  const admins = adminRows.map(({ hasPassword, ...a }) => ({
    ...a,
    // How they sign in: Google linked, a password, or neither yet (created by email, waiting for
    // their first Google sign-in to link).
    signIn: googleLinked.has(a.id) ? "google" : hasPassword ? "password" : "pending",
    assignedLeagueIds: assignmentMap[a.id] ?? [],
  }));

  return NextResponse.json({ admins });
}

/**
 * POST /api/superadmin/admins { name, email, password? }
 * Make someone an admin.
 * - New email, no password: an admin who signs in with Google — the account links on their first
 *   Google sign-in with that (verified) email. Nothing to hand over.
 * - New email with a password: the old flow — they sign in with it and must change it first.
 * - Email of an existing player account: promoted to admin in place.
 */
export async function POST(request: NextRequest) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { name, email, password } = body;

  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  // Input-shape validation. Without these guards the route accepts 1-char
  // passwords, malformed emails like 'a', and arbitrarily long fields.
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    return NextResponse.json({ error: "name must be 1-100 characters" }, { status: 400 });
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
    return NextResponse.json({ error: "email must be a valid email address (max 254 chars)" }, { status: 400 });
  }
  const withPassword = password !== undefined && password !== null && password !== "";
  if (withPassword && (typeof password !== "string" || password.length < 8 || password.length > 256)) {
    return NextResponse.json({ error: "password must be 8-256 characters" }, { status: 400 });
  }
  if (withPassword && !/[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return NextResponse.json(
      { error: "password must contain at least one number or special character" },
      { status: 400 }
    );
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
      role: "admin", mustChangePassword: false, signIn: "google", assignedLeagueIds: [],
    });
  }

  const hashedPassword = withPassword ? await bcrypt.hash(password, 12) : "";
  const id = generateId();

  try {
    await db.insert(users).values({
      id,
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: "admin",
      mustChangePassword: withPassword,
    });

    return NextResponse.json({
      success: true,
      id,
      name,
      email: normalizedEmail,
      role: "admin",
      mustChangePassword: withPassword,
      signIn: withPassword ? "password" : "pending",
      assignedLeagueIds: [],
    });
  } catch {
    return NextResponse.json({ error: "An admin with that email already exists" }, { status: 409 });
  }
}
