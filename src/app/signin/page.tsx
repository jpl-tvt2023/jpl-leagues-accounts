import { headers } from "next/headers";
import { detectInAppBrowser } from "@/lib/in-app-browser";
import { sanitizeNext } from "@/lib/safe-next";
import { SignInClient } from "./SignInClient";

/**
 * /signin. A server wrapper so the in-app-browser check (user agent) happens before anything
 * renders: inside WhatsApp or Instagram the Google button would only lead to Google's
 * `disallowed_useragent` error page, so those visitors get an "open in your browser" screen
 * instead.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const h = await headers();

  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const value = first(v);
    if (value !== null && k !== "inapp" && k !== "error") query.set(k, value);
  }

  return (
    <SignInClient
      inApp={detectInAppBrowser(h.get("user-agent"))}
      currentUrl={`${proto}://${host}/signin${query.size ? `?${query}` : ""}`}
      next={sanitizeNext(first(params.next))}
      error={first(params.error)}
    />
  );
}
