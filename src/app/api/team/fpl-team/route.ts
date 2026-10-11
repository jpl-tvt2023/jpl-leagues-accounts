import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, teamMembers, users } from "@/lib/db";
import { leagueFromRequest, resolveTeamActor, teamActorDenied } from "@/lib/team-actor";
import { MembershipError, readPlayerDetails, saveOwnPlayer } from "@/lib/membership";
import { hasFplTeam } from "@/lib/fpl-teams";
import { invalidateLeaguePageCache } from "@/lib/fpl-cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/fpl-team?league=<slug> { fplId } — switch which of your saved FPL teams plays for
 * you in this league. Only once you've set up (setup picks the first one), and only until the
 * league's FPL teams are fixed at its first gameweek deadline; after that a league admin changes
 * it. The FPL team can't already be playing for another team in the league.
 */
export async function POST(request: NextRequest) {
  const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
  if (!actor) return teamActorDenied(denial);

  const [mine] = await db
    .select({ playerId: teamMembers.playerId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, actor.userId), eq(teamMembers.teamId, actor.teamId)))
    .limit(1);
  if (!mine?.playerId) return NextResponse.json({ error: "Finish team setup first.", code: "needs-setup" }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { fplId?: unknown };
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1);
  const details = readPlayerDetails({ name: me?.name ?? "", fplId: body.fplId });
  if ("error" in details) return NextResponse.json({ error: details.error }, { status: 400 });
  if (!(await hasFplTeam(actor.userId, details.fplId))) {
    return NextResponse.json({ error: "Add that FPL team to your list first.", code: "not-saved" }, { status: 400 });
  }

  try {
    await saveOwnPlayer(actor.teamId, actor.userId, details);
    await invalidateLeaguePageCache(actor.leagueId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof MembershipError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}
