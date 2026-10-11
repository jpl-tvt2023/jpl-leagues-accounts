import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, leagueInvites, leagues, teamMembers, teams, users } from "@/lib/db";
import { leagueFromRequest, resolveTeamActor, teamActorDenied } from "@/lib/team-actor";
import { createPartnerInvite, maxMembersFor, revokeInvite } from "@/lib/membership";

export const dynamic = "force-dynamic";

async function context(request: NextRequest) {
  const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
  if (!actor) return { denied: teamActorDenied(denial) } as const;
  const [league] = await db.select({ format: leagues.format, slug: leagues.slug }).from(leagues).where(eq(leagues.id, actor.leagueId)).limit(1);
  return { actor, format: league?.format ?? "", slug: league?.slug ?? "" } as const;
}

async function activeInvite(teamId: string) {
  const [invite] = await db
    .select()
    .from(leagueInvites)
    .where(and(eq(leagueInvites.teamId, teamId), isNull(leagueInvites.revokedAt), or(isNull(leagueInvites.expiresAt), gt(leagueInvites.expiresAt, new Date()))))
    .orderBy(desc(leagueInvites.createdAt))
    .limit(1);
  return invite && (invite.maxUses === null || invite.useCount < invite.maxUses) ? invite : null;
}

/**
 * GET /api/team/invite?league=<slug> — your team's members, how many it can have, and (for the
 * owner) the live teammate invite.
 */
export async function GET(request: NextRequest) {
  const ctx = await context(request);
  if ("denied" in ctx) return ctx.denied;
  const { actor, format } = ctx;
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, actor.teamId)).limit(1);
  const members = await db
    .select({ id: teamMembers.id, role: teamMembers.role, username: users.username, name: users.name, isMe: eq(users.id, actor.userId!) })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, actor.teamId))
    .orderBy(asc(teamMembers.createdAt));
  const invite = actor.memberRole === "owner" ? await activeInvite(actor.teamId) : null;
  return NextResponse.json({
    teamName: team?.name ?? "",
    role: actor.memberRole,
    maxMembers: maxMembersFor(format),
    members: members.map((m) => ({ ...m, isMe: !!m.isMe })),
    invite: invite ? { token: invite.token, expiresAt: invite.expiresAt?.toISOString() ?? null } : null,
  });
}

/** POST /api/team/invite?league=<slug> — owner creates the teammate invite (replacing any earlier one). */
export async function POST(request: NextRequest) {
  const ctx = await context(request);
  if ("denied" in ctx) return ctx.denied;
  const { actor, format } = ctx;
  if (actor.memberRole !== "owner") return NextResponse.json({ error: "Only the team owner can invite a teammate." }, { status: 403 });
  const max = maxMembersFor(format);
  if (max < 2) return NextResponse.json({ error: "Teams in this format are one person." }, { status: 400 });
  const members = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamId, actor.teamId));
  if (members.length >= max) return NextResponse.json({ error: "Your team already has its full line-up." }, { status: 409 });
  const invite = await createPartnerInvite(actor.teamId, actor.userId!);
  return NextResponse.json({ invite: { token: invite.token, expiresAt: invite.expiresAt?.toISOString() ?? null } });
}

/** DELETE /api/team/invite?league=<slug> — owner turns the teammate invite off. */
export async function DELETE(request: NextRequest) {
  const ctx = await context(request);
  if ("denied" in ctx) return ctx.denied;
  const { actor } = ctx;
  if (actor.memberRole !== "owner") return NextResponse.json({ error: "Only the team owner can do that." }, { status: 403 });
  const invite = await activeInvite(actor.teamId);
  if (invite) await revokeInvite(invite.id);
  return NextResponse.json({ success: true });
}
