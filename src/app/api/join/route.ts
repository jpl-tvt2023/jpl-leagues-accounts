import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, leagues, teams } from "@/lib/db";
import { getRequestPerson } from "@/lib/accounts";
import {
  MembershipError,
  cancelJoinRequest,
  claimOpenSlot,
  fileJoinRequest,
  joinAsPartner,
  loadInvite,
  teamOfUserInLeague,
  INVITE_PROBLEM_MESSAGES,
  SUPERADMIN_CANNOT_JOIN,
} from "@/lib/membership";

export const dynamic = "force-dynamic";

/** Setup first if the team hasn't been set up yet, otherwise the team's dashboard. */
async function landingFor(slug: string, teamId: string): Promise<string> {
  const [team] = await db.select({ done: teams.isProfileComplete }).from(teams).where(eq(teams.id, teamId)).limit(1);
  return team?.done ? `/${slug}/dashboard` : `/${slug}/setup`;
}

/**
 * POST /api/join { token } — use an invite link.
 * - Teammate invite: join that team, in the free FPL slot.
 * - League invite with approval on: file a request for the league's admins.
 * - League invite: claim the first open team, as its owner.
 * Responds { status: "joined" | "pending" | "already-member", redirectTo }.
 */
export async function POST(request: NextRequest) {
  const person = await getRequestPerson(request);
  if (!person) return NextResponse.json({ error: "Sign in first.", code: "signed-out" }, { status: 401 });
  if (person.role === "superadmin") return NextResponse.json({ error: SUPERADMIN_CANNOT_JOIN, code: "superadmin" }, { status: 403 });
  if (!person.username) return NextResponse.json({ error: "Pick a username first.", code: "needs-username" }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const loaded = typeof body.token === "string" ? await loadInvite(body.token) : null;
  if (!loaded) return NextResponse.json({ error: INVITE_PROBLEM_MESSAGES["not-found"], code: "not-found" }, { status: 404 });
  const { invite, league } = loaded;

  const existing = await teamOfUserInLeague(person.id, league.id);
  if (existing) {
    return NextResponse.json({ status: "already-member", redirectTo: await landingFor(league.slug, existing.teamId) });
  }
  if (loaded.problem) {
    return NextResponse.json({ error: INVITE_PROBLEM_MESSAGES[loaded.problem], code: loaded.problem }, { status: 410 });
  }

  try {
    if (invite.teamId) {
      const teamId = await joinAsPartner(invite, person.id);
      return NextResponse.json({ status: "joined", redirectTo: await landingFor(league.slug, teamId) });
    }
    if (invite.requiresApproval) {
      await fileJoinRequest(league.id, person.id, invite.id);
      return NextResponse.json({ status: "pending", redirectTo: `/join/${encodeURIComponent(invite.token)}` });
    }
    const teamId = await claimOpenSlot(league.id, person.id, invite.id);
    return NextResponse.json({ status: "joined", redirectTo: await landingFor(league.slug, teamId) });
  } catch (err) {
    if (err instanceof MembershipError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}

/** DELETE /api/join { leagueId } — withdraw a request that's waiting for approval. */
export async function DELETE(request: NextRequest) {
  const person = await getRequestPerson(request);
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { leagueId?: unknown };
  if (typeof body.leagueId !== "string") return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  const [league] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, body.leagueId)).limit(1);
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  const cancelled = await cancelJoinRequest(league.id, person.id);
  return NextResponse.json({ success: true, cancelled });
}
