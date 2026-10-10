/**
 * Google sign-in plumbing: OAuth 2.0 authorization code flow with PKCE, via `arctic`.
 *
 * Wired into the existing HMAC session rather than a full auth library — see decision 15 in
 * docs/08-engineering-decisions.md. Only the `openid email profile` scopes are requested, so no
 * Google API access token is ever used or stored: the ID token from the code exchange is read
 * once for the person's identity and discarded.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and AUTH_ORIGIN (e.g. https://jpl-leagues-accounts.vercel.app).
 * Google only accepts redirect URIs registered exactly, so AUTH_ORIGIN must match the deployment;
 * without it the request's own origin is used, which suits local development.
 */

import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";

export { generateCodeVerifier, generateState };

export const GOOGLE_SCOPES = ["openid", "email", "profile"];

/** Short-lived cookies that carry the flow across the round trip to Google. */
export const OAUTH_COOKIES = {
  state: "g_oauth_state",
  verifier: "g_oauth_verifier",
  next: "g_oauth_next",
  handoff: "g_oauth_handoff",
} as const;

export const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax is what lets the cookies ride along on Google's top-level redirect back to the callback.
  sameSite: "lax" as const,
  path: "/api/auth/google",
  maxAge: 10 * 60,
};

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function authOrigin(requestUrl: string): string {
  return (process.env.AUTH_ORIGIN || new URL(requestUrl).origin).replace(/\/+$/, "");
}

export function googleClient(requestUrl: string): Google {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return new Google(clientId, clientSecret, `${authOrigin(requestUrl)}/api/auth/google/callback`);
}

export interface GoogleProfile {
  /** Google's stable account id. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

/**
 * The person behind an ID token. The token came straight from Google's token endpoint over TLS
 * in exchange for our code + verifier, so (per OIDC Core §3.1.3.7) its signature need not be
 * re-verified here; the claims still are.
 */
export function profileFromIdToken(idToken: string): GoogleProfile | null {
  const claims = decodeIdToken(idToken) as Record<string, unknown>;
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  if (!sub || !email) return null;
  const aud = claims.aud;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (clientId && aud !== clientId && !(Array.isArray(aud) && aud.includes(clientId))) return null;
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
  const name =
    (typeof claims.name === "string" && claims.name.trim()) ||
    [claims.given_name, claims.family_name].filter((p) => typeof p === "string" && p).join(" ") ||
    email.split("@")[0];
  return {
    sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}
