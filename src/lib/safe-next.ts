/**
 * Where to send someone after sign-in. Sign-in links carry `?next=/join/abc` so the invite flow
 * survives the round trip to Google — and an unchecked `next` is an open redirect: a phishing
 * link could bounce a freshly signed-in user to an attacker's lookalike page. Only same-origin
 * relative paths survive.
 */
export function sanitizeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || typeof next !== "string") return fallback;
  // One leading slash, not two ("//evil.com" is protocol-relative) and not "/\" (some browsers
  // treat a backslash as a slash there).
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  try {
    // Resolve against a dummy origin: anything that escapes it was never relative.
    const url = new URL(next, "https://same.origin");
    if (url.origin !== "https://same.origin") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
