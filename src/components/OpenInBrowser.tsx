"use client";

import { useState } from "react";
import Link from "next/link";
import { androidChromeIntent, iosSafariLink, inAppAppName, type InAppBrowserInfo } from "@/lib/in-app-browser";

/**
 * Shown instead of "Continue with Google" when the page was opened inside an app's built-in
 * browser (WhatsApp, Instagram, …), where Google refuses to sign anyone in. Offers the one-tap
 * escape for the platform, plus copy-link as the fallback that always works. The link keeps
 * everything in the URL — invite token included — so the flow resumes where it left off.
 */
export function OpenInBrowser({ info, url }: { info: InAppBrowserInfo; url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older webviews: select a hidden field and copy the old way.
      const field = document.createElement("textarea");
      field.value = url;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
  };

  const browser = info.platform === "ios" ? "Safari" : "Chrome";

  return (
    <section aria-labelledby="open-in-browser" className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-5 sm:p-6">
      <h2 id="open-in-browser" className="text-base sm:text-lg font-semibold text-white">
        Open this page in {browser} to sign in
      </h2>
      <p className="mt-2 text-sm text-gray-300">
        You opened it inside {inAppAppName(info.app)}, and Google doesn&apos;t allow signing in from an app&apos;s built-in browser.
      </p>

      <div className="mt-4 space-y-2">
        {info.platform === "android" && (
          <a href={androidChromeIntent(url)} className="block w-full rounded-lg bg-white px-6 py-3 text-center text-sm font-semibold text-slate-800 hover:bg-gray-100">
            Open in Chrome
          </a>
        )}
        {info.platform === "ios" && (
          <a href={iosSafariLink(url)} className="block w-full rounded-lg bg-white px-6 py-3 text-center text-sm font-semibold text-slate-800 hover:bg-gray-100">
            Open in Safari
          </a>
        )}
        <button
          type="button"
          onClick={copy}
          className="block w-full rounded-lg border border-white/20 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-white/10"
        >
          {copied ? "Link copied — paste it into your browser" : "Copy link"}
        </button>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        {info.platform === "ios"
          ? "If the button doesn't work: tap the ⋯ or share menu, then “Open in Safari”."
          : "If the button doesn't work: tap the ⋮ menu, then “Open in browser” or “Open in Chrome”."}{" "}
        <Link href="/help#in-app-browser" className="underline hover:text-white">More help</Link>
      </p>
    </section>
  );
}
