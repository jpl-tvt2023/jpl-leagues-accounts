"use client";

import { useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { OpenInBrowser } from "@/components/OpenInBrowser";
import type { InAppBrowserInfo } from "@/lib/in-app-browser";

export interface JoinCard {
  leagueName: string;
  leagueSlug: string;
  leagueId: string;
  season: string;
  formatLabel: string;
  badgeClass: string;
  /** Teammate invites: the team you'd join. */
  teamName: string | null;
  openSlots: number;
  requiresApproval: boolean;
}

export type JoinState =
  | { kind: "invalid"; message: string; card?: JoinCard }
  | { kind: "in-app"; card: JoinCard; inApp: InAppBrowserInfo }
  | { kind: "signed-out"; card: JoinCard }
  | { kind: "needs-username"; card: JoinCard }
  | { kind: "member"; card: JoinCard; href: string }
  | { kind: "pending"; card: JoinCard }
  | { kind: "ready"; card: JoinCard };

const PRIMARY =
  "block w-full rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 px-6 py-3 text-center text-sm sm:text-base font-semibold text-slate-900 transition hover:from-yellow-300 hover:to-orange-400 disabled:opacity-50";
const SECONDARY = "block w-full rounded-lg border border-white/20 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50";

export function JoinClient({ token, state, selfPath, selfUrl }: { token: string; state: JoinState; selfPath: string; selfUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNow, setPendingNow] = useState(false);

  const join = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (res?.ok && body?.status === "pending") {
      setPendingNow(true);
      setBusy(false);
    } else if (res?.ok && body?.redirectTo) {
      window.location.href = body.redirectTo;
    } else {
      setError(body?.error ?? "Couldn't join. Please try again.");
      setBusy(false);
    }
  };

  const cancel = async (leagueId: string) => {
    setBusy(true);
    await fetch("/api/join", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leagueId }) }).catch(() => null);
    window.location.reload();
  };

  const card = "card" in state ? state.card : undefined;
  const kind = pendingNow ? "pending" : state.kind;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "signin" }} activeKey="" brandHref="/" brandLabel="JPL India" title="Join a league" />
      <main className="mx-auto max-w-md px-4 sm:px-6 py-10 sm:py-16">
        {card && (
          <section aria-labelledby="join-league" className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 text-center backdrop-blur">
            <p className="text-xs uppercase tracking-widest text-gray-400">{card.teamName ? "You're invited to join a team" : "You're invited to join"}</p>
            <h1 id="join-league" className="mt-2 text-2xl sm:text-3xl font-bold text-white">{card.teamName ?? card.leagueName}</h1>
            {card.teamName && <p className="mt-1 text-sm text-gray-300">in {card.leagueName}</p>}
            <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className={`rounded-full px-2.5 py-1 font-semibold ${card.badgeClass}`}>{card.formatLabel}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-gray-300">{card.season}</span>
              {!card.teamName && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-gray-300">
                  {card.openSlots === 1 ? "1 team left" : `${card.openSlots} teams left`}
                </span>
              )}
            </p>
            {card.requiresApproval && !card.teamName && <p className="mt-3 text-xs text-gray-400">The league admin approves each new player.</p>}
          </section>
        )}

        <div className="space-y-3">
          {kind === "invalid" && "message" in state && (
            <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-center text-red-300">{state.message}</div>
          )}

          {kind === "in-app" && state.kind === "in-app" && <OpenInBrowser info={state.inApp} url={selfUrl} />}

          {kind === "signed-out" && (
            <>
              <GoogleSignInButton next={selfPath} label="Continue with Google to join" />
              <p className="text-center text-xs text-gray-500">New here? Signing in creates your account — you&apos;ll pick a username next.</p>
            </>
          )}

          {kind === "needs-username" && (
            <Link href={`/onboarding?next=${encodeURIComponent(selfPath)}`} className={PRIMARY}>Pick your username to continue</Link>
          )}

          {kind === "member" && state.kind === "member" && (
            <>
              <p className="text-center text-sm text-gray-300">You&apos;re already in this league.</p>
              <Link href={state.href} className={PRIMARY}>Go to your team</Link>
            </>
          )}

          {kind === "pending" && card && (
            <>
              <div role="status" className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-center text-sm text-yellow-100">
                Waiting for the league admin to approve you. You&apos;ll see the league on your account page once they do.
              </div>
              <button type="button" onClick={() => cancel(card.leagueId)} disabled={busy} className={SECONDARY}>Cancel my request</button>
            </>
          )}

          {kind === "ready" && card && (
            <button type="button" onClick={join} disabled={busy} className={PRIMARY}>
              {busy ? "Joining…" : card.teamName ? `Join ${card.teamName}` : card.requiresApproval ? "Ask to join" : `Join ${card.leagueName}`}
            </button>
          )}

          {error && <p role="alert" className="text-center text-sm text-red-400">{error}</p>}
        </div>

        <p className="mt-8 text-center text-xs text-gray-500">
          <Link href="/help#join" className="underline hover:text-gray-300">Help with joining</Link>
          {" · "}
          <Link href="/privacy" className="underline hover:text-gray-300">Privacy</Link>
        </p>
      </main>
    </div>
  );
}
