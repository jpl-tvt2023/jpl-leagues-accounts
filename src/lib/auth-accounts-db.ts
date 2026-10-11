import { inArray } from "drizzle-orm";
import { db, users } from "@/lib/db";
import type { StoredAccount } from "./auth-accounts";

/** What the account switcher shows for one signed-in account. Never includes the token. */
export interface AccountDescription {
  label: string;
  sublabel: string | null;
  loginId: string | null;
}

/**
 * Display rows for stored accounts, keyed by `StoredAccount.key`. An account whose user no longer
 * exists (deleted since sign-in) is absent from the map — callers treat that as signed out.
 *
 * One query regardless of how many accounts are stored (at most five).
 */
export async function describeAccounts(accounts: StoredAccount[]): Promise<Map<string, AccountDescription>> {
  const out = new Map<string, AccountDescription>();
  const userIds = accounts.map((a) => a.session.id);
  if (userIds.length === 0) return out;

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, username: users.username })
    .from(users)
    .where(inArray(users.id, userIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const a of accounts) {
    const u = byId.get(a.session.id);
    if (!u) continue;
    out.set(a.key, {
      label: u.name || u.email,
      sublabel:
        a.session.type === "superadmin" ? "Platform admin"
        : a.session.type === "admin" ? "League admin"
        : u.username ? `@${u.username}` : "Finish setting up your account",
      loginId: u.email,
    });
  }

  return out;
}
