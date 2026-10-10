import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { generateId } from "@/lib/id";
import { mintPersonSession, publicProfile } from "@/lib/accounts";
import { setSignedInSession } from "@/lib/session-cookies";
import { normalizeUsername } from "@/lib/username";

export const dynamic = "force-dynamic";

/**
 * POST /api/test-auth/signin { email, username?, name?, role? } — TEST ONLY.
 *
 * Signs in as a person without Google, for the e2e suite and for Vercel preview deployments
 * (whose URLs can't be registered as Google redirect URIs). Creates the account on first use.
 *
 * 404 unless TEST_AUTH_ENABLED=1, and always 404 on a Vercel production deployment — the same
 * belt-and-braces gating as the FPL stub (api/test-fpl-stub). Never set the flag in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.TEST_AUTH_ENABLED !== "1" || process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { email?: unknown; username?: unknown; name?: unknown; role?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return NextResponse.json({ error: "email is required" }, { status: 400 });
  const role = body.role === "admin" || body.role === "superadmin" ? body.role : "user";
  const username = typeof body.username === "string" && body.username ? normalizeUsername(body.username) : null;

  let [user] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${email}`).limit(1);
  if (!user) {
    const id = generateId();
    await db.insert(users).values({
      id,
      email,
      password: "",
      name: typeof body.name === "string" && body.name ? body.name : email.split("@")[0],
      role,
      mustChangePassword: false,
      username,
    });
    [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  }

  const response = NextResponse.json({ user: publicProfile(user) });
  await setSignedInSession(request, response, await mintPersonSession(user));
  return response;
}
