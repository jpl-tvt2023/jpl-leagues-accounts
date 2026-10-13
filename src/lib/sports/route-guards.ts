/**
 * Server-side fences for routes that only make sense for one family of formats.
 *
 * The gameweek/TVT routes (create-gameweeks, generate-fixtures, captains, chips, …) were written
 * when every league ran on FPL gameweeks, so for any other format they quietly fall through to the
 * TVT code paths. Calling `refuseIfNoGameweeks` right after the league is resolved stops that with a
 * clear 400 instead of writing gameweek or fixture rows into a cricket league.
 *
 * The FPL auction API (`/api/auction/*`) is fenced the same way. Creating an auction session already
 * checks the format, so the endpoints keyed by a session can never reach another format; the ones
 * keyed by a league or a team call `refuseUnlessFplAuction` with that league.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, leagues } from "@/lib/db";
import { FPL_AUCTION_FORMAT, formatCaps } from "./registry";

/** A 400 response if the league's format has no FPL gameweeks; null if the route may proceed. */
export async function refuseIfNoGameweeks(leagueId: string): Promise<NextResponse | null> {
  const [row] = await db.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  if (!row || formatCaps(row.format).usesGameweeks) return null;
  return NextResponse.json(
    { error: `This action is for gameweek-based leagues; ${formatCaps(row.format).label} leagues don't use it.` },
    { status: 400 },
  );
}

function notFplAuction(format: string): NextResponse | null {
  if (format === FPL_AUCTION_FORMAT) return null;
  return NextResponse.json(
    { error: `This is part of the FPL auction; ${formatCaps(format).label} leagues don't use it.` },
    { status: 400 },
  );
}

/**
 * A 400 response unless the league runs the FPL auction format; null if the route may proceed. An
 * unknown league also proceeds, so the route reports it as it always has.
 */
export async function refuseUnlessFplAuction(leagueId: string): Promise<NextResponse | null> {
  const [row] = await db.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  return row ? notFplAuction(row.format) : null;
}
