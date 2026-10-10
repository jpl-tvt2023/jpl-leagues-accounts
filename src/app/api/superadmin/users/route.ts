import { NextResponse, type NextRequest } from "next/server";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { db, leagueAdmins, leagues, teamMembers, teams, users } from "@/lib/db";
import { isSuperAdmin } from "@/lib/privilege";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/users?q=<username, name or email> — find people (up to 25), with their
 * team memberships and admin leagues. For account recovery: find the old and new accounts, then
 * POST /api/superadmin/users/[id]/transfer.
 */
export async function GET(request: NextRequest) {
  if (!(await isSuperAdmin(request))) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().replace(/^@/, "");
  if (q.length < 2) return NextResponse.json({ users: [] });
  const pattern = `%${q.replace(/[%_]/g, "")}%`;

  const found = await db
    .select({ id: users.id, username: users.username, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(or(like(users.username, pattern), like(sql`LOWER(${users.name})`, pattern), like(sql`LOWER(${users.email})`, pattern)))
    .limit(25);
  const ids = found.map((u) => u.id);
  const memberships = ids.length
    ? await db
        .select({ userId: teamMembers.userId, role: teamMembers.role, teamName: teams.name, leagueName: leagues.name, leagueSlug: leagues.slug })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .innerJoin(leagues, eq(leagues.id, teamMembers.leagueId))
        .where(inArray(teamMembers.userId, ids))
    : [];
  const adminOf = ids.length
    ? await db
        .select({ userId: leagueAdmins.userId, leagueName: leagues.name })
        .from(leagueAdmins)
        .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
        .where(inArray(leagueAdmins.userId, ids))
    : [];

  return NextResponse.json({
    users: found.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      teams: memberships.filter((m) => m.userId === u.id).map((m) => ({ role: m.role, teamName: m.teamName, leagueName: m.leagueName, leagueSlug: m.leagueSlug })),
      adminOf: adminOf.filter((a) => a.userId === u.id).map((a) => a.leagueName),
    })),
  });
}
