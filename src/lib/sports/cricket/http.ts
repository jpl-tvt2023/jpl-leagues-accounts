/** Small helpers shared by the cricket API routes. */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { isSuperAdmin } from "@/lib/privilege";

/** 403 unless the request is from a superadmin who still holds the role; null when allowed. */
export async function requireSuperAdmin(request: NextRequest): Promise<NextResponse | null> {
  if (await isSuperAdmin(request)) return null;
  return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
}

/** The signed-in person's user id from the forwarded session, if it is a real users row. */
export async function sessionUserId(request: NextRequest): Promise<string | null> {
  const id = request.headers.get("x-session-id");
  if (!id) return null;
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return row?.id ?? null;
}

/** Errors that carry their own HTTP status become that response; anything else is a logged 500. */
export function errorResponse(err: unknown, context: string): NextResponse {
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === "number") {
    const result = (err as { result?: unknown }).result;
    return NextResponse.json({ error: err.message, ...(result ? { result } : {}) }, { status });
  }
  console.error(`${context}:`, err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
