"use client";

import { useEffect, useRef, useState } from "react";

/** What GET /api/team/invite returns: the team, its members and (for the owner) the partner invite. */
export interface TeamInfo {
  teamName: string;
  role: "owner" | "member";
  maxMembers: number;
  /** Every FPL slot is filled. */
  isProfileComplete: boolean;
  /** The viewer hasn't done their own part of setup yet. */
  needsSetup: boolean;
  members: Array<{
    id: string;
    role: "owner" | "member";
    username: string | null;
    name: string;
    isMe: boolean;
    /** The FPL slot this person filled in, if they have. */
    player: { name: string; fplId: string } | null;
  }>;
  invite: { token: string; expiresAt: string | null } | null;
  /** Partner details the owner entered themselves (no one is linked to them yet). */
  partnerSlot: { name: string; fplId: string } | null;
  slotsFilled: number;
  /** Set once the league's FPL teams are fixed (its first gameweek deadline has passed). */
  fplLock: { gw: number; deadline: string } | null;
}

export async function fetchTeamInfo(leagueSlug: string): Promise<{ info: TeamInfo } | { error: string }> {
  const res = await fetch(`/api/team/invite?league=${encodeURIComponent(leagueSlug)}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body.error ?? "You're not on a team in this league." };
  return { info: body as TeamInfo };
}

const INPUT = "w-full rounded-lg border border-white/20 bg-black/40 px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-400 focus:outline-none";
const PRIMARY = "rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50";
const SECONDARY = "rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50";

/**
 * The owner's side of bringing in a TVT / Continental partner: the team's single-use invite link
 * (copy, share, turn off) and, for a partner who won't sign in, a form to enter their details.
 * The partner opens the link, signs in, lands on this exact team and adds their own FPL details.
 * Renders a status line instead once the partner has joined.
 */
export function PartnerInvitePanel({
  leagueSlug,
  info,
  onChanged,
  autoCreate = false,
}: {
  leagueSlug: string;
  info: TeamInfo;
  onChanged: () => Promise<void> | void;
  /** Make the link straight away if there isn't one (setup's partner step). */
  autoCreate?: boolean;
}) {
  const api = (path: string) => `${path}?league=${encodeURIComponent(leagueSlug)}`;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", fplId: "" });
  const autoCreated = useRef(false);

  const partner = info.members.find((m) => !m.isMe) ?? null;
  const roomForPartner = info.members.length < info.maxMembers;

  const makeInvite = async () => {
    setBusy(true);
    setNotice(null);
    const res = await fetch(api("/api/team/invite"), { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "Couldn't create the invite.");
    setCopied(false);
    await onChanged();
  };

  useEffect(() => {
    if (autoCreate && !autoCreated.current && !info.invite && roomForPartner && info.role === "owner") {
      autoCreated.current = true;
      void makeInvite();
    }
    // Runs once per mount when there's no link yet; makeInvite only depends on the league.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreate, info.invite, roomForPartner, info.role]);

  if (info.role !== "owner") return null;
  if (partner?.player) {
    return <p className="text-sm text-gray-300">✓ {partner.name} has joined and added their FPL details.</p>;
  }
  if (partner) {
    return (
      <p className="text-sm text-gray-300">
        {partner.name} has joined. They still need to add their own FPL details; your team shows as pending until they do.
      </p>
    );
  }

  const inviteUrl = info.invite && typeof window !== "undefined" ? `${window.location.origin}/join/${info.invite.token}` : null;
  const shareText = `Join our team ${info.teamName} on JPL India:`;

  const copy = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopied(true);
  };

  const share = async () => {
    if (!inviteUrl) return;
    if (typeof navigator.share === "function") {
      await navigator.share({ title: info.teamName, text: shareText, url: inviteUrl }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${inviteUrl}`)}`, "_blank", "noopener,noreferrer");
    }
  };

  const openEditor = () => {
    setForm({ name: info.partnerSlot?.name ?? "", fplId: info.partnerSlot?.fplId ?? "" });
    setEditing(true);
  };

  const revokeInvite = async () => {
    setBusy(true);
    await fetch(api("/api/team/invite"), { method: "DELETE" });
    setBusy(false);
    await onChanged();
  };

  const savePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch(api("/api/team/partner"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, fplId: form.fplId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(body.error ?? "Couldn't save.");
    setEditing(false);
    await onChanged();
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">Invite your partner</h3>
        <p className="mt-1 text-xs text-gray-400">
          Send this link to your partner. When they open it and sign in, they join {info.teamName} and add their own name and
          FPL ID. One link, one partner, valid for 7 days.
        </p>
        {inviteUrl ? (
          <div className="mt-3 space-y-2">
            <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} aria-label="Partner invite link" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-200" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} className={PRIMARY}>{copied ? "Copied" : "Copy link"}</button>
              <button type="button" onClick={share} className={SECONDARY}>Share</button>
              <button type="button" onClick={revokeInvite} disabled={busy} className={SECONDARY}>Turn off</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={makeInvite} disabled={busy} className={`mt-3 ${PRIMARY}`}>
            {busy ? "Creating…" : "Create invite link"}
          </button>
        )}
      </div>

      <div className="border-t border-white/10 pt-4">
        {info.partnerSlot && !editing ? (
          <div className="text-sm text-gray-300">
            <p>
              You entered your partner: <span className="font-semibold text-white">{info.partnerSlot.name}</span> · FPL {info.partnerSlot.fplId}
            </p>
            <p className="mt-1 text-xs text-gray-400">If they sign in with the link later, they take over this slot and can correct it.</p>
            <button type="button" onClick={openEditor} className="mt-2 text-xs text-yellow-400 underline">Edit</button>
          </div>
        ) : editing ? (
          <form onSubmit={savePartner} className="space-y-3">
            <h3 className="text-sm font-semibold text-white">Your partner&apos;s details</h3>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} placeholder="Partner's name" aria-label="Partner's name" className={INPUT} />
            <input value={form.fplId} onChange={(e) => setForm({ ...form, fplId: e.target.value.replace(/\D/g, "") })} inputMode="numeric" maxLength={10} placeholder="Partner's FPL team ID" aria-label="Partner's FPL team ID" className={INPUT} />
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !form.name.trim() || !form.fplId} className={PRIMARY}>{busy ? "Saving…" : "Save partner"}</button>
              <button type="button" onClick={() => setEditing(false)} className={SECONDARY}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={openEditor} className="text-xs text-gray-400 underline hover:text-gray-200">
            Partner won&apos;t sign in? Enter their details yourself
          </button>
        )}
      </div>

      {notice && <p role="status" className="text-sm text-red-300">{notice}</p>}
    </div>
  );
}
