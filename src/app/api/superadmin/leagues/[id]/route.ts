import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  leagues, groups, teams, players, gameweeks, fixtures, results,
  gameweekChips, playoffTies, challengerSurvivalEntries, leagueAdmins, settings,
  auctionBids, auctionWishlists, auctionOwnership, auctionScores, auctionSessions, tradeProposals,
  fplClassicConfig, fplClassicEntrants, fplClassicEntryGws, fplClassicAwards,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { isSuperAdmin } from "@/lib/privilege";
import { invalidateLeaguePageCache } from "@/lib/sports/fpl/cache";
import { validateEnabledChipsArray } from "@/lib/sports/fpl/formats/tvt/chip-validation";
import { findEnabledChipsLock } from "@/lib/sports/fpl/formats/tvt/enabled-chips-lock";
import { MembershipError, switchLeagueToGoogleSignIn } from "@/lib/membership";

/**
 * PATCH /api/superadmin/leagues/[id] { name?, season?, isActive?, enabledChips?, authMode? }
 *
 * `authMode: "members"` switches a league from before accounts (team logins) to Google sign-in —
 * see switchLeagueToGoogleSignIn. It can't be switched back.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const updates: { name?: string; season?: string; isActive?: boolean; enabledChips?: string } = {};
  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.season === "string") updates.season = body.season;
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;

  // enabledChips is only meaningful for TVT leagues and must match the same
  // shape rule the POST handler enforces (3 unique entries from
  // {W,D,C,SL,CB,UD}). Reject any attempt to set it on non-TVT leagues so the
  // hardcoded [] used for Continental Championship / Auction cannot be silently overwritten.
  if (body.enabledChips !== undefined) {
    const leagueRow = await db
      .select({ format: leagues.format })
      .from(leagues)
      .where(eq(leagues.id, id))
      .limit(1);
    if (leagueRow.length === 0) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }
    if (leagueRow[0].format !== "tvt") {
      return NextResponse.json(
        { error: "enabledChips can only be updated on TVT leagues" },
        { status: 400 }
      );
    }
    const chipCheck = validateEnabledChipsArray(body.enabledChips);
    if (!chipCheck.ok) {
      return NextResponse.json({ error: chipCheck.error }, { status: 400 });
    }

    // A league's chip set is fixed for the season — agreed before kick-off and never swapped.
    // See enabled-chips-lock.ts for why this has to be enforced rather than trusted. Before the
    // season starts there is nothing to orphan, so a genuine setup mistake is still correctable.
    const blocker = await findEnabledChipsLock(id);
    if (blocker) {
      return NextResponse.json(
        {
          error:
            `A league's chips are fixed for the season once it has started, and this one has: ${blocker}. ` +
            `Chips can only be changed before kick-off.`,
        },
        { status: 409 }
      );
    }

    updates.enabledChips = JSON.stringify(chipCheck.chips);
  }

  const switchToMembers = body.authMode !== undefined;
  if (switchToMembers && body.authMode !== "members") {
    return NextResponse.json({ error: "authMode can only be set to \"members\" (Google sign-in)" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0 && !switchToMembers) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  if (switchToMembers) {
    try {
      await switchLeagueToGoogleSignIn(id, request.headers.get("x-session-id"));
    } catch (err) {
      if (err instanceof MembershipError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }

  if (Object.keys(updates).length > 0) await db.update(leagues).set(updates).where(eq(leagues.id, id));
  await invalidateLeaguePageCache(id);
  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/superadmin/leagues/[id] { confirm }
 * Permanently delete a league and ALL its data. `confirm` must be the league's slug, typed by the
 * superadmin: people sign in with Google, so there is no password to re-enter.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isSuperAdmin(request))) {
    return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  }

  const superadminUserId = request.headers.get("x-session-id");
  if (!superadminUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  // A bodyless DELETE is a caller mistake, not a server fault: without the catch, request.json()
  // throws SyntaxError and this returns a bare 500 that no caller can branch on.
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const confirm = typeof body.confirm === "string" ? body.confirm.trim().toLowerCase() : "";

  if (!confirm) {
    return NextResponse.json({ error: "Type the league's slug to confirm deletion" }, { status: 400 });
  }

  // Verify the league exists
  const leagueRow = await db.select({ id: leagues.id, name: leagues.name, slug: leagues.slug }).from(leagues).where(eq(leagues.id, id)).limit(1);
  if (leagueRow.length === 0) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }
  if (confirm !== leagueRow[0].slug.toLowerCase()) {
    return NextResponse.json({ error: "That doesn't match the league's slug" }, { status: 403 });
  }

  // Gather IDs needed for cascade
  const leagueGameweeks = await db.select({ id: gameweeks.id }).from(gameweeks).where(eq(gameweeks.leagueId, id));
  const gwIds = leagueGameweeks.map(g => g.id);

  const leagueTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, id));
  const teamIds = leagueTeams.map(t => t.id);

  const leagueFixtures = gwIds.length > 0
    ? await db.select({ id: fixtures.id }).from(fixtures).where(inArray(fixtures.gameweekId, gwIds))
    : [];
  const fixtureIds = leagueFixtures.map(f => f.id);

  await db.transaction(async (tx) => {
    // 1. Results (depend on fixtures)
    if (fixtureIds.length > 0) {
      await tx.delete(results).where(inArray(results.fixtureId, fixtureIds));
    }
    // 2. Challenger survival entries (depend on gameweeks + teams)
    if (gwIds.length > 0) {
      await tx.delete(challengerSurvivalEntries).where(inArray(challengerSurvivalEntries.gameweekId, gwIds));
    }
    // 3. Gameweek chips (depend on teams)
    if (teamIds.length > 0) {
      await tx.delete(gameweekChips).where(inArray(gameweekChips.teamId, teamIds));
    }
    // 4. Fixtures (depend on gameweeks)
    if (fixtureIds.length > 0) {
      await tx.delete(fixtures).where(inArray(fixtures.id, fixtureIds));
    }
    // 5. Playoff ties (depend on league)
    await tx.delete(playoffTies).where(eq(playoffTies.leagueId, id));
    // 6. Players (depend on teams)
    if (teamIds.length > 0) {
      await tx.delete(players).where(inArray(players.teamId, teamIds));
    }
    // 7. Auction data (FK: league, team, session, gameweek). Order matters:
    //    bids → wishlists → ownership → scores → trade proposals → sessions.
    await tx.delete(auctionBids).where(eq(auctionBids.leagueId, id));
    await tx.delete(auctionWishlists).where(eq(auctionWishlists.leagueId, id));
    await tx.delete(auctionOwnership).where(eq(auctionOwnership.leagueId, id));
    await tx.delete(auctionScores).where(eq(auctionScores.leagueId, id));
    await tx.delete(tradeProposals).where(eq(tradeProposals.leagueId, id));
    await tx.delete(auctionSessions).where(eq(auctionSessions.leagueId, id));
    // 7b. FPL Classic data. ON DELETE CASCADE would cover these, but that relies on the
    //     `PRAGMA foreign_keys = ON` in db/index.ts being in force on this connection — every
    //     other block here deletes explicitly rather than trusting it, so these do too.
    //     Awards reference entrants, so awards go first.
    await tx.delete(fplClassicAwards).where(eq(fplClassicAwards.leagueId, id));
    await tx.delete(fplClassicEntryGws).where(eq(fplClassicEntryGws.leagueId, id));
    await tx.delete(fplClassicEntrants).where(eq(fplClassicEntrants.leagueId, id));
    await tx.delete(fplClassicConfig).where(eq(fplClassicConfig.leagueId, id));
    // 8. Settings (depend on league)
    await tx.delete(settings).where(eq(settings.leagueId, id));
    // 9. League admins (depend on league)
    await tx.delete(leagueAdmins).where(eq(leagueAdmins.leagueId, id));
    // 10. Teams (depend on groups + league)
    await tx.delete(teams).where(eq(teams.leagueId, id));
    // 11. Groups (depend on league)
    await tx.delete(groups).where(eq(groups.leagueId, id));
    // 12. Gameweeks (depend on league)
    await tx.delete(gameweeks).where(eq(gameweeks.leagueId, id));
    // 13. League itself
    await tx.delete(leagues).where(eq(leagues.id, id));
  });

  return NextResponse.json({
    success: true,
    message: `League "${leagueRow[0].name}" and all its data have been permanently deleted.`,
  });
}
