"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { announceAuthChange, signOutAccounts } from "@/lib/accounts-client";

const INPUT =
  "w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500";
const CARD = "rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 backdrop-blur";

interface Profile {
  email: string;
  name: string;
  username: string | null;
  fplEntryId: string | null;
  role: string;
}
interface MyLeagues {
  teams: Array<{ leagueId: string; slug: string; leagueName: string; format: string; season: string; teamName: string; role: string }>;
  adminOf: Array<{ leagueId: string; slug: string; leagueName: string }>;
  allLeagues: boolean;
  pending: Array<{ requestId: string; slug: string; leagueName: string }>;
}
type Notice = { type: "success" | "error"; text: string } | null;

/**
 * /account — the signed-in person's own page: profile, the leagues they're in, their devices,
 * and deleting the account. Legacy team logins have /settings instead.
 */
export default function AccountPage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [leagues, setLeagues] = useState<MyLeagues | null>(null);
  const [form, setForm] = useState({ username: "", name: "", fplEntryId: "" });
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (!me?.authenticated) {
        window.location.href = "/signin?next=/account";
        return;
      }
      if (me.type === "team") {
        window.location.href = "/settings";
        return;
      }
      if (!me.user?.username && me.type === "user") {
        window.location.href = "/onboarding?next=/account";
        return;
      }
      const [p, l] = await Promise.all([
        fetch("/api/me/profile", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/me/leagues", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setProfile(p.user);
      setForm({ username: p.user.username ?? "", name: p.user.name ?? "", fplEntryId: p.user.fplEntryId ?? "" });
      setLeagues(l);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("profile");
    setNotice(null);
    const res = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.username, name: form.name, fplEntryId: form.fplEntryId.trim() || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setNotice({ type: "error", text: body.error ?? "Couldn't save." });
    setProfile(body.user);
    setNotice({ type: "success", text: "Saved." });
  };

  const signOutOthers = async () => {
    setBusy("others");
    setNotice(null);
    const res = await fetch("/api/me/sessions", { method: "POST" });
    setBusy(null);
    setNotice(res.ok ? { type: "success", text: "Signed out of every other device." } : { type: "error", text: "Couldn't do that. Please try again." });
  };

  const signOut = async () => {
    setBusy("signout");
    await signOutAccounts();
    window.location.href = "/";
  };

  const deleteAccount = async () => {
    setBusy("delete");
    setNotice(null);
    const res = await fetch("/api/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: confirmDelete }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(null);
      return setNotice({ type: "error", text: body.error ?? "Couldn't delete the account." });
    }
    announceAuthChange({ type: "signed-out" });
    window.location.href = "/";
  };

  if (loading || !profile || !leagues) return <LoadingScreen variant="default" label="Loading your account" />;

  const confirmWord = profile.username ?? profile.email;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "account", backHref: "/" }} activeKey="" brandHref="/" brandLabel="Account" onSignOut={signOut} />

      <div className="mx-auto max-w-xl px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Your account</h1>
          <p className="mt-1 text-sm text-gray-400">
            {profile.username ? `@${profile.username}` : profile.name} · {profile.email}
          </p>
        </div>

        {notice && (
          <div
            role="status"
            className={`rounded-lg p-4 ${notice.type === "success" ? "border border-green-500/30 bg-green-500/10 text-green-400" : "border border-red-500/30 bg-red-500/10 text-red-400"}`}
          >
            {notice.text}
          </div>
        )}

        <section aria-labelledby="my-leagues" className={CARD}>
          <h2 id="my-leagues" className="text-lg font-semibold text-white mb-3">Your leagues</h2>
          {leagues.teams.length === 0 && leagues.adminOf.length === 0 && !leagues.allLeagues ? (
            <p className="text-sm text-gray-400">You&apos;re not in any league yet. Open an invite link from your league admin to join one.</p>
          ) : (
            <ul className="space-y-2">
              {leagues.teams.map((t) => (
                <li key={t.leagueId}>
                  <Link href={`/${t.slug}`} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-white">{t.leagueName}</span>
                      <span className="block truncate text-xs text-gray-400">{t.teamName} · {t.role === "owner" ? "Owner" : "Teammate"} · {t.season}</span>
                    </span>
                    <span className="text-xs text-yellow-400">Open</span>
                  </Link>
                </li>
              ))}
              {leagues.adminOf.map((a) => (
                <li key={`admin-${a.leagueId}`}>
                  <Link href={`/admin/${a.leagueId}`} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5">
                    <span className="block truncate font-semibold text-white">{a.leagueName}</span>
                    <span className="text-xs text-gray-400">Admin</span>
                  </Link>
                </li>
              ))}
              {leagues.allLeagues && (
                <li>
                  <Link href="/admin" className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-white/5">
                    <span className="font-semibold text-white">All leagues</span>
                    <span className="text-xs text-gray-400">Platform admin</span>
                  </Link>
                </li>
              )}
            </ul>
          )}
          {leagues.pending.length > 0 && (
            <p className="mt-3 text-xs text-gray-400">
              Waiting for approval: {leagues.pending.map((p) => p.leagueName).join(", ")}
            </p>
          )}
        </section>

        <section aria-labelledby="profile" className={CARD}>
          <h2 id="profile" className="text-lg font-semibold text-white mb-3">Profile</h2>
          <form onSubmit={saveProfile} className="space-y-4">
            <div>
              <label htmlFor="acc-username" className="block text-sm font-medium text-gray-300 mb-1">Username</label>
              <input id="acc-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" spellCheck={false} className={INPUT} />
            </div>
            <div>
              <label htmlFor="acc-name" className="block text-sm font-medium text-gray-300 mb-1">Display name</label>
              <input id="acc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} className={INPUT} />
            </div>
            <div>
              <label htmlFor="acc-fpl" className="block text-sm font-medium text-gray-300 mb-1">Your FPL team ID</label>
              <input id="acc-fpl" value={form.fplEntryId} onChange={(e) => setForm({ ...form, fplEntryId: e.target.value.replace(/\D/g, "") })} inputMode="numeric" maxLength={10} className={INPUT} />
              <p className="mt-1 text-xs text-gray-500">Used to prefill team setup. Changing it doesn&apos;t change teams you&apos;ve already set up.</p>
            </div>
            <button type="submit" disabled={busy !== null} className="rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">
              {busy === "profile" ? "Saving…" : "Save"}
            </button>
          </form>
        </section>

        <section aria-labelledby="devices" className={CARD}>
          <h2 id="devices" className="text-lg font-semibold text-white mb-1">Devices</h2>
          <p className="mb-3 text-sm text-gray-400">Lost a phone, or signed in on someone else&apos;s? Sign out everywhere except here.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={signOutOthers} disabled={busy !== null} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
              {busy === "others" ? "Signing out…" : "Sign out of all other devices"}
            </button>
            <button type="button" onClick={signOut} disabled={busy !== null} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
              Sign out
            </button>
          </div>
        </section>

        <section aria-labelledby="delete-account" className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 sm:p-6">
          <h2 id="delete-account" className="text-lg font-semibold text-white mb-1">Delete account</h2>
          <p className="mb-3 text-sm text-gray-400">
            Your teams stay in their leagues — a team you share passes to your teammate, otherwise your league admin can reassign it.
            This can&apos;t be undone.
          </p>
          <label htmlFor="acc-delete" className="block text-sm text-gray-300 mb-1">
            Type <span className="font-mono text-white">{confirmWord}</span> to confirm
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="acc-delete" value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} autoCapitalize="none" spellCheck={false} className={INPUT} />
            <button
              type="button"
              onClick={deleteAccount}
              disabled={busy !== null || confirmDelete.trim().toLowerCase() !== confirmWord.toLowerCase()}
              className="shrink-0 rounded-lg bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
            >
              {busy === "delete" ? "Deleting…" : "Delete account"}
            </button>
          </div>
        </section>

        <p className="text-center text-xs text-gray-500">
          <Link href="/privacy" className="underline hover:text-gray-300">Privacy</Link>
          {" · "}
          <Link href="/help" className="underline hover:text-gray-300">Help</Link>
        </p>
      </div>
    </div>
  );
}
