"use client";

import { useCallback, useEffect, useState } from "react";

interface Member { id: string; role: "owner" | "member"; userId: string; username: string | null; name: string; email: string }
interface TeamRow { id: string; name: string; teamKey: string | null; state: "open" | "claimed" | "set-up"; members: Member[] }
interface Request { id: string; createdAt: string; userId: string; username: string | null; name: string; email: string }
interface Invite { id: string; token: string; maxUses: number | null; useCount: number; requiresApproval: boolean; expiresAt: string | null }
interface Roster { teams: TeamRow[]; requests: Request[]; invite: Invite | null; format?: string; maxMembers?: number }

const BTN = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";
const PRIMARY = `${BTN} bg-yellow-500 text-slate-900 hover:bg-yellow-400`;
const GHOST = `${BTN} border border-white/15 text-gray-200 hover:bg-white/10`;
const DANGER = `${BTN} border border-red-500/40 text-red-300 hover:bg-red-500/10`;
const INPUT = "rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none";

const STATE_LABEL: Record<TeamRow["state"], { text: string; cls: string }> = {
  open: { text: "Open", cls: "bg-white/10 text-gray-300" },
  claimed: { text: "Claimed — not set up", cls: "bg-yellow-500/15 text-yellow-300" },
  "set-up": { text: "Set up", cls: "bg-green-500/15 text-green-300" },
};

/**
 * Members tab (members-mode leagues): the invite link, join requests, and who is on every team.
 * Replaces handing out team logins — see docs/10-accounts-and-membership.md.
 */
