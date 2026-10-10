/**
 * "Which team is this request acting as?" — the one place every team-scoped API answers it.
 *
 * Two kinds of session reach team routes:
 * - Legacy team login (`type: "team"`): the session IS the team. Legacy leagues only.
 * - A person (`type: "user" | "admin" | "superadmin"`): the session is a users row, and the team
 *   comes from team_members. Because a person is on at most one team per league (unique
 *   (league_id, user_id)), the request names the league (`?league=<slug>`) or the team
 *   (`teamId`, as the auction routes already pass) and the membership row settles the rest.
 *
 * The league therefore comes from the URL, never from the cookie: switching leagues is plain
 * navigation, and a stale tab can't act on a team the person switched away from.
 *
 * Every lookup re-reads the database, so removing a member or bumping users.session_version takes
 * effect on the very next request. tests/unit/team-actor-guard.test.ts fails if a team-scoped
 * route reads the session id directly instead of coming through here.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, leagues, teamMembers, teams, users } from "@/lib/db";
import { SESSION_COOKIE_NAME, isPersonSession, verifySession, type SessionPayload } from "@/lib/auth";

export interface TeamActor {
  teamId: string;
  leagueId: string;
  /** The signed-in person; null for a legacy team login. */
  userId: string | null;
  /** "legacy" for a team login; otherwise the person's role on the team. */
  memberRole: "owner" | "member" | "legacy";
}

/** Why no actor resolved. Routes map these onto their own status codes and messages. */
export type TeamActorDenial =
  | "unauthenticated" // no valid session
  | "league-required" // a person's request named neither a league nor a team
  | "forbidden"; // not on that team / that league, or the session was revoked

export type TeamActorResult =
  | { actor: TeamActor; denial?: never }
  | { actor?: never; denial: TeamActorDenial };

export interface TeamActorHint {
  /** League slug or id the request is acting in. */
  league?: string | null;
  /** Team the request claims to act as. Must be the session's own team. */
  teamId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The verified session behind this request, from its cookie. Route handlers only. */
export async function getRequestSession(request: NextRequest): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySession(token) : null;
}

/** A league slug or id → its id, or null if no such league. */
export async function resolveLeagueRef(ref: string): Promise<string | null> {
  const [row] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(UUID_RE.test(ref) ? eq(leagues.id, ref) : eq(leagues.slug, ref))
    .limit(1);
  return row?.id ?? null;
}

/** The league a request names: `?league=` (slug or id). */
export function leagueFromRequest(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("league");
}

/** Resolve the acting team for a session that has already been verified. */
export async function resolveTeamActorForSession(
  session: SessionPayload | null,
  hint: TeamActorHint = {},
): Promise<TeamActorResult> {
  if (!session) return { denial: "unauthenticated" };
  const teamHint = hint.teamId || null;
  const leagueId = hint.league ? await resolveLeagueRef(hint.league) : null;
  if (hint.league && !leagueId) return { denial: "forbidden" };

  if (session.type === "team") {
    const [team] = await db
      .select({ id: teams.id, leagueId: teams.leagueId })
      .from(teams)
      .where(eq(teams.id, session.id))
      .limit(1);
    if (!team) return { denial: "unauthenticated" };
    if (teamHint && teamHint !== team.id) return { denial: "forbidden" };
    if (leagueId && leagueId !== team.leagueId) return { denial: "forbidden" };
    return { actor: { teamId: team.id, leagueId: team.leagueId, userId: null, memberRole: "legacy" } };
  }

  if (!isPersonSession(session)) return { denial: "unauthenticated" };
  if (!teamHint && !leagueId) return { denial: "league-required" };

  const conditions = [eq(teamMembers.userId, session.id), eq(users.sessionVersion, session.sv ?? 0)];
  if (teamHint) conditions.push(eq(teamMembers.teamId, teamHint));
  if (leagueId) conditions.push(eq(teamMembers.leagueId, leagueId));

  const [row] = await db
    .select({ teamId: teamMembers.teamId, leagueId: teamMembers.leagueId, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(...conditions))
    .limit(1);
  if (!row) return { denial: "forbidden" };
  return { actor: { teamId: row.teamId, leagueId: row.leagueId, userId: session.id, memberRole: row.role } };
}

/** Resolve the acting team for this request. See the module comment. */
export async function resolveTeamActor(request: NextRequest, hint: TeamActorHint = {}): Promise<TeamActorResult> {
  return resolveTeamActorForSession(await getRequestSession(request), hint);
}

/**
 * Every team the session may act as: a legacy login's own team, or all of a person's
 * memberships (empty if the session was revoked). Used where one view spans leagues, such as
 * the notification bell.
 */
export async function listSessionTeamIds(session: SessionPayload | null): Promise<string[]> {
  if (!session) return [];
  if (session.type === "team") return [session.id];
  if (!isPersonSession(session)) return [];
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.userId, session.id), eq(users.sessionVersion, session.sv ?? 0)));
  return rows.map((r) => r.teamId);
}

/**
 * True if the session may act as `teamId` — a legacy login for that very team, or a person who is
 * on it. For "teams may only touch their own X" checks where the request names the team.
 */
export async function sessionActsAsTeam(session: SessionPayload | null, teamId: string | null | undefined): Promise<boolean> {
  if (!session || !teamId) return false;
  return !!(await resolveTeamActorForSession(session, { teamId })).actor;
}

/**
 * The session's own team in a league, or null (signed out, admin with no team, not a member, or a
 * legacy login for another league). For read endpoints that flag "mine" in league-wide data.
 */
export async function sessionTeamIdInLeague(session: SessionPayload | null, league: string): Promise<string | null> {
  if (!session) return null;
  return (await resolveTeamActorForSession(session, { league })).actor?.teamId ?? null;
}

/** HTTP status for a denial, for routes without a more specific convention of their own. */
export function denialStatus(denial: TeamActorDenial): number {
  return denial === "unauthenticated" ? 401 : denial === "league-required" ? 400 : 403;
}

const DENIAL_MESSAGES: Record<TeamActorDenial, string> = {
  unauthenticated: "Not authenticated",
  "league-required": "Which league? Add ?league=<slug> to the request.",
  forbidden: "You are not on a team in this league",
};

/** JSON error response for a denial. Pass `messages` to keep a route's existing wording. */
export function teamActorDenied(
  denial: TeamActorDenial,
  messages: Partial<Record<TeamActorDenial, string>> = {},
): NextResponse {
  return NextResponse.json({ error: messages[denial] ?? DENIAL_MESSAGES[denial] }, { status: denialStatus(denial) });
}
