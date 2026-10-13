/**
 * Server-side fences for routes that only make sense for one family of formats.
 *
 * The gameweek/TVT routes (create-gameweeks, generate-fixtures, captains, chips, …) were written
 * when every league ran on FPL gameweeks, so for any other format they quietly fall through to the
 * TVT code paths. Calling `refuseIfNoGameweeks` right after the league is resolved stops that with a
 * clear 400 instead of writing gameweek or fixture rows into a cricket league.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, leagues } from "@/lib/db";
import { formatCaps } from "./registry";

/** A 400 response if the league's format has no FPL gameweeks; null if the route may proceed. */
export async function refuseIfNoGameweeks(leagueId: string): Promise<NextResponse | null> {
  const [row] = await db.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  if (!row || formatCaps(row.format).usesGameweeks) return null;
  return NextResponse.json(
    { error: `This action is for gameweek-based leagues; ${formatCaps(row.format).label} leagues don't use it.` },
    { status: 400 },
  );
}
