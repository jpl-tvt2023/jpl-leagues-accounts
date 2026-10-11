import { NextResponse, type NextRequest } from "next/server";
import { leagueFromRequest, resolveTeamActor, teamActorDenied } from "@/lib/team-actor";
import { MembershipError, readPlayerDetails, savePartnerByOwner } from "@/lib/membership";
import { invalidateLeaguePageCache } from "@/lib/fpl-cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/partner?league=<slug> { name, fplId } — the owner enters a partner who won't sign
 * in. It fills the team's free FPL slot without linking anyone to it; if the partner does join
 * later with the team link, they take that slot over in their own setup. Saving again edits it.
 */
export async function POST(request: NextRequest) {
  const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
  if (!actor) return teamActorDenied(denial);
  if (actor.memberRole !== "owner") return NextResponse.json({ error: "Only the team owner can do that." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; fplId?: unknown };
  const details = readPlayerDetails(body, "Your partner's");
  if ("error" in details) return NextResponse.json({ error: details.error }, { status: 400 });

  try {
    const { teamComplete } = await savePartnerByOwner(actor.teamId, actor.userId, details);
    await invalidateLeaguePageCache(actor.leagueId);
    return NextResponse.json({ success: true, teamComplete });
  } catch (err) {
    if (err instanceof MembershipError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}
