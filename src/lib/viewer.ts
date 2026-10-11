import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, leagueAdmins, users } from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME, isPersonSession, type SessionPayload } from "@/lib/auth";
import { resolveTeamActorForSession } from "@/lib/team-actor";
import type { ViewerInfo } from "@/lib/league-context";

const SIGNED_OUT: ViewerInfo = { authenticated: false, type: null, dashboardHref: "/signin" };

/**
 * Who a verified session belongs to, and where their dashboard is.
 *
 * Shared by the `[leagueSlug]` layout (via resolveViewerForLeague), the PWA `/launch` route
 * (which sends the installed app straight to the right dashboard) and the account switcher
 * (which redirects after a switch) — one branching table for "where does this session live".
 *
 * A person whose users row is gone, or whose session version was bumped (sign out everywhere,
 * demotion, account replaced), reads as signed out.
 */
export async function resolveViewerForSession(session: SessionPayload | null): Promise<ViewerInfo> {
  if (!session || !isPersonSession(session)) return SIGNED_OUT;

  const [user] = await db
    .select({ username: users.username, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);
  if (!user || user.sessionVersion !== (session.sv ?? 0)) return SIGNED_OUT;
  const base = { authenticated: true, userId: session.id, username: user.username };

  if (session.type === "superadmin") {
    return { ...base, type: "superadmin", dashboardHref: "/admin" };
  }

  if (session.type === "admin") {
    const rows = await db
      .select({ leagueId: leagueAdmins.leagueId })
      .from(leagueAdmins)
      .where(eq(leagueAdmins.userId, session.id))
      .limit(2);
    const adminLeagueId = rows[0]?.leagueId ?? null;
    return {
      ...base,
      type: "admin",
      adminLeagueId,
      dashboardHref: adminLeagueId ? `/admin/${adminLeagueId}` : "/admin",
    };
  }

  // A player. Their leagues live on the home page until the My Leagues hub lands.
  return { ...base, type: "user", dashboardHref: "/" };
}

/**
 * The viewer as seen from one league: `teamId` is their team in THAT league (their membership
 * here) and is absent otherwise — so league pages can show "my team" without a round-trip of
 * their own. `isLeagueAdmin` covers superadmins and this league's admins.
 */
export async function resolveViewerForLeague(session: SessionPayload | null, leagueId: string, leagueSlug?: string): Promise<ViewerInfo> {
  const viewer = await resolveViewerForSession(session);
  if (!session || !viewer.authenticated) return viewer;

  const { actor } = await resolveTeamActorForSession(session, { league: leagueId });
  let isLeagueAdmin = session.type === "superadmin";
  if (session.type === "admin") {
    const [row] = await db
      .select({ id: leagueAdmins.id })
      .from(leagueAdmins)
      .where(and(eq(leagueAdmins.userId, session.id), eq(leagueAdmins.leagueId, leagueId)))
      .limit(1);
    isLeagueAdmin = !!row;
  }
  return {
    ...viewer,
    teamId: actor?.teamId,
    isLeagueAdmin,
    // A person's dashboard for this league lives under it (they may be on teams in several).
    ...(actor && leagueSlug ? { dashboardHref: `/${leagueSlug}/dashboard` } : {}),
  };
}

async function currentSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySession(token) : null;
}

/** The viewer behind the current request's session cookie. Server components / route handlers only. */
export async function resolveViewer(): Promise<ViewerInfo> {
  return resolveViewerForSession(await currentSession());
}

/** The viewer behind the current request, as seen from one league. */
export async function resolveViewerInLeague(leagueId: string, leagueSlug?: string): Promise<ViewerInfo> {
  return resolveViewerForLeague(await currentSession(), leagueId, leagueSlug);
}
