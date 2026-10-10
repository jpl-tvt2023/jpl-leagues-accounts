"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { normalizeUsername, usernameProblem } from "@/lib/username";

const INPUT =
  "w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500";

type UsernameState = { status: "idle" | "checking" | "ok" | "bad"; message: string | null };

export function OnboardingClient({ next }: { next: string }) {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameState>({ status: "idle", message: null });
  const [fplEntryId, setFplEntryId] = useState("");
  const [fplPreview, setFplPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkSeq = useRef(0);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!me?.authenticated) {
        window.location.href = `/signin?next=${encodeURIComponent(`/onboarding?next=${next}`)}`;
        return;
      }
      if (me.type === "team") {
        window.location.href = "/dashboard"; // legacy team login: nothing to set up here
        return;
      }
      if (me.user?.username) {
        window.location.href = next; // already done
        return;
      }
      setEmail(me.user?.email ?? "");
      setName(me.user?.name ?? "");
      setFplEntryId(me.user?.fplEntryId ?? "");
      setLoading(false);
    })();
  }, [next]);

  // Live availability: local rules instantly, then the server (debounced) for "taken".
  useEffect(() => {
    const candidate = normalizeUsername(username);
    if (!candidate) {
      setUsernameState({ status: "idle", message: null });
      return;
    }
    const problem = usernameProblem(candidate);
    if (problem) {
      setUsernameState({ status: "bad", message: problem });
      return;
    }
    setUsernameState({ status: "checking", message: null });
    const seq = ++checkSeq.current;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/me/profile?checkUsername=${encodeURIComponent(candidate)}`, { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => null);
      if (seq !== checkSeq.current) return; // a newer keystroke won
      if (!res) setUsernameState({ status: "idle", message: null });
      else if (res.available) setUsernameState({ status: "ok", message: `@${candidate} is available` });
      else setUsernameState({ status: "bad", message: res.problem ?? "That username is taken." });
    }, 400);
    return () => clearTimeout(timer);
  }, [username]);

  const checkFpl = async () => {
    setFplPreview(null);
    const id = fplEntryId.trim();
    if (!id) return;
    const res = await fetch(`/api/me/profile?checkFplEntry=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (res?.found) setFplPreview(`${res.teamName} — ${res.managerName}`);
    else if (res?.problem) setFplPreview(res.problem);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, fplEntryId: fplEntryId.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't save. Please try again.");
        return;
      }
      window.location.href = next;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen variant="default" label="Setting up your account" />;

  const canSubmit = usernameState.status === "ok" && name.trim().length > 0 && !saving;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "flow" }} activeKey="" brandHref="/" brandLabel="JPL India" title="Welcome" />

      <div className="mx-auto max-w-md px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2">Pick your username</h1>
          <p className="text-sm sm:text-base text-gray-400">
            One username for every league you play in. Teammates and league admins will see it.
          </p>
          {email && <p className="mt-2 text-xs text-gray-500">Signed in as {email}</p>}
        </div>

        {error && <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">{error}</div>}

        <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-8 backdrop-blur space-y-5">
          <div>
            <label htmlFor="onb-username" className="block text-sm font-medium text-gray-300 mb-2">Username</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-gray-500">@</span>
              <input
                id="onb-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                maxLength={21}
                required
                className={`${INPUT} pl-9`}
                aria-describedby="onb-username-help"
              />
            </div>
            <p
              id="onb-username-help"
              aria-live="polite"
              className={`mt-1 text-xs ${usernameState.status === "bad" ? "text-red-400" : usernameState.status === "ok" ? "text-green-400" : "text-gray-500"}`}
            >
              {usernameState.status === "checking" ? "Checking…" : usernameState.message ?? "3–20 characters: lowercase letters, numbers and underscores."}
            </p>
          </div>

          <div>
            <label htmlFor="onb-name" className="block text-sm font-medium text-gray-300 mb-2">Display name</label>
            <input id="onb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={INPUT} />
          </div>

          <div>
            <label htmlFor="onb-fpl" className="block text-sm font-medium text-gray-300 mb-2">
              Your FPL team ID <span className="text-gray-500">(optional)</span>
            </label>
            <input
              id="onb-fpl"
              value={fplEntryId}
              onChange={(e) => setFplEntryId(e.target.value.replace(/\D/g, ""))}
              onBlur={checkFpl}
              inputMode="numeric"
              maxLength={10}
              className={INPUT}
              aria-describedby="onb-fpl-help"
            />
            <p id="onb-fpl-help" className="mt-1 text-xs text-gray-500">
              {fplPreview ?? "The number in your FPL team's web address. We'll fill it in when you set up a team."}
            </p>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500 px-6 py-3 text-sm sm:text-base font-semibold text-slate-900 transition hover:from-yellow-300 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          <Link href="/privacy" className="underline hover:text-gray-300">What we store</Link>
          {" · "}
          <Link href="/help" className="underline hover:text-gray-300">Help</Link>
        </p>
      </div>
    </div>
  );
}
