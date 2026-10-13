/**
 * GET /api/admin/[leagueId]/cricket/backup — the league's auction state now, as a .zip: backup.json
 * (what restore reads) plus readable sheets. Stored snapshots: ../backups.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { backupFileName, backupZip, buildBackup } from "@/lib/sports/cricket/backup";
import { errorResponse } from "@/lib/sports/cricket/http";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const backup = await buildBackup(leagueId);
    const zip = await backupZip(backup);
    return new NextResponse(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backupFileName(backup.league.slug, new Date())}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err, "cricket backup GET");
  }
}
