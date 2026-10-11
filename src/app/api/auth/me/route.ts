import { NextRequest, NextResponse } from "next/server";
import { db, users, leagueAdmins, leagues } from "@/lib/db";
import { eq } from "drizzle-orm";
import { verifySession, SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, isPersonSession } from "@/lib/auth";
import { mintPersonSession, sessionTypeForRole } from "@/lib/accounts";
import { setSignedInSession } from "@/lib/session-cookies";

/** Signed-out response that also drops a session cookie that no longer works. */
function signedOut(clearCookie: boolean) {
  const response = NextResponse.json({ authenticated: false }, { status: 200 });
  if (clearCookie) response.cookies.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    const session = await verifySession(token);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    if (isPersonSession(session)) {
      const userList = await db.select().from(users).where(eq(users.id, session.id));
      const user = userList[0];
      // Deleted, or revoked (sign out everywhere, demotion, account replaced): sign this device out.
      if (!user || user.sessionVersion !== (session.sv ?? 0)) return signedOut(true);

      // The role changed since sign-in (promoted, demoted): carry on under a fresh token at the
      // current role, so pages and middleware see the right type from now on.
      const currentType = sessionTypeForRole(user.role);
      const refreshedToken = currentType !== session.type ? await mintPersonSession(user) : null;
      const withRefresh = async (response: NextResponse) => {
        if (refreshedToken) await setSignedInSession(request, response, refreshedToken);
        return response;
      };

      if (currentType === "user") {
        return withRefresh(NextResponse.json({
          authenticated: true,
          type: "user",
          needsUsername: !user.username,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            fplEntryId: user.fplEntryId,
            role: user.role,
          },
        }));
      }

      {
        let adminLeagueId: string | null = null;
        let leagueSlug: string | null = null;
        if (currentType === "admin") {
          const leagueRow = await db
            .select({ leagueId: leagueAdmins.leagueId, slug: leagues.slug })
            .from(leagueAdmins)
            .innerJoin(leagues, eq(leagueAdmins.leagueId, leagues.id))
            .where(eq(leagueAdmins.userId, user.id))
            .limit(2);
          adminLeagueId = leagueRow[0]?.leagueId ?? null;
          leagueSlug = leagueRow.length === 1 ? leagueRow[0].slug ?? null : null;
        }
        return withRefresh(NextResponse.json({
          authenticated: true,
          type: currentType,
          adminLeagueId,
          leagueSlug,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            role: user.role,
            isAdmin: true, // backward compat
          },
        }));
      }
    }

    return NextResponse.json({ authenticated: false }, { status: 200 });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
}
