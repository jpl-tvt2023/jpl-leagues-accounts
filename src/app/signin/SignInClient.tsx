"use client";

import { useState, useSyncExternalStore } from "react";
import { AppNav } from "@/components/AppNav";
import { AccountAvatar } from "@/components/AccountSwitcher";
import Link from "next/link";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { OpenInBrowser } from "@/components/OpenInBrowser";
import { HandoffSignIn } from "@/components/HandoffSignIn";
import { usePwa } from "@/components/pwa/PwaProvider";
import type { InAppBrowserInfo } from "@/lib/in-app-browser";
import { switchAccount, useDeviceAccounts } from "@/lib/accounts-client";

const noopSubscribe = () => () => {};
/** `/signin?add=1` — reached from "Add another account"; the current accounts stay signed in. */
const readIsAdding = () => new URLSearchParams(window.location.search).has("add");
/** iPhone, iPod, and iPadOS (which reports itself as a Mac with a touch screen). */
const readIsIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
/** Switched on only if a real-device test shows the plain redirect loses the cookie on iOS. */
const IOS_HANDOFF = process.env.NEXT_PUBLIC_IOS_HANDOFF === "1";

/** What /api/auth/google/callback reports back, as `?error=`. */
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "That sign-in took too long or was opened in another browser. Please try again.",
  google_failed: "Google sign-in didn't work. Please try again.",
  google_unverified: "Your Google account's email isn't verified yet. Verify it with Google, then try again.",
  google_unavailable: "Google sign-in isn't set up on this site yet.",
};

export interface SignInClientProps {
  /** Built-in app browser (WhatsApp, Instagram, …) — Google refuses those, so offer a way out. */
  inApp: InAppBrowserInfo;
  /** This page's full URL, for the open-in-browser links. */
  currentUrl: string;
  /** Where to land after Google sign-in (already sanitized). */
  next: string;
  error: string | null;
}

/** Everyone — players, admins and the superadmin — signs in with Google. */
export function SignInClient({ inApp, currentUrl, next, error }: SignInClientProps) {
  const [message, setMessage] = useState<string | null>(
    error ? GOOGLE_ERRORS[error] ?? "Sign-in didn't work. Please try again." : null,
  );

  const isAdding = useSyncExternalStore(noopSubscribe, readIsAdding, () => false);
  const { isStandalone } = usePwa();
  const isIos = useSyncExternalStore(noopSubscribe, readIsIos, () => false);
  // The iOS home-screen app keeps its own cookie jar — sign in through the one-time handoff there.
  const useHandoff = IOS_HANDOFF && isStandalone && isIos;
  // Accounts still signed in on this device — one tap to continue as any of them.
  const { accounts } = useDeviceAccounts();
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);

  const onContinue = async (key: string) => {
    setSwitchingKey(key);
    setMessage(null);
    const result = await switchAccount(key);
    if (result?.error) {
      setMessage(result.error);
      setSwitchingKey(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "signin" }} activeKey="" brandHref="/" brandLabel="JPL India" title="Sign in" />

      <div className="mx-auto max-w-md px-4 sm:px-6 py-10 sm:py-24">
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2 sm:mb-4">
            {isAdding ? "Add another account" : "Welcome Back"}
          </h1>
          <p className="text-sm sm:text-base text-gray-400">
            {isAdding
              ? "Your other accounts stay signed in on this device — switch between them from the menu."
              : "Sign in with your Google account."}
          </p>
        </div>

        {message && (
          <div role="alert" className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">
            {message}
          </div>
        )}

        {accounts && accounts.length > 0 && (
          <section aria-labelledby="signed-in-accounts" className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur">
            <h2 id="signed-in-accounts" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
              Signed in on this device
            </h2>
            <ul>
              {accounts.map((account) => (
                <li key={account.key}>
                  <button
                    type="button"
                    onClick={() => onContinue(account.key)}
                    disabled={switchingKey !== null}
                    aria-label={`Continue as ${account.label}`}
                    className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-white/5 active:bg-white/10 disabled:opacity-60"
                  >
                    <AccountAvatar account={account} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{account.label}</span>
                      {account.sublabel && <span className="block truncate text-xs text-gray-400">{account.sublabel}</span>}
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-yellow-400">
                      {switchingKey === account.key ? "Opening…" : "Continue"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="google-signin" className="mb-6">
          <h2 id="google-signin" className="sr-only">Sign in with Google</h2>
          {inApp.inApp ? (
            <OpenInBrowser info={inApp} url={currentUrl} />
          ) : useHandoff ? (
            <HandoffSignIn next={next} />
          ) : (
            <GoogleSignInButton next={next} />
          )}
        </section>

        <p className="mt-8 text-center text-sm text-gray-500">
          New here? Ask your league admin for an invite link.{" "}
          <Link href="/help" className="text-gray-400 underline hover:text-white">Help with signing in</Link>
        </p>
        <p className="mt-2 text-center text-xs text-gray-600">
          <Link href="/privacy" className="underline hover:text-gray-400">Privacy</Link>
        </p>
      </div>
    </div>
  );
}
