/**
 * One-time sign-in handoff for the iOS home-screen app.
 *
 * A home-screen web app on iOS has its own cookie jar, separate from Safari's. Google sign-in
 * opens in a browser sheet, so the session cookie the callback sets can land in Safari's jar
 * instead of the app's. The handoff carries the sign-in back:
 *
 *   1. The app makes a random `verifier`, keeps it in memory, and POSTs SHA-256(verifier) to
 *      /api/auth/handoff/start. It gets a handoff id and a 4-character match code, and shows the code.
 *   2. The app opens /api/auth/google?handoff=<id> in a browser sheet. After Google, the callback
 *      sends that browser to /auth/handoff, which shows the same code and asks the person to
 *      confirm it matches what their app shows. Confirming records who signed in.
 *   3. The app polls /api/auth/handoff/claim with the verifier. Once confirmed, the server mints
 *      the session cookie in the app's own context and the handoff is spent.
 *
 * Nobody but the app can claim (they lack the verifier), every handoff dies after five minutes or
 * one use, and the explicit confirm step stops a sign-in being silently captured by someone else's
 * handoff link. Switched on with NEXT_PUBLIC_IOS_HANDOFF=1 — only if a real-device test shows the
 * plain redirect loses the cookie (docs/10-accounts-and-membership.md).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const HANDOFF_TTL_MS = 5 * 60 * 1000;

/** No 0/O, 1/I/L — the code is read off one screen and compared with another. */
const MATCH_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function isHandoffEnabled(): boolean {
  return process.env.NEXT_PUBLIC_IOS_HANDOFF === "1";
}

export function newHandoffId(): string {
  return randomBytes(24).toString("base64url");
}

export function newMatchCode(): string {
  const bytes = randomBytes(4);
  return Array.from(bytes, (b) => MATCH_ALPHABET[b % MATCH_ALPHABET.length]).join("");
}

/** base64url(SHA-256(verifier)) — what the app sends as its challenge. */
export function hashVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifierMatches(verifier: string, storedHash: string): boolean {
  const a = Buffer.from(hashVerifier(verifier));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const HANDOFF_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/; // base64url SHA-256, unpadded
