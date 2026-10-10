/**
 * Is this request coming from an app's built-in browser?
 *
 * Google refuses OAuth inside embedded webviews (error `disallowed_useragent`), and invite links
 * are mostly shared in WhatsApp, so a join link tapped there would dead-end at Google. /signin and
 * /join use this to show an "Open in Chrome / Safari" screen instead of the Google button, and
 * /api/auth/google refuses to start from one.
 *
 * Deliberately NOT flagged: Chrome Custom Tabs and SFSafariViewController. Google allows both,
 * and their user agents are those of real Chrome / Safari.
 */

export type InAppApp =
  | "whatsapp"
  | "instagram"
  | "facebook"
  | "messenger"
  | "line"
  | "snapchat"
  | "linkedin"
  | "webview"; // a webview we can't name

export interface InAppBrowserInfo {
  inApp: boolean;
  app: InAppApp | null;
  platform: "android" | "ios" | "other";
}

// Order matters: Messenger's UA also carries the Facebook tokens.
const NAMED_APPS: Array<[InAppApp, RegExp]> = [
  ["whatsapp", /WhatsApp/i],
  ["instagram", /Instagram/i],
  // iOS says FBAN/MessengerForiOS; Android uses Messenger's codename, Orca.
  ["messenger", /\bMessenger\b|FBAN\/Messenger|FB_IAB\/MESSENGER|Orca-Android/i],
  ["facebook", /FBAN|FBAV|FB_IAB|FBIOS|\[FB/i],
  ["line", /\bLine\//i],
  ["snapchat", /Snapchat/i],
  ["linkedin", /LinkedInApp/i],
];

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowserInfo {
  const ua = userAgent ?? "";
  const platform = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) ? "ios" : "other";

  for (const [app, re] of NAMED_APPS) {
    if (re.test(ua)) return { inApp: true, app, platform };
  }

  // Android System WebView marks itself with "; wv)". Custom Tabs run in Chrome itself and don't.
  if (platform === "android" && /;\s*wv\)/i.test(ua)) return { inApp: true, app: "webview", platform };

  // iOS WKWebView: WebKit and "Mobile/", but no "Safari/" token. Real Safari and
  // SFSafariViewController include "Safari/"; Chrome, Firefox and Edge on iOS say CriOS / FxiOS / EdgiOS.
  if (
    platform === "ios" &&
    /AppleWebKit/i.test(ua) &&
    /Mobile\//i.test(ua) &&
    !/Safari\//i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS/i.test(ua)
  ) {
    return { inApp: true, app: "webview", platform };
  }

  return { inApp: false, app: null, platform };
}

/** Human name for the interstitial copy: "You opened this in WhatsApp". */
export function inAppAppName(app: InAppApp | null): string {
  switch (app) {
    case "whatsapp": return "WhatsApp";
    case "instagram": return "Instagram";
    case "facebook": return "Facebook";
    case "messenger": return "Messenger";
    case "line": return "LINE";
    case "snapchat": return "Snapchat";
    case "linkedin": return "LinkedIn";
    default: return "an app";
  }
}

/**
 * Link that asks Android to open `url` in Chrome, falling back to `url` itself (any browser) if
 * Chrome isn't installed.
 */
export function androidChromeIntent(url: string): string {
  const u = new URL(url);
  return (
    `intent://${u.host}${u.pathname}${u.search}${u.hash}` +
    `#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`
  );
}

/** Link that asks iOS to open `url` in Safari (iOS 17+); older versions ignore it, so pair it with instructions. */
export function iosSafariLink(url: string): string {
  return url.replace(/^https:/, "x-safari-https:").replace(/^http:/, "x-safari-http:");
}
