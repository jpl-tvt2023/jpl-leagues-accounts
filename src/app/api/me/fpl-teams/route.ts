import { NextResponse, type NextRequest } from "next/server";
import { getRequestPerson } from "@/lib/accounts";
import { jsonNoStore } from "@/lib/http/no-store";
import { FplTeamError, addFplTeam, listFplTeams, removeFplTeam, setPrimaryFplTeam } from "@/lib/fpl-teams";

export const dynamic = "force-dynamic";

/**
 * GET    /api/me/fpl-teams                    → { fplTeams } the person's saved FPL teams
 * POST   /api/me/fpl-teams { fplEntryId }     → { fplTeam } saves one (checked against FPL); the
 *                                              first one saved is the primary
 * PATCH  /api/me/fpl-teams { id }             → makes that one the primary (setup's default pick)
 * DELETE /api/me/fpl-teams { id }             → takes one off the list
 *
 * A person picks one of these for each league they join; see lib/fpl-teams.ts.
 */
export async function GET(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return jsonNoStore({ fplTeams: await listFplTeams(user.id) });
}

export async function POST(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role === "superadmin") return NextResponse.json({ error: "Superadmins don't play, so they have no FPL teams." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { fplEntryId?: unknown };
  try {
    return jsonNoStore({ fplTeam: await addFplTeam(user.id, body.fplEntryId) });
  } catch (err) {
    if (err instanceof FplTeamError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!(await setPrimaryFplTeam(user.id, body.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return jsonNoStore({ fplTeams: await listFplTeams(user.id) });
}

export async function DELETE(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!(await removeFplTeam(user.id, body.id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return jsonNoStore({ success: true });
}