export function MembersTab({ leagueId }: { leagueId: string }) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/${leagueId}/members`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Couldn't load members.");
    setRoster(body);
  }, [leagueId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/${leagueId}/members`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) setError(body.error ?? "Couldn't load members.");
      else setRoster(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const act = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/admin/${leagueId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "That didn't work.");
    setNotice(success);
    setAssignFor(null);
    setReplaceFor(null);
    setUsername("");
    setRoster((prev) => ({ ...prev, ...body }));
  };

  const newInvite = async (requiresApproval: boolean) => {
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/admin/${leagueId}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requiresApproval }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "Couldn't create the link.");
    setCopied(false);
    setNotice("New invite link created. The old one no longer works.");
    await load();
  };

  const revoke = async (inviteId: string) => {
    if (!window.confirm("Turn this invite link off? Anyone who hasn't joined yet will need a new one.")) return;
    setBusy(true);
    await fetch(`/api/admin/${leagueId}/invites`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inviteId }) });
    setBusy(false);
    setNotice("Invite link turned off.");
    await load();
  };

  if (error) return <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</p>;
  if (!roster) return <p className="text-gray-400">Loading members…</p>;

  const inviteUrl = roster.invite ? `${window.location.origin}/join/${roster.invite.token}` : null;
  // People per team for this format, from the server (lib/membership.ts MAX_TEAM_MEMBERS).
  const maxMembers = roster.maxMembers ?? 1;
  const claimed = roster.teams.filter((t) => t.state !== "open").length;

  return (
    <div className="space-y-6">
      {notice && <p role="status" className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-gray-200">{notice}</p>}

      <section aria-labelledby="invite-link" className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 id="invite-link" className="text-lg font-semibold text-white">Invite link</h2>
        <p className="mt-1 text-sm text-gray-400">
          Share it in your league&apos;s group chat. Each person signs in with Google and gets an open team. {claimed} of {roster.teams.length} teams claimed.
        </p>
        {roster.invite && inviteUrl ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} aria-label="League invite link" className={`${INPUT} w-full text-xs`} />
              <button
                type="button"
                className={PRIMARY}
                onClick={async () => {
                  await navigator.clipboard.writeText(inviteUrl).catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Used {roster.invite.useCount}{roster.invite.maxUses !== null ? ` of ${roster.invite.maxUses}` : ""} times
              {roster.invite.expiresAt ? ` · expires ${new Date(roster.invite.expiresAt).toLocaleDateString()}` : " · never expires"}
              {roster.invite.requiresApproval ? " · you approve each join" : " · joins straight away"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={GHOST} disabled={busy} onClick={() => newInvite(!roster.invite!.requiresApproval)}>
                {roster.invite.requiresApproval ? "Let people join straight away" : "Require my approval"}
              </button>
              <button type="button" className={GHOST} disabled={busy} onClick={() => newInvite(roster.invite!.requiresApproval)}>New link</button>
              <button type="button" className={DANGER} disabled={busy} onClick={() => revoke(roster.invite!.id)}>Turn off</button>
            </div>
            <p className="text-xs text-gray-500">Changing the approval setting creates a new link — the old one stops working.</p>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => newInvite(false)}>Create invite link</button>
            <button type="button" className={GHOST} disabled={busy} onClick={() => newInvite(true)}>Create one that needs my approval</button>
          </div>
        )}
      </section>

      {roster.requests.length > 0 && (
        <section aria-labelledby="join-requests" className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-5">
          <h2 id="join-requests" className="text-lg font-semibold text-white">Requests ({roster.requests.length})</h2>
          <ul className="mt-3 space-y-2">
            {roster.requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-lg bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-white">{r.name} {r.username && <span className="text-gray-400">@{r.username}</span>}</span>
                  <span className="block truncate text-xs text-gray-400">{r.email} · asked {new Date(r.createdAt).toLocaleDateString()}</span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className={PRIMARY} disabled={busy} onClick={() => act({ action: "approve", requestId: r.id }, `${r.name} approved and given a team.`)}>Approve</button>
                  <button type="button" className={GHOST} disabled={busy} onClick={() => act({ action: "reject", requestId: r.id }, `${r.name}'s request declined.`)}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="league-teams" className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 id="league-teams" className="text-lg font-semibold text-white">Teams</h2>
        <ul className="mt-3 divide-y divide-white/5">
          {roster.teams.map((t) => {
            const state = STATE_LABEL[t.state];
            return (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{t.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.cls}`}>{state.text}</span>
                  {t.teamKey && <span className="text-[11px] text-gray-500" title="Internal team key — backups and imports match teams by it. Not a login.">key: {t.teamKey}</span>}
                </div>
                <ul className="mt-2 space-y-1">
                  {t.members.map((m) => (
                    <li key={m.id} className="flex flex-col gap-2 rounded-lg bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 text-sm">
                        <span className="text-white">{m.name}</span>
                        {m.username && <span className="text-gray-400"> @{m.username}</span>}
                        <span className="text-gray-500"> · {m.role === "owner" ? "owner" : "teammate"} · {m.email}</span>
                      </span>
                      {replaceFor === m.id ? (
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: "replace", memberId: m.id, username }, `Seat moved to @${username.replace(/^@/, "")}.`); }}>
                          <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="new account's username" aria-label="Username of the new account" className={INPUT} />
                          <button type="submit" className={PRIMARY} disabled={busy || !username.trim()}>Move</button>
                          <button type="button" className={GHOST} onClick={() => setReplaceFor(null)}>Cancel</button>
                        </form>
                      ) : (
                        <span className="flex flex-wrap gap-2">
                          {m.role === "member" && <button type="button" className={GHOST} disabled={busy} onClick={() => act({ action: "transfer-owner", memberId: m.id }, `${m.name} now owns ${t.name}.`)}>Make owner</button>}
                          <button type="button" className={GHOST} disabled={busy} onClick={() => { setReplaceFor(m.id); setUsername(""); }} title="They lost their Google account: move this seat to their new account">Replace account</button>
                          <button type="button" className={DANGER} disabled={busy} onClick={() => window.confirm(`Take ${m.name} off ${t.name}?`) && act({ action: "remove", memberId: m.id }, `${m.name} removed from ${t.name}.`)}>Remove</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.members.length < maxMembers && (assignFor === t.id ? (
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ action: "assign", teamId: t.id, username }, `@${username.replace(/^@/, "")} added to ${t.name}.`); }}>
                      <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" aria-label={`Username to add to ${t.name}`} className={INPUT} />
                      <button type="submit" className={PRIMARY} disabled={busy || !username.trim()}>Add</button>
                      <button type="button" className={GHOST} onClick={() => setAssignFor(null)}>Cancel</button>
                    </form>
                  ) : (
                    <button type="button" className={GHOST} disabled={busy} onClick={() => { setAssignFor(t.id); setUsername(""); }}>
                      {t.members.length === 0 ? "Assign by username" : "Add teammate by username"}
                    </button>
                  ))}
                  {t.members.length > 0 && (
                    <button type="button" className={DANGER} disabled={busy} onClick={() => window.confirm(`Release ${t.name}? Everyone comes off it; the team and its results stay.`) && act({ action: "release", teamId: t.id }, `${t.name} released.`)}>
                      Release team
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
