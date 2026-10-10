import { NextResponse, type NextRequest } from "next/server";
import {
  GOOGLE_SCOPES,
  OAUTH_COOKIES,
  OAUTH_COOKIE_OPTIONS,
  generateCodeVerifier,
  generateState,
  googleClient,
  isGoogleConfigured,
} from "@/lib/google-oauth";
import { detectInAppBrowser } from "@/lib/in-app-browser";
import { sanitizeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google?next=/join/abc[&handoff=<id>] — start Google sign-in.
 *
 * Stores state (CSRF), the PKCE verifier and the sanitized `next` in short-lived httpOnly cookies
 * scoped to /api/auth/google, then redirects to Google. In-app browsers are turned back to
 * /signin, which explains how to open the page in a real browser: Google would refuse them with
 * `disallowed_useragent` anyway, and that page is a dead end.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = sanitizeNext(params.get("next"));

  if (detectInAppBrowser(request.headers.get("user-agent")).inApp) {
    return NextResponse.redirect(new URL(`/signin?inapp=1&next=${encodeURIComponent(next)}`, request.url));
  }
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL(`/signin?error=google_unavailable&next=${encodeURIComponent(next)}`, request.url));
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient(request.url).createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES);
  // Let people pick which Google account, instead of silently reusing the one signed in.
  url.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIES.state, state, OAUTH_COOKIE_OPTIONS);
  response.cookies.set(OAUTH_COOKIES.verifier, codeVerifier, OAUTH_COOKIE_OPTIONS);
  response.cookies.set(OAUTH_COOKIES.next, next, OAUTH_COOKIE_OPTIONS);
  const handoff = params.get("handoff");
  if (handoff && /^[A-Za-z0-9_-]{16,64}$/.test(handoff)) {
    response.cookies.set(OAUTH_COOKIES.handoff, handoff, OAUTH_COOKIE_OPTIONS);
  } else {
    response.cookies.set(OAUTH_COOKIES.handoff, "", { ...OAUTH_COOKIE_OPTIONS, maxAge: 0 });
  }
  return response;
}
