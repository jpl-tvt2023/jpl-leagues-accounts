"use client";

import { useEffect, useRef, useState } from "react";

const POLL_MS = 2000;
const GIVE_UP_MS = 5 * 60 * 1000;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type State =
  | { step: "idle" }
  | { step: "waiting"; matchCode: string }
  | { step: "error"; message: string };

/**
 * Google sign-in for the iOS home-screen app, via the one-time handoff (lib/auth-handoff.ts).
 * The app keeps a secret verifier in memory, shows a short code, opens Google in a browser
 * sheet, and polls until the person has confirmed the same code there.
 */
export function HandoffSignIn({ next }: { next: string }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const flow = useRef<{ handoffId: string; verifier: string; startedAt: number } | null>(null);

  useEffect(() => {
    if (state.step !== "waiting") return;
    let stopped = false;

    const claim = async () => {
      const f = flow.current;
      if (!f || stopped) return;
      if (Date.now() - f.startedAt > GIVE_UP_MS) {
        setState({ step: "error", message: "That took too long. Please try again." });
        return;
      }
      const res = await fetch("/api/auth/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", handoffId: f.handoffId, verifier: f.verifier, next }),
      }).catch(() => null);
      if (!res || stopped) return;
      if (res.status === 200) {
        const body = await res.json();
        window.location.href = body.redirectTo ?? "/";
      } else if (res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        setState({ step: "error", message: body.error ?? "Sign-in didn't complete. Please try again." });
      }
    };

    const timer = setInterval(claim, POLL_MS);
    // Coming back from the browser sheet is the likeliest moment it just completed.
    const onVisible = () => document.visibilityState === "visible" && claim();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.step, next]);

  const start = async () => {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const res = await fetch("/api/auth/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", challenge }),
    }).catch(() => null);
    if (!res?.ok) {
      setState({ step: "error", message: "Couldn't start sign-in. Please try again." });
      return;
    }
    const { handoffId, matchCode } = await res.json();
    flow.current = { handoffId, verifier, startedAt: Date.now() };
    setState({ step: "waiting", matchCode });
    window.open(`/api/auth/google?handoff=${encodeURIComponent(handoffId)}&next=${encodeURIComponent(next)}`, "_blank");
  };

  if (state.step === "waiting") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center" aria-live="polite">
        <p className="text-sm text-gray-300">Finish signing in with Google, then confirm this code:</p>
        <p className="my-3 font-mono text-4xl font-bold tracking-[0.3em] text-white">{state.matchCode}</p>
        <p className="text-xs text-gray-400">This screen continues by itself once you&apos;ve confirmed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-6 py-3 text-sm sm:text-base font-semibold text-slate-800 shadow transition hover:bg-gray-100"
      >
        Continue with Google
      </button>
      {state.step === "error" && <p className="text-center text-sm text-red-400">{state.message}</p>}
    </div>
  );
}
