import { NextRequest, NextResponse } from "next/server";
import { db, teams, players, groups, leagues } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { invalidateLeaguePageCache } from "@/lib/sports/fpl/cache";
import { maxMembersFor, refreshTeamComplete } from "@/lib/membership";

/**
 * PUT /api/admin/[leagueId]/update-team
 * Admin-only endpoint to update team details
 */
export async function PUT(request: NextRequest) {
  try {
    const leagueId = await getAuthorizedLeagueId(request);
    if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const {
      teamId,
      teamLoginId,
      teamName,
      player1Id,
      player1Name,
      player1FplId,
      player2Id,
      player2Name,
      player2FplId,
      group,
    } = body;
    // Distinguish "group not provided" from "group explicitly set to empty".
    // Only mutate groupId when the client actually included a `group` key.
    const groupProvided = Object.prototype.hasOwnProperty.call(body, "group");

    // Only teamId (the target identifier) is required. Every other attribute —
    // teamLoginId, teamName, group, player fields — is independently
    // optional: whatever's provided gets validated and updated, whatever's left
    // blank/omitted is left untouched.
    if (!teamId) {
      return NextResponse.json(
        { error: "Team ID is required" },
        { status: 400 }
      );
    }

    const teamLoginIdProvided = typeof teamLoginId === "string" && teamLoginId.trim() !== "";
    const teamNameProvided = typeof teamName === "string" && teamName.trim() !== "";

    // Preserve the submitted casing for storage; the lowercased copy is used only
    // for the case-insensitive uniqueness check below.
    let trimmedLoginId = "";
    let normalizedLoginId = "";
    if (teamLoginIdProvided) {
      // Validate teamLoginId format
      if (!/^[A-Za-z0-9_-]{3,30}$/.test(teamLoginId)) {
        return NextResponse.json(
          { error: "Team ID must be 3–30 alphanumeric/underscore/hyphen characters" },
          { status: 400 }
        );
      }
      trimmedLoginId = String(teamLoginId).trim();
      normalizedLoginId = trimmedLoginId.toLowerCase();
    }

    // Check league format — auction leagues don't use groups
    const leagueRow = await db.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
    const isAuction = leagueRow[0]?.format === "auction";

    // Validate group: only when the client actually sent a `group` key AND the
    // league uses the A/B PL grouping (TVT-16 / similar). Continental Championship, TVT-32,
    // and auction leagues use different group concepts (cup groups, multi-letter
    // groups, or none) — for those, the team's groupId is preserved as-is and
    // the validator is skipped entirely.
    if (groupProvided && !isAuction && group && group !== "A" && group !== "B") {
      return NextResponse.json(
        { error: "Group must be either A or B" },
        { status: 400 }
      );
    }

    // Check if team exists and belongs to authorized league
    const existingTeam = await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId)));
    if (existingTeam.length === 0) {
      return NextResponse.json(
        { error: "Team not found" },
        { status: 404 }
      );
    }

    // Block edits to Continental Championship ghost-team placeholders. Ghosts are managed
    // automatically by cup-group generation; renaming or assigning a login ID
    // to one would break the bye-week schedule. Mirrors the delete-team guard.
    if (existingTeam[0].isGhost) {
      return NextResponse.json(
        { error: "Cannot edit a ghost team (Continental Championship bye placeholder). Ghost teams are managed automatically by cup group generation." },
        { status: 400 }
      );
    }

    // Global uniqueness check on teamLoginId (case-insensitive; unless it's the same team's current login ID)
    if (teamLoginIdProvided) {
      const conflictingLoginId = await db.select().from(teams).where(
        sql`LOWER(${teams.teamLoginId}) = ${normalizedLoginId}`
      );
      if (conflictingLoginId.length > 0 && conflictingLoginId[0].id !== teamId) {
        return NextResponse.json(
          { error: "Team ID already exists globally" },
          { status: 400 }
        );
      }
    }

    // Check if new team name conflicts with another team in this league (case-insensitive)
    if (teamNameProvided) {
      const conflictingTeam = await db.select().from(teams).where(
        and(sql`LOWER(REPLACE(${teams.name}, ' ', '')) = LOWER(REPLACE(${teamName}, ' ', ''))`, eq(teams.leagueId, leagueId))
      );
      if (conflictingTeam.length > 0 && conflictingTeam[0].id !== teamId) {
        return NextResponse.json(
          { error: "Team name already exists in this league" },
          { status: 400 }
        );
      }
    }

    // Resolve group (null if not provided or auction format)
    let groupId: string | null = null;
    if (!isAuction && group && group !== "Unassigned") {
      const groupRecords = await db.select().from(groups).where(
        and(eq(groups.name, group), eq(groups.leagueId, leagueId))
      );
      const groupRecord = groupRecords[0];

      if (!groupRecord) {
        groupId = generateId();
        await db.insert(groups).values({ id: groupId, name: group, leagueId, groupType: "jpl" });
      } else {
        groupId = groupRecord.id;
      }
    }

    // Update team — only include attributes that were actually provided.
    const updateData: Record<string, unknown> = {};
    if (teamLoginIdProvided) {
      updateData.teamLoginId = trimmedLoginId;
    }
    if (teamNameProvided) {
      updateData.name = teamName;
    }

    // Only mutate groupId when the client actually sent a `group` key and the
    // league uses groups at all. Otherwise preserve the existing groupId
    // (important for TC / TVT-32 where the modal hides the Group field).
    if (groupProvided && !isAuction) {
      updateData.groupId = groupId;
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(teams).set(updateData).where(eq(teams.id, teamId));
    }

    // Update players (only if player data is provided)
    if (player1Name && player1FplId && player1Id) {
      await db.update(players).set({
        name: player1Name,
        fplId: player1FplId,
      }).where(eq(players.id, player1Id));
    }

    if (player2Name && player2FplId && player2Id) {
      await db.update(players).set({
        name: player2Name,
        fplId: player2FplId,
      }).where(eq(players.id, player2Id));
    }

    // A slot with no player yet (a team still waiting for its partner): filling it in adds the
    // player, up to the format's line-up. Nobody is linked to it; a partner who joins later takes
    // it over in their own setup.
    if (!isAuction) {
      const missing = [
        { id: player1Id, name: player1Name, fplId: player1FplId },
        { id: player2Id, name: player2Name, fplId: player2FplId },
      ].filter((p) => !p.id && typeof p.name === "string" && p.name.trim() && typeof p.fplId === "string" && p.fplId.trim());
      if (missing.length > 0) {
        if (missing.some((p) => !/^\d{1,10}$/.test(p.fplId.trim()))) {
          return NextResponse.json({ error: "FPL IDs must be numbers" }, { status: 400 });
        }
        const existing = await db.select({ id: players.id }).from(players).where(eq(players.teamId, teamId));
        const room = maxMembersFor(leagueRow[0]?.format ?? "") - existing.length;
        const toAdd = missing.slice(0, Math.max(0, room));
        if (toAdd.length > 0) {
          await db.insert(players).values(toAdd.map((p) => ({ id: generateId(), teamId, name: p.name.trim(), fplId: p.fplId.trim() })));
        }
      }
      await refreshTeamComplete(teamId);
    }

    await invalidateLeaguePageCache(leagueId);
    return NextResponse.json({
      success: true,
      message: "Team updated successfully",
    });
  } catch (error) {
    console.error("Error updating team:", error);
    return NextResponse.json(
      { error: "Failed to update team" },
      { status: 500 }
    );
  }
}
