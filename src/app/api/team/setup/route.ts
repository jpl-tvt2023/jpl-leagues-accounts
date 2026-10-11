import { NextRequest, NextResponse } from "next/server";
import { db, teams, leagues, teamMembers, users } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { leagueFromRequest, resolveTeamActor, teamActorDenied } from "@/lib/team-actor";
import { invalidateLeaguePageCache } from "@/lib/fpl-cache";
import { MembershipError, leagueFplLock, maxMembersFor, needsSetup, readPlayerDetails, saveOwnPlayer, teamSlots } from "@/lib/membership";
import { fplIdsTakenInLeague, hasFplTeam, listFplTeams } from "@/lib/fpl-teams";

/** Check if a league uses the auction format (no FPL player IDs needed at setup) */
async function isAuctionLeague(leagueId: string): Promise<boolean> {
  const row = await db.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  return row.length > 0 && row[0].format === "auction";
}

/**
 * GET /api/team/setup
 * What this person's setup needs: the team, its FPL slots (theirs and any nobody is linked to),
 * their saved FPL teams to pick from (each marked if it already plays for another team here), and
 * when the league's FPL teams get fixed. With ?checkName=, whether a team name is free.
 */
export async function GET(request: NextRequest) {
  try {
    const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
    if (!actor) return teamActorDenied(denial, { unauthenticated: "Unauthorized" });
    const teamId = actor.teamId;

    // Get current team to know leagueId for per-league checks
    const teamList = await db.select().from(teams).where(eq(teams.id, teamId));
    const team = teamList[0];

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Team name uniqueness check
    const checkName = request.nextUrl.searchParams.get("checkName");

    if (checkName) {
      // Per-league uniqueness check: query teams in this league for this name (case-insensitive)
      const existing = await db.select().from(teams).where(
        and(eq(teams.leagueId, team.leagueId), sql`LOWER(REPLACE(${teams.name}, ' ', '')) = LOWER(REPLACE(${checkName}, ' ', ''))`)
      ).limit(1);
      // Available if: no team with this name in league, OR this is the current team's name
      return NextResponse.json({
        available: existing.length === 0 || existing[0].id === teamId,
      });
    }

    const [league] = await db
      .select({ slug: leagues.slug, format: leagues.format, clubAuctionEnabled: leagues.clubAuctionEnabled })
      .from(leagues)
      .where(eq(leagues.id, team.leagueId))
      .limit(1);
    const format = league?.format ?? "tvt";
    const maxMembers = maxMembersFor(format);
    const slots = await teamSlots(teamId);
    const members = await db
      .select({ userId: teamMembers.userId, role: teamMembers.role, playerId: teamMembers.playerId, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId));
    const mine = members.find((m) => m.userId === actor.userId);
    const mySlot = slots.find((s) => s.id === mine?.playerId) ?? null;
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1);
    const slotView = (s: (typeof slots)[number]) => ({ id: s.id, name: s.name, fplId: s.fplId });
    const [saved, taken, lock] = await Promise.all([listFplTeams(actor.userId), fplIdsTakenInLeague(team.leagueId), leagueFplLock(team.leagueId)]);

    return NextResponse.json({
      teamId: team.id,
      currentLoginId: team.teamLoginId,
      currentName: team.name,
      isProfileComplete: team.isProfileComplete,
      needsSetup: needsSetup({ format, isProfileComplete: team.isProfileComplete, playerId: mine?.playerId ?? null }),
      role: actor.memberRole,
      leagueSlug: league?.slug ?? null,
      leagueFormat: format,
      clubAuctionEnabled: league?.clubAuctionEnabled ?? false,
      maxMembers,
      memberCount: members.length,
      ownerName: members.find((m) => m.role === "owner")?.name ?? null,
      mySlot: mySlot ? slotView(mySlot) : null,
      // FPL slots nobody is linked to: one the owner filled in for a partner, or a past member's.
      openSlots: slots.filter((s) => !s.userId).map(slotView),
      canAddSlot: slots.length < maxMembers,
      // Your name in the league is your display name.
      myName: me?.name ?? "",
      fplTeams: saved.map((t) => {
        const holder = taken.get(t.fplEntryId);
        return {
          id: t.id,
          fplEntryId: t.fplEntryId,
          teamName: t.teamName,
          managerName: t.managerName,
          isPrimary: t.isPrimary,
          // Already playing for another team in this league, so it can't be picked here.
          takenBy: holder && holder.teamId !== teamId ? holder.teamName : null,
        };
      }),
      lock: lock ? { gw: lock.gw, deadline: lock.deadline.toISOString() } : null,
    });
  } catch (error) {
    console.error("Setup GET error:", error);
    return NextResponse.json({ error: "Failed to fetch setup info" }, { status: 500 });
  }
}

