"use client";

import { useState } from "react";

interface FoundUser {
  id: string;
  username: string | null;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  teams: Array<{ role: string; teamName: string; leagueName: string; leagueSlug: string }>;
  adminOf: string[];
}

const INPUT = "w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none";

function UserCard({ u, selected, onSelect, label }: { u: FoundUser; selected: boolean; onSelect: () => void; label: string }) {
  return (
    <li className={`rounded-xl border p-3 ${selected ? "border-yellow-500/60 bg-yellow-500/10" : "border-white/10 bg-white/5"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="truncate font-semibold text-white">
            {u.name} {u.username && <span className="text-gray-400">@{u.username}</span>}
            {u.role !== "user" && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-300">{u.role}</span>}
          </p>
          <p className="truncate text-xs text-gray-400">{u.email} · since {new Date(u.createdAt).toLocaleDateString()}</p>
          {(u.teams.length > 0 || u.adminOf.length > 0) && (
            <p className="mt-1 text-xs text-gray-400">
              {[...u.teams.map((t) => `${t.teamName} (${t.leagueName})`), ...u.adminOf.map((l) => `admin: ${l}`)].join(" · ")}
            </p>
          )}
        </div>
        <button type="button" onClick={onSelect} className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/10">
          {selected ? "Selected" : label}
        </button>
      </div>
    </li>
  );
}

/**
 * Users — find people, and move everything from a lost account to a new one. Someone who lost
 * their Google account signs in with a new one; this moves all their teams and admin rights across
 * in one go (lib/membership.ts transferAllMemberships) and signs the old account out everywhere.
 */
export function UsersPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundUser[]>([]);
  const [from, setFrom] = useState<FoundUser | null>(null);
  const [to, setTo] = useState<FoundUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/superadmin/users?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({ users: [] }));
    setResults(body.users ?? []);
    setBusy(false);
  };

  const transfer = async () => {
    if (!from || !to) return;
    if (!window.confirm(`Move all of ${from.name}'s teams and admin rights to ${to.name}? ${from.name}'s account will be signed out everywhere.`)) return;
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/superadmin/users/${from.id}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: to.id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice({ ok: false, text: body.error ?? "Transfer failed." });
    setNotice({ ok: true, text: `Moved ${body.moved} membership(s) to ${to.name}.` });
    setFrom(null);
    setTo(null);
    setResults([]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Users</h2>
        <p className="mt-1 text-sm text-gray-400">
          Find anyone by username, name or email. To recover a lost Google account: have the person sign in with their new account
          first, then pick the old account and the new one below.
        </p>
      </div>

      <form onSubmit={search} className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="username, name or email" aria-label="Search people" className={INPUT} />
        <button type="submit" disabled={busy || query.trim().length < 2} className="shrink-0 rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">Search</button>
      </form>

      {notice && (
        <p role="status" className={`rounded-lg border p-3 text-sm ${notice.ok ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>{notice.text}</p>
      )}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              selected={from?.id === u.id || to?.id === u.id}
              label={!from ? "Old account" : from.id === u.id ? "Old account" : "New account"}
              onSelect={() => {
                if (!from || from.id === u.id) setFrom(from?.id === u.id ? null : u);
                else setTo(to?.id === u.id ? null : u);
              }}
            />
          ))}
        </ul>
      )}

      {(from || to) && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm">
          <p className="text-gray-300">
            Move everything from <span className="font-semibold text-white">{from ? `${from.name} (${from.email})` : "…pick the old account"}</span>
            {" "}to <span className="font-semibold text-white">{to ? `${to.name} (${to.email})` : "…pick the new account"}</span>.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={transfer} disabled={busy || !from || !to} className="rounded-lg bg-yellow-500 px-4 py-2 font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">Move teams and admin rights</button>
            <button type="button" onClick={() => { setFrom(null); setTo(null); }} className="rounded-lg border border-white/15 px-4 py-2 font-semibold text-gray-200 hover:bg-white/10">Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
