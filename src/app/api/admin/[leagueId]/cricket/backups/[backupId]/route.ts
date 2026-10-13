/** GET /api/admin/[leagueId]/cricket/backups/[backupId] — a stored snapshot as a .zip. */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { requireCricketLeague } from "@/lib/sports/cricket/admin";
import { backupFileName, backupZip, getSnapshot } from "@/lib/sports/cricket/backup";
import { errorResponse } from "@/lib/sports/cricket/http";

type Params = { params: Promise<{ backupId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { backupId } = await params;
    const info = await requireCricketLeague(leagueId);
    const snap = await getSnapshot(info.league.id, backupId);
    if (!snap) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    return new NextResponse(await backupZip(snap.backup), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backupFileName(snap.backup.league.slug, snap.createdAt)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err, "cricket backup download");
  }
}
