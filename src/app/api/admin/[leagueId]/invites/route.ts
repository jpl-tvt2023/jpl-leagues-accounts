import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, leagueInvites, leagues } from "@/lib/db";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { createLeagueInvite, revokeInvite, MembershipError } from "@/lib/membership";

export const dynamic = "force-dynamic";

async function membersLeague(leagueId: string) {
  const [league] = await db.select({ authMode: leagues.authMode, teamSize: leagues.teamSize }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  return league?.authMode === "members" ? league : null;
}

function serialize(i: typeof leagueInvites.$inferSelect) {
  return {
    id: i.id,
    token: i.token,
    maxUses: i.maxUses,
    useCount: i.useCount,
    requiresApproval: i.requiresApproval,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

/** GET /api/admin/[leagueId]/invites — the league's invite links, newest first (the first unrevoked one is live). */
export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await db
    .select()
    .from(leagueInvites)
    .where(and(eq(leagueInvites.leagueId, leagueId), isNull(leagueInvites.teamId)))
    .orderBy(desc(leagueInvites.createdAt))
    .limit(20);
  return NextResponse.json({ invites: rows.map(serialize) });
}

/**
 * POST /api/admin/[leagueId]/invites { requiresApproval?, maxUses?, expiresInDays? }
 * Create the league's invite link. Any earlier live link stops working — this is also "regenerate".
 */
export async function POST(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const league = await membersLeague(leagueId);
  if (!league) return NextResponse.json({ error: "This league hasn't been switched to Google sign-in yet. Ask the superadmin to switch it." }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { requiresApproval?: unknown; maxUses?: unknown; expiresInDays?: unknown };
  const maxUses = body.maxUses === null ? null : typeof body.maxUses === "number" ? Math.floor(body.maxUses) : undefined;
  const expiresInDays = body.expiresInDays === null ? null : typeof body.expiresInDays === "number" ? body.expiresInDays : undefined;
  if (maxUses !== undefined && maxUses !== null && (maxUses < 1 || maxUses > 500)) {
    return NextResponse.json({ error: "maxUses must be between 1 and 500" }, { status: 400 });
  }
  if (expiresInDays !== undefined && expiresInDays !== null && (expiresInDays < 1 || expiresInDays > 365)) {
    return NextResponse.json({ error: "expiresInDays must be between 1 and 365" }, { status: 400 });
  }
  try {
    const invite = await createLeagueInvite(leagueId, request.headers.get("x-session-id"), {
      requiresApproval: body.requiresApproval === true,
      maxUses,
      expiresInDays,
    });
    return NextResponse.json({ invite: serialize(invite) });
  } catch (err) {
    if (err instanceof MembershipError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** DELETE /api/admin/[leagueId]/invites { inviteId } — turn a link off. */
export async function DELETE(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { inviteId?: unknown };
  if (typeof body.inviteId !== "string") return NextResponse.json({ error: "inviteId is required" }, { status: 400 });
  const [invite] = await db.select({ id: leagueInvites.id }).from(leagueInvites).where(and(eq(leagueInvites.id, body.inviteId), eq(leagueInvites.leagueId, leagueId))).limit(1);
  if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  await revokeInvite(invite.id);
  return NextResponse.json({ success: true });
}
