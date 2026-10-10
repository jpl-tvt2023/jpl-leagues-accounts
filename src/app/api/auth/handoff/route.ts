import { NextResponse, type NextRequest } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { authHandoffs, db, users } from "@/lib/db";
import {
  CHALLENGE_RE,
  HANDOFF_ID_RE,
  HANDOFF_TTL_MS,
  isHandoffEnabled,
  newHandoffId,
  newMatchCode,
  verifierMatches,
} from "@/lib/auth-handoff";
import { getRequestPerson, mintPersonSession, postSignInPath } from "@/lib/accounts";
import { setSignedInSession } from "@/lib/session-cookies";
import { sanitizeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/handoff — the iOS home-screen sign-in handoff (lib/auth-handoff.ts).
 *
 *   { action: "start", challenge }            app      → { handoffId, matchCode }
 *   { action: "confirm", handoffId }          browser  → records who signed in (needs its session)
 *   { action: "claim", handoffId, verifier, next? }
 *                                             app      → 202 pending | 200 signed in | 410 gone
 */
export async function POST(request: NextRequest) {
  if (!isHandoffEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const now = new Date();

  if (body.action === "start") {
    if (typeof body.challenge !== "string" || !CHALLENGE_RE.test(body.challenge)) {
      return NextResponse.json({ error: "challenge must be base64url SHA-256" }, { status: 400 });
    }
    // Housekeeping: handoffs live five minutes.
    await db.delete(authHandoffs).where(lt(authHandoffs.expiresAt, now));
    const handoffId = newHandoffId();
    const matchCode = newMatchCode();
    await db.insert(authHandoffs).values({
      id: handoffId,
      verifierHash: body.challenge,
      matchCode,
      expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
    });
    return NextResponse.json({ handoffId, matchCode });
  }

  const handoffId = typeof body.handoffId === "string" && HANDOFF_ID_RE.test(body.handoffId) ? body.handoffId : null;
  if (!handoffId) return NextResponse.json({ error: "handoffId is required" }, { status: 400 });
  const [handoff] = await db.select().from(authHandoffs).where(eq(authHandoffs.id, handoffId)).limit(1);
  if (!handoff || handoff.expiresAt < now || handoff.status === "claimed") {
    return NextResponse.json({ error: "This sign-in link has expired. Start again from the app." }, { status: 410 });
  }

  if (body.action === "confirm") {
    const person = await getRequestPerson(request);
    if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (handoff.status !== "pending") return NextResponse.json({ error: "Already confirmed." }, { status: 409 });
    await db
      .update(authHandoffs)
      .set({ status: "confirmed", userId: person.id })
      .where(and(eq(authHandoffs.id, handoffId), eq(authHandoffs.status, "pending")));
    return NextResponse.json({ success: true });
  }

  if (body.action === "claim") {
    if (typeof body.verifier !== "string" || !verifierMatches(body.verifier, handoff.verifierHash)) {
      return NextResponse.json({ error: "Not your sign-in." }, { status: 403 });
    }
    if (handoff.status === "pending" || !handoff.userId) return NextResponse.json({ status: "pending" }, { status: 202 });

    // Spend it first: of two racing claims, only the one that flips the row wins.
    const spent = await db
      .update(authHandoffs)
      .set({ status: "claimed" })
      .where(and(eq(authHandoffs.id, handoffId), eq(authHandoffs.status, "confirmed")))
      .returning({ id: authHandoffs.id });
    if (spent.length === 0) return NextResponse.json({ error: "Already used." }, { status: 410 });

    const [user] = await db.select().from(users).where(eq(users.id, handoff.userId)).limit(1);
    if (!user) return NextResponse.json({ error: "Account not found." }, { status: 410 });
    const response = NextResponse.json({ redirectTo: postSignInPath(user, sanitizeNext(typeof body.next === "string" ? body.next : null)) });
    await setSignedInSession(request, response, await mintPersonSession(user));
    return response;
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
