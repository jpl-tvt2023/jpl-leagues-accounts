"use client";

import { useState } from "react";

export function HandoffConfirm({ handoffId, matchCode }: { handoffId: string; matchCode: string }) {
  const [state, setState] = useState<"ask" | "busy" | "done" | "declined" | "error">("ask");
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setState("busy");
    const res = await fetch("/api/auth/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", handoffId }),
    }).catch(() => null);
    if (res?.ok) return setState("done");
    const body = await res?.json().catch(() => ({}));
    setError(body?.error ?? "Couldn't confirm. Please try again from the app.");
    setState("error");
  };

  if (state === "done") {
    return (
      <>
        <h1 className="text-xl font-bold text-white">You&apos;re signed in</h1>
        <p className="mt-2 text-sm text-gray-400">Close this and go back to the JPL app — it continues by itself.</p>
      </>
    );
  }
  if (state === "declined") {
    return (
      <>
        <h1 className="text-xl font-bold text-white">Nothing was shared</h1>
        <p className="mt-2 text-sm text-gray-400">If someone sent you this link, ignore it. You can close this page.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-bold text-white">Finish signing in to the JPL app</h1>
      <p className="mt-2 text-sm text-gray-300">Does your JPL app show this code?</p>
      <p className="my-4 font-mono text-4xl font-bold tracking-[0.3em] text-white">{matchCode}</p>
      <p className="mb-5 text-xs text-yellow-300">
        Only confirm if you started this in your own JPL app just now. Confirming signs that app in as you.
      </p>
      {state === "error" && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={() => setState("declined")} className="flex-1 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
          No, cancel
        </button>
        <button type="button" onClick={confirm} disabled={state === "busy"} className="flex-1 rounded-lg bg-yellow-500 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">
          {state === "busy" ? "Confirming…" : "Yes, it matches"}
        </button>
      </div>
    </>
  );
}
