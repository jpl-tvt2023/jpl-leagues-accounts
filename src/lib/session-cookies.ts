import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { ACCOUNTS_COOKIE_NAME, ACCOUNTS_COOKIE_OPTIONS, encodeAccounts, upsertAccount } from "@/lib/auth-accounts";

/**
 * Make `token` the active session on this device.
 *
 * Signing in adds the account to the device's signed-in accounts instead of replacing the
 * previous one, so the account switcher can go back to it without signing in again — that is how
 * one browser moves between a Google identity and any legacy team logins this season. A session
 * from before the accounts cookie existed is folded in first, so it isn't lost on the upgrade.
 *
 * Shared by password sign-in, Google sign-in and the iOS handoff, so they cannot drift apart.
 */
export async function setSignedInSession(request: NextRequest, response: NextResponse, token: string): Promise<void> {
  let raw = request.cookies.get(ACCOUNTS_COOKIE_NAME)?.value;
  const previous = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (previous) raw = encodeAccounts(await upsertAccount(raw, previous));
  response.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
  response.cookies.set(ACCOUNTS_COOKIE_NAME, encodeAccounts(await upsertAccount(raw, token)), ACCOUNTS_COOKIE_OPTIONS);
}
