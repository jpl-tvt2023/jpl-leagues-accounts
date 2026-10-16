"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LeagueNav } from "@/components/LeagueNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useLeague } from "@/lib/league-context";
import { isCricketFormat } from "@/lib/sports/registry";
import { signOutAccounts } from "@/lib/accounts-client";
import { PartnerInvitePanel, fetchTeamInfo, type TeamInfo } from "@/components/PartnerInvitePanel";
import { MyFplTeamSection } from "@/components/MyFplTeamSection";

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 backdrop-blur";

/**
 * /[leagueSlug]/team — your team in a members-mode league: who's on it (and the FPL details each
 * has added), which of your FPL teams plays here, its name, and (for the owner) the partner invite
 * or the partner's details entered by hand. Legacy team logins manage their team at /settings.
 */
export default function TeamPage() {
  const { league, viewer } = useLeague();
  const api = (path: string) => `${path}?league=${encodeURIComponent(league.slug)}`;
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!viewer.authenticated) {
      window.location.href = `/signin?next=${encodeURIComponent(`/${league.slug}/team`)}`;
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await fetchTeamInfo(league.slug);
      if (cancelled) return;
      if ("error" in result) return setError(result.error);
      setInfo(result.info);
      setTeamName(result.info.teamName);
    })();
    return () => {
      cancelled = true;
    };
  }, [league.slug, viewer.authenticated]);

  const reload = async () => {
    const result = await fetchTeamInfo(league.slug);
    if ("info" in result) setInfo(result.info);
  };

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch(api("/api/team/settings"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamName }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setNotice(res.ok ? "Team name saved." : body.error ?? "Couldn't save.");
    if (res.ok) await reload();
  };

  const signOut = async () => {
    await signOutAccounts();
    window.location.href = "/";
  };

  if (!info && !error) {
    return isCricketFormat(league.format) ? (
      <LoadingScreen variant="cricket" bgClass="bg-transparent" label="Loading your team" />
    ) : (
      <LoadingScreen variant="default" label="Loading your team" />
    );
  }

  return (
    <>
      <LeagueNav
        leagueSlug={league.slug}
        leagueName={league.name}
        currentPage="settings"
        format={league.format as "tvt" | "auction" | "continental-championship" | "fpl-classic"}
        teamSize={league.teamSize}
        auctionTier={league.auctionTier ?? null}
        isLoggedIn={viewer.authenticated}
        dashboardHref={viewer.dashboardHref}
        onSignOut={signOut}
        title="Your team"
      />
      <main className="mx-auto max-w-xl px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        {error ? (
          <div className={CARD}>
            <p className="text-gray-300">{error}</p>
            <Link href="/account" className="mt-3 inline-block text-sm text-yellow-400 underline">Your leagues</Link>
          </div>
        ) : info && (
          <>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{info.teamName}</h1>
              <p className="mt-1 text-sm text-gray-400">{league.name} · {info.role === "owner" ? "You own this team" : "You're on this team"}</p>
            </div>

            {info.needsSetup && (
              <Link href={`/${league.slug}/setup`} className="block rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Add your own name and FPL ID to finish setting up →
              </Link>
            )}
            {!info.needsSetup && info.maxMembers > 1 && !info.isProfileComplete && (
              <p className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Setup pending: your team needs both partners&apos; FPL details.
              </p>
            )}

            {notice && <p role="status" className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-gray-200">{notice}</p>}

            <section aria-labelledby="members" className={CARD}>
              <h2 id="members" className="mb-3 text-lg font-semibold text-white">
                Members <span className="text-sm font-normal text-gray-400">({info.members.length} of {info.maxMembers})</span>
              </h2>
              <ul className="space-y-2">
                {info.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-white">{m.name}{m.isMe && <span className="text-gray-400"> (you)</span>}</span>
                      {m.username && <span className="block truncate text-xs text-gray-400">@{m.username}</span>}
                      {info.maxMembers > 1 && (
                        <span className="block truncate text-xs text-gray-400">
                          {m.player ? `Plays as ${m.player.name} · FPL ${m.player.fplId}` : "Hasn't added their FPL details yet"}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400">{m.role === "owner" ? "Owner" : "Teammate"}</span>
                  </li>
                ))}
              </ul>

              {info.role === "owner" && info.maxMembers > 1 && !info.needsSetup && (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <PartnerInvitePanel leagueSlug={league.slug} info={info} onChanged={reload} />
                </div>
              )}
            </section>

            {info.maxMembers > 1 && !info.needsSetup && <MyFplTeamSection leagueSlug={league.slug} onChanged={reload} />}

            <section aria-labelledby="team-name" className={CARD}>
              <h2 id="team-name" className="mb-3 text-lg font-semibold text-white">Team name</h2>
              <form onSubmit={rename} className="flex flex-col gap-2 sm:flex-row">
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} aria-label="Team name" className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-yellow-500 focus:outline-none" />
                <button type="submit" disabled={busy || !teamName.trim() || teamName === info.teamName} className="shrink-0 rounded-lg bg-yellow-500 px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">Save</button>
              </form>
              <p className="mt-2 text-xs text-gray-500">Must be unique within the league.</p>
            </section>

            <p className="text-center text-sm">
              <Link href={`/${league.slug}/dashboard`} className="text-yellow-400 underline">Back to your dashboard</Link>
            </p>
          </>
        )}
      </main>
    </>
  );
}
