/**
 * Re-checks an admin or superadmin session against the database.
 *
 * A session token carries its role (`type`) for up to seven days. On its own that means a
 * demoted admin keeps admin access until the token expires. So privileged checks also confirm,
 * on every request, that the users row still exists, still holds the role, and still has the
 * session version the token was minted with (bumped by demotion, "sign out of all devices",
 * account deletion or replacement — see users.session_version).
 *
 * Reads the identity middleware forwards (`x-session-id`, `x-session-type`, `x-session-sv`).
 * Those headers can be trusted on non-public routes: middleware overwrites anything the client
 * sent. Synthetic in-process identities — the auto-processing orchestrator and the cron route,
 * which call handlers directly without a cookie — have no users row and pass unchanged.
 */

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";

/** Identities set by server code itself, never minted into a token. */
export const SYNTHETIC_SESSION_IDS = new Set(["cron", "superadmin-orchestrator"]);

export interface PrivilegedIdentity {
  id: string;
  type: "admin" | "superadmin";
  /** Session version from the token; 0 when absent. */
  sv: number;
}

/** The admin/superadmin identity middleware forwarded, or null. Does not touch the database. */
export function forwardedPrivilegedIdentity(request: NextRequest): PrivilegedIdentity | null {
  const id = request.headers.get("x-session-id");
  const type = request.headers.get("x-session-type");
  if (!id || (type !== "admin" && type !== "superadmin")) return null;
  const sv = Number(request.headers.get("x-session-sv") ?? "0");
  return { id, type, sv: Number.isFinite(sv) ? sv : 0 };
}

/**
 * True if the identity still holds `required` in the database (a superadmin also satisfies
 * "admin"), and its session hasn't been revoked.
 */
export async function privilegeStillHeld(identity: PrivilegedIdentity, required: "admin" | "superadmin"): Promise<boolean> {
  if (required === "superadmin" && identity.type !== "superadmin") return false;
  if (SYNTHETIC_SESSION_IDS.has(identity.id)) return true;
  const [row] = await db
    .select({ role: users.role, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, identity.id))
    .limit(1);
  if (!row || row.sessionVersion !== identity.sv) return false;
  return required === "superadmin" ? row.role === "superadmin" : row.role === "admin" || row.role === "superadmin";
}

/**
 * True for a superadmin session that is STILL a superadmin in the database, with an unrevoked
 * session. Async because of that check — always `await` it.
 */
export async function isSuperAdmin(request: NextRequest): Promise<boolean> {
  const identity = forwardedPrivilegedIdentity(request);
  return !!identity && (await privilegeStillHeld(identity, "superadmin"));
}
