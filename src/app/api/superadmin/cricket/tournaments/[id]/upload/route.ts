/**
 * POST /api/superadmin/cricket/tournaments/[id]/upload
 *
 * Body: { kind: "teams" | "players" | "fixtures" | "points", mode: "validate" | "commit",
 *         rows: object[], fileName?, validationHash?, override? }
 *
 * The page parses the spreadsheet in the browser and sends its rows. "validate" is a dry run that
 * reports every problem and what would change; "commit" re-validates and applies it atomically.
 * See src/lib/sports/cricket/uploads.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { runUpload } from "@/lib/sports/cricket/uploads";
import { SHEET_KINDS, type SheetKind } from "@/lib/sports/cricket/sheets/types";
import { errorResponse, requireSuperAdmin, sessionUserId } from "@/lib/sports/cricket/http";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      mode?: unknown;
      rows?: unknown;
      fileName?: unknown;
      validationHash?: unknown;
      override?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
    if (!SHEET_KINDS.includes(body.kind as SheetKind)) {
      return NextResponse.json({ error: `kind must be one of ${SHEET_KINDS.join(", ")}` }, { status: 400 });
    }
    if (body.mode !== "validate" && body.mode !== "commit") {
      return NextResponse.json({ error: 'mode must be "validate" or "commit"' }, { status: 400 });
    }
    if (!Array.isArray(body.rows) || body.rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
      return NextResponse.json({ error: "rows must be an array of objects" }, { status: 400 });
    }
    const result = await runUpload(
      id,
      {
        kind: body.kind as SheetKind,
        mode: body.mode,
        rows: body.rows as Record<string, unknown>[],
        fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : null,
        validationHash: typeof body.validationHash === "string" ? body.validationHash : null,
        override: body.override === true,
      },
      await sessionUserId(request),
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "cricket upload");
  }
}
