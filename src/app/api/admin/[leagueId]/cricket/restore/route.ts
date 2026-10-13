/**
 * POST /api/admin/[leagueId]/cricket/restore — replace the league's auction state with a backup's.
 *
 *   JSON { backupId }                    → a stored snapshot
 *   multipart/form-data with a file      → an uploaded backup .zip (only its backup.json is read)
 *
 * Refused, with nothing written, when the backup is another league's, names teams, players or
 * franchises the tournament no longer has, or an auction session is running (pause it first).
 * See lib/sports/cricket/backup.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { requireCricketLeague } from "@/lib/sports/cricket/admin";
import { backupFromZip, getSnapshot, restoreBackup } from "@/lib/sports/cricket/backup";
import { errorResponse } from "@/lib/sports/cricket/http";

export const maxDuration = 60;

const MAX_ZIP_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const info = await requireCricketLeague(leagueId);
    let backup: unknown;
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) return NextResponse.json({ error: "Attach the backup .zip as the file field" }, { status: 400 });
      if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "That file is too big to be a cricket backup" }, { status: 400 });
      backup = await backupFromZip(await file.arrayBuffer());
    } else {
      const body = (await request.json().catch(() => ({}))) as { backupId?: unknown };
      if (typeof body.backupId !== "string") return NextResponse.json({ error: "backupId or a file is required" }, { status: 400 });
      const snap = await getSnapshot(info.league.id, body.backupId);
      if (!snap) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
      backup = snap.backup;
    }
    const result = await restoreBackup(info.league.id, backup);
    if (result.errors.length) return NextResponse.json({ error: result.errors[0], errors: result.errors, counts: result.counts }, { status: 422 });
    return NextResponse.json({ restored: true, counts: result.counts });
  } catch (err) {
    return errorResponse(err, "cricket restore");
  }
}
