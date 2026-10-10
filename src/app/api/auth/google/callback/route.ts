import { NextResponse, type NextRequest } from "next/server";
import { OAuth2RequestError } from "arctic";
import { OAUTH_COOKIES, OAUTH_COOKIE_OPTIONS, googleClient, profileFromIdToken } from "@/lib/google-oauth";
import { findOrCreateGoogleUser, mintPersonSession, postSignInPath } from "@/lib/accounts";
import { setSignedInSession } from "@/lib/session-cookies";
import { sanitizeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback — Google sends the person back here with `code` and `state`.
 *
 * Checks state against the cookie, exchanges the code (with the PKCE verifier) for an ID token,
 * then finds, links or creates the person (lib/accounts.ts) and signs them in. Any failure lands
 * on /signin with a short error code instead of a stack trace.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = sanitizeNext(request.cookies.get(OAUTH_COOKIES.next)?.value);
  const handoff = request.cookies.get(OAUTH_COOKIES.handoff)?.value || null;

  const fail = (code: string) => {
    const response = NextResponse.redirect(new URL(`/signin?error=${code}&next=${encodeURIComponent(next)}`, request.url));
    clearFlowCookies(response);
    return response;
  };

  // The person pressed Cancel on Google's screen.
  if (params.get("error")) return fail("google_cancelled");

  const code = params.get("code");
  const state = params.get("state");
  const storedState = request.cookies.get(OAUTH_COOKIES.state)?.value;
  const verifier = request.cookies.get(OAUTH_COOKIES.verifier)?.value;
  if (!code || !state || !storedState || !verifier || state !== storedState) return fail("google_expired");

  let profile;
  try {
    const tokens = await googleClient(request.url).validateAuthorizationCode(code, verifier);
    profile = profileFromIdToken(tokens.idToken());
  } catch (err) {
    console.error("[google callback] code exchange failed", err instanceof OAuth2RequestError ? err.code : err);
    return fail("google_failed");
  }
  if (!profile) return fail("google_failed");
  if (!profile.emailVerified) return fail("google_unverified");

  let user;
  try {
    ({ user } = await findOrCreateGoogleUser(profile));
  } catch (err) {
    console.error("[google callback] account lookup failed", err);
    return fail("google_failed");
  }

  // iOS home-screen handoff: this browser asks the person to confirm the code their app shows.
  const destination = handoff
    ? `/auth/handoff?h=${encodeURIComponent(handoff)}`
    : postSignInPath(user, next);

  const response = NextResponse.redirect(new URL(destination, request.url));
  await setSignedInSession(request, response, await mintPersonSession(user));
  clearFlowCookies(response);
  return response;
}

function clearFlowCookies(response: NextResponse) {
  for (const name of Object.values(OAUTH_COOKIES)) {
    response.cookies.set(name, "", { ...OAUTH_COOKIE_OPTIONS, maxAge: 0 });
  }
}