/**
 * POST /api/team/setup { teamName?, fplId, slotId? }
 * Each person sets up their own part of the team. The owner names the team (a teammate's
 * teamName is ignored). In TVT and Continental everyone then picks one of their saved FPL teams
 * (`fplId`), which plays under their display name in their own slot, the unlinked slot they pick
 * (`slotId`), or a new one; the team is complete once every slot is filled. Auction: just the name.
 */
export async function POST(request: NextRequest) {
  try {
    const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
    if (!actor) return teamActorDenied(denial, { unauthenticated: "Unauthorized" });
    const teamId = actor.teamId;
    const isOwner = actor.memberRole === "owner";

    const body = (await request.json().catch(() => ({}))) as { teamName?: unknown; fplId?: unknown; slotId?: unknown };

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    const leagueId = team.leagueId;
    const isAuction = await isAuctionLeague(leagueId);

    // ============= Team name (owner only) =============
    // The team keeps its internal team key; setup only names it.
    let trimmedTeamName: string | null = null;
    if (isOwner) {
      trimmedTeamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
      if (!trimmedTeamName) {
        return NextResponse.json({ error: "Team name is required" }, { status: 400 });
      }
      // Unique within the league (case- and space-insensitive), unless it's this team's own name.
      const existingName = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.leagueId, leagueId), sql`LOWER(REPLACE(${teams.name}, ' ', '')) = LOWER(REPLACE(${trimmedTeamName}, ' ', ''))`));
      if (existingName.length > 0 && existingName[0].id !== teamId) {
        return NextResponse.json({ error: "Team name is already taken in this league" }, { status: 400 });
      }
    }

    // Auction format: only needs team name (players acquired via auction)
    if (isAuction) {
      if (!trimmedTeamName) {
        return NextResponse.json({ error: "Only the team owner can set up this team." }, { status: 403 });
      }
      // Update team: name, isProfileComplete = true
      // Also initialize purse from league's initial budget on first-time setup only
      const updateSet: Partial<typeof teams.$inferInsert> = {
        name: trimmedTeamName,
        isProfileComplete: true,
        updatedAt: new Date(),
      };

      if (!team.isProfileComplete) {
        const leagueRow = await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
        const initialBudget = leagueRow[0]?.initialBudget ?? 100_000_000;
        updateSet.purse = initialBudget;
      }

      await db
        .update(teams)
        .set(updateSet)
        .where(eq(teams.id, teamId));

      await invalidateLeaguePageCache(leagueId);

      return NextResponse.json({
        success: true,
        message: "Profile setup completed (auction format — players acquired via auction)",
      });
    }

    // ============= TVT / Continental: one of your saved FPL teams, under your display name =============
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1);
    const details = readPlayerDetails({ name: me?.name ?? "", fplId: body.fplId }, "Your");
    if ("error" in details) {
      return NextResponse.json({ error: details.error }, { status: 400 });
    }
    if (!(await hasFplTeam(actor.userId, details.fplId))) {
      return NextResponse.json({ error: "Add that FPL team to your list first.", code: "not-saved" }, { status: 400 });
    }

    const slotId = typeof body.slotId === "string" && body.slotId ? body.slotId : null;
    const { teamComplete } = await saveOwnPlayer(teamId, actor.userId, details, slotId);
    if (trimmedTeamName && trimmedTeamName !== team.name) {
      await db.update(teams).set({ name: trimmedTeamName, updatedAt: new Date() }).where(eq(teams.id, teamId));
    }

    await invalidateLeaguePageCache(leagueId);

    return NextResponse.json({ success: true, teamComplete });
  } catch (error) {
    if (error instanceof MembershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Setup POST error:", error);
    return NextResponse.json(
      { error: "Failed to complete setup" },
      { status: 500 }
    );
  }
}
