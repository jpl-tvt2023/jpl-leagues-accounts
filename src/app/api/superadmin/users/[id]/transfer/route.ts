import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { isSuperAdmin } from "@/lib/privilege";
import { MembershipError, transferAllMemberships } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * POST /api/superadmin/users/[id]/transfer { toUserId } — someone lost their Google account and
 * signed in with a new one: move ALL of the old account's team memberships and league-admin
 * assignments (and its role, if higher) to the new account, in one transaction. Refuses where the
 * new account is already in the same league, then revokes the old account's sessions.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSuperAdmin(request))) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { toUserId?: unknown };
  if (typeof body.toUserId !== "string") return NextResponse.json({ error: "toUserId is required" }, { status: 400 });

  const [from] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  const [to] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.toUserId)).limit(1);
  if (!from || !to) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  try {
    const result = await transferAllMemberships(from.id, to.id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof MembershipError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}
