import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getRequestPerson, mintPersonSession } from "@/lib/accounts";
import { setSignedInSession } from "@/lib/session-cookies";

export const dynamic = "force-dynamic";

/**
 * POST /api/me/sessions — "Sign out of all other devices".
 *
 * Bumps users.session_version, which invalidates every token minted before it on its next
 * request (team routes, privileged checks, /api/auth/me and every league page all compare it).
 * This device carries on under a fresh token at the new version.
 */
export async function POST(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);

  const response = NextResponse.json({ success: true });
  await setSignedInSession(request, response, await mintPersonSession(fresh));
  return response;
}
