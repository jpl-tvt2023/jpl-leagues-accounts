import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, leagues, teams } from "@/lib/db";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import {
  MembershipError,
  approveJoinRequest,
  assignToTeam,
  findUserByUsername,
  leagueRoster,
  maxMembersFor,
  rejectJoinRequest,
  releaseTeam,
  removeMember,
  replaceMemberAccount,
  transferOwnership,
} from "@/lib/membership";

export const dynamic = "force-dynamic";

/** GET /api/admin/[leagueId]/members — every team with its members and slot state, pending requests, and the live invite. */
export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [league] = await db.select({ authMode: leagues.authMode, format: leagues.format }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  if (league?.authMode !== "members") return NextResponse.json({ error: "This league uses team logins." }, { status: 400 });
  const roster = await leagueRoster(leagueId);
  return NextResponse.json({
    ...roster,
    format: league.format,
    maxMembers: maxMembersFor(league.format),
    invite: roster.invite
      ? {
          id: roster.invite.id,
          token: roster.invite.token,
          maxUses: roster.invite.maxUses,
          useCount: roster.invite.useCount,
          requiresApproval: roster.invite.requiresApproval,
          expiresAt: roster.invite.expiresAt?.toISOString() ?? null,
        }
      : null,
  });
}

type Action =
  | { action: "assign"; teamId: string; username: string }
  | { action: "remove"; memberId: string }
  | { action: "replace"; memberId: string; username: string }
  | { action: "transfer-owner"; memberId: string }
  | { action: "release"; teamId: string }
  | { action: "approve"; requestId: string }
  | { action: "reject"; requestId: string };

/**
 * POST /api/admin/[leagueId]/members { action, … }
 *   assign { teamId, username }       put someone on a team (owner if it has none)
 *   remove { memberId }               take someone off (a teammate inherits ownership)
 *   replace { memberId, username }    lost Google account: same seat, new account
 *   transfer-owner { memberId }       make a teammate the owner
 *   release { teamId }                everyone off; the team and its history stay
 *   approve | reject { requestId }    decide a join request (approve claims a slot)
 */
export async function POST(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const adminId = request.headers.get("x-session-id");
  const body = (await request.json().catch(() => ({}))) as Partial<Action> & Record<string, unknown>;

  const user = async (username: unknown) => {
    const u = typeof username === "string" ? await findUserByUsername(username) : null;
    if (!u) throw new MembershipError("No one has that username. They need to sign in once and pick it first.", 404, "no-user");
    return u;
  };
  const str = (v: unknown, name: string) => {
    if (typeof v !== "string" || !v) throw new MembershipError(`${name} is required`);
    return v;
  };

  try {
    switch (body.action) {
      case "assign": {
        const teamId = str(body.teamId, "teamId");
        const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId))).limit(1);
        if (!team) throw new MembershipError("Team not found in this league.", 404);
        await assignToTeam(leagueId, teamId, (await user(body.username)).id, adminId);
        break;
      }
      case "remove":
        await removeMember(leagueId, str(body.memberId, "memberId"));
        break;
      case "replace":
        await replaceMemberAccount(leagueId, str(body.memberId, "memberId"), (await user(body.username)).id);
        break;
      case "transfer-owner":
        await transferOwnership(leagueId, str(body.memberId, "memberId"));
        break;
      case "release":
        await releaseTeam(leagueId, str(body.teamId, "teamId"));
        break;
      case "approve":
        await approveJoinRequest(str(body.requestId, "requestId"), leagueId, adminId);
        break;
      case "reject":
        await rejectJoinRequest(str(body.requestId, "requestId"), leagueId, adminId);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof MembershipError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
  return NextResponse.json({ success: true, ...(await leagueRoster(leagueId)) });
}
