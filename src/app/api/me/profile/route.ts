import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getRequestPerson, publicProfile } from "@/lib/accounts";
import { normalizeUsername, usernameProblem } from "@/lib/username";
import { lookUpFplEntry } from "@/lib/sports/fpl/user-teams";
import { jsonNoStore } from "@/lib/http/no-store";

export const dynamic = "force-dynamic";

const MAX_NAME = 60;

async function usernameTaken(username: string, exceptUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), ne(users.id, exceptUserId)))
    .limit(1);
  return !!row;
}

/**
 * GET /api/me/profile                      → the signed-in person's profile
 * GET /api/me/profile?checkUsername=alice  → { available, problem } for onboarding's live check
 * GET /api/me/profile?checkFplEntry=123    → { found, teamName, managerName } preview (before saving
 *                                            an FPL team with POST /api/me/fpl-teams)
 */
export async function GET(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const check = request.nextUrl.searchParams.get("checkUsername");
  if (check !== null) {
    const username = normalizeUsername(check);
    const problem = usernameProblem(username);
    if (problem) return jsonNoStore({ username, available: false, problem });
    const taken = await usernameTaken(username, user.id);
    return jsonNoStore({ username, available: !taken, problem: taken ? "That username is taken." : null });
  }

  const fplCheck = request.nextUrl.searchParams.get("checkFplEntry");
  if (fplCheck !== null) {
    if (!/^\d{1,10}$/.test(fplCheck)) return jsonNoStore({ found: false, problem: "FPL IDs are numbers." });
    const entry = await lookUpFplEntry(fplCheck);
    if (entry === null) return jsonNoStore({ found: false, problem: "No FPL team has that ID." });
    return jsonNoStore({ found: entry !== undefined, ...entry, problem: entry === undefined ? "Couldn't reach FPL to check it — you can still save it." : null });
  }

  return jsonNoStore({ user: publicProfile(user) });
}

/**
 * PATCH /api/me/profile { username?, name? }
 * Onboarding sets the username; /account edits either. Omitted fields are untouched. FPL teams
 * have their own list: /api/me/fpl-teams.
 */
export async function PATCH(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { username?: unknown; name?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const patch: Partial<typeof users.$inferInsert> = {};

  if (body.username !== undefined) {
    if (typeof body.username !== "string") return NextResponse.json({ error: "username must be a string" }, { status: 400 });
    const username = normalizeUsername(body.username);
    const problem = usernameProblem(username);
    if (problem) return NextResponse.json({ error: problem, field: "username" }, { status: 400 });
    if (username !== user.username) {
      if (await usernameTaken(username, user.id)) {
        return NextResponse.json({ error: "That username is taken.", field: "username" }, { status: 409 });
      }
      patch.username = username;
    }
  }

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > MAX_NAME) {
      return NextResponse.json({ error: `Name must be 1–${MAX_NAME} characters.`, field: "name" }, { status: 400 });
    }
    patch.name = name;
  }

  if (Object.keys(patch).length > 0) {
    try {
      await db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, user.id));
    } catch (err) {
      // Lost a race for the same username between the check and the write.
      if (/UNIQUE constraint failed: users\.username|users_username_unique/i.test(String((err as { cause?: unknown })?.cause ?? err))) {
        return NextResponse.json({ error: "That username is taken.", field: "username" }, { status: 409 });
      }
      throw err;
    }
  }

  return jsonNoStore({ user: publicProfile({ ...user, ...patch } as typeof user) });
}
