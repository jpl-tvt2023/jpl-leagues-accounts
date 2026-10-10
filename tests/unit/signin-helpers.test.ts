/**
 * Pure sign-in helpers: in-app browser detection (src/lib/in-app-browser.ts), username rules
 * (src/lib/username.ts) and the post-sign-in redirect guard (src/lib/safe-next.ts).
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { androidChromeIntent, detectInAppBrowser, iosSafariLink } from "../../src/lib/in-app-browser";
import { normalizeUsername, usernameProblem } from "../../src/lib/username";
import { sanitizeNext } from "../../src/lib/safe-next";

// Real user agents, trimmed only where noted.
const UA = {
  whatsappAndroid: "Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 WhatsApp/2.23.24.82",
  instagramIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 307.0.0.34.111 (iPhone14,5; iOS 17_1; en_US; en; scale=3.00; 1170x2532; 532277488)",
  instagramAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.6167.143 Mobile Safari/537.36 Instagram 317.0.0.34.109 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 563459864)",
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/447.0.0.40.108;FBBV/556017224;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.2;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  messengerIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/430.0.0.31.112;FBBV/523339917;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/0]",
  messengerAndroid: "Mozilla/5.0 (Linux; Android 12; SM-A525F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.111 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/431.0.0.20.109;]",
  snapchatIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.70.0.37 (like Safari/8617.2.4.10.8, panda)",
  linkedinIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6512",
  lineAndroid: "Mozilla/5.0 (Linux; Android 13; SO-51C Build/61.2.D.0.233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.66 Mobile Safari/537.36 Line/13.21.0",
  genericAndroidWebview: "Mozilla/5.0 (Linux; Android 11; RMX2001 Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.43 Mobile Safari/537.36",
  genericIosWebview: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  // Allowed by Google, must NOT be flagged:
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  safariIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  firefoxIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

test("named in-app browsers are detected, with the right platform", () => {
  const cases: Array<[string, string, string]> = [
    [UA.whatsappAndroid, "whatsapp", "android"],
    [UA.instagramIos, "instagram", "ios"],
    [UA.instagramAndroid, "instagram", "android"],
    [UA.facebookIos, "facebook", "ios"],
    [UA.messengerIos, "messenger", "ios"],
    [UA.messengerAndroid, "messenger", "android"],
    [UA.snapchatIos, "snapchat", "ios"],
    [UA.linkedinIos, "linkedin", "ios"],
    [UA.lineAndroid, "line", "android"],
  ];
  for (const [ua, app, platform] of cases) {
    assert.deepEqual(detectInAppBrowser(ua), { inApp: true, app, platform }, ua);
  }
});

test("unnamed webviews are caught by their structural markers", () => {
  assert.deepEqual(detectInAppBrowser(UA.genericAndroidWebview), { inApp: true, app: "webview", platform: "android" });
  assert.deepEqual(detectInAppBrowser(UA.genericIosWebview), { inApp: true, app: "webview", platform: "ios" });
});

test("real browsers, Custom Tabs and SFSafariViewController are not flagged", () => {
  for (const ua of [UA.chromeAndroid, UA.safariIos, UA.chromeIos, UA.firefoxIos, UA.desktopChrome]) {
    assert.equal(detectInAppBrowser(ua).inApp, false, ua);
  }
  assert.equal(detectInAppBrowser(null).inApp, false);
  assert.equal(detectInAppBrowser("").inApp, false);
});

test("escape-hatch links keep the full URL, invite token included", () => {
  const url = "https://jpl.example.com/join/AbC123?x=1";
  assert.equal(
    androidChromeIntent(url),
    "intent://jpl.example.com/join/AbC123?x=1#Intent;scheme=https;package=com.android.chrome;" +
      `S.browser_fallback_url=${encodeURIComponent(url)};end`,
  );
  assert.equal(iosSafariLink(url), "x-safari-https://jpl.example.com/join/AbC123?x=1");
});

test("usernames normalize to lowercase without a leading @", () => {
  assert.equal(normalizeUsername("  @Rahul_7 "), "rahul_7");
});

test("username rules", () => {
  assert.equal(usernameProblem("rahul_7"), null);
  assert.equal(usernameProblem("abc"), null);
  assert.equal(usernameProblem("a".repeat(20)), null);
  assert.match(usernameProblem("ab")!, /at least 3/);
  assert.match(usernameProblem("a".repeat(21))!, /at most 20/);
  assert.match(usernameProblem("rahul-7")!, /lowercase letters, numbers and underscores/);
  assert.match(usernameProblem("rahul 7")!, /lowercase letters/);
  assert.match(usernameProblem("_rahul")!, /underscore/);
  assert.match(usernameProblem("rahul_")!, /underscore/);
  assert.match(usernameProblem("12345")!, /at least one letter/);
  assert.match(usernameProblem("admin")!, /reserved/);
  assert.match(usernameProblem("superadmin")!, /reserved/);
  assert.match(usernameProblem("join")!, /reserved/);
});

test("sanitizeNext keeps same-origin paths", () => {
  assert.equal(sanitizeNext("/join/AbC123"), "/join/AbC123");
  assert.equal(sanitizeNext("/tvt-fpl/dashboard?gw=3#captains"), "/tvt-fpl/dashboard?gw=3#captains");
  assert.equal(sanitizeNext("/"), "/");
});

test("sanitizeNext refuses anything that leaves the site", () => {
  for (const bad of [
    "//evil.com", "//evil.com/join", "/\\evil.com", "https://evil.com", "http://evil.com/x",
    "javascript:alert(1)", "evil.com", "join/abc", "/\tevil", "\n/join",
  ]) {
    assert.equal(sanitizeNext(bad), "/", bad);
  }
  assert.equal(sanitizeNext(null), "/");
  assert.equal(sanitizeNext(undefined, "/onboarding"), "/onboarding");
});
