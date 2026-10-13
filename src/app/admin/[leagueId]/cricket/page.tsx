"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Tabs } from "@/components/ui/Tabs";
import { CricketSettingsForm } from "@/components/cricket/CricketSettingsForm";
import { CRICKET_AUCTION_FORMAT } from "@/lib/sports/registry";
import type { CricketLeagueSettings } from "@/lib/sports/cricket/league-settings";
import { MembersTab } from "../MembersTab";
import { CricketAuctionAdmin } from "./CricketAuctionAdmin";

type Tab = "overview" | "auction" | "settings" | "members";

interface ConfigPayload {
  league: { id: string; slug: string; name: string; season: string; teamSize: number };
  tournament: { id: string; name: string; kind: "league" | "window"; status: string; teams: number; players: number; fixtures: number; fixturesScored: number } | null;
  settings: CricketLeagueSettings;
  completedAt: string | null;
  settingsLocked: boolean;
}

/** League admin console for a Classic Cricket Auction league. */
export default function CricketAdminPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [tab, setTab] = useState<Tab>("overview");
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [draft, setDraft] = useState<CricketLeagueSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, me] = await Promise.all([fetch(`/api/admin/${leagueId}/cricket/config`, { cache: "no-store" }), fetch("/api/auth/me")]);
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/signin";
        return;
      }
      const body = await res.json();
      const meBody = await me.json().catch(() => ({}));
      if (cancelled) return;
      setIsSuperadmin(meBody.type === "superadmin");
      if (!res.ok) {
        setError(body.error ?? "Couldn't load the league");
        return;
      }
      setConfig(body);
      setDraft(body.settings);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, version]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/${leagueId}/cricket/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Couldn't save");
      else {
        setConfig(body);
        setDraft(body.settings);
        setNotice("Settings saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  const setComplete = async (complete: boolean) => {
    if (complete && !confirm("Mark the season complete? The current leader becomes champion.")) return;
    const res = await fetch(`/api/admin/${leagueId}/cricket/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complete }),
    });
    if (res.ok) setVersion((v) => v + 1);
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  };

  if (!config && !error) return <LoadingScreen variant="standings" fullScreen />;

  const t = config?.tournament;
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-green-900/40 to-slate-900">
      <AppNav
        context={{ surface: "admin-league", leagueId, format: CRICKET_AUCTION_FORMAT, isSuperadminViewer: isSuperadmin, variant: "full" }}
        activeKey="admin-dashboard"
        brandHref="/admin"
        brandLabel="Admin Dashboard"
        brandBadge={{ label: "CCA", bgClass: "bg-green-500/20", textClass: "text-green-200" }}
        onSignOut={handleSignOut}
      />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-10">
        <header>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{config?.league.name ?? leagueId}</h1>
          <p className="mt-1 text-sm text-gray-400">Classic Cricket Auction{t && ` · ${t.name}`}</p>
        </header>
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
        {notice && <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-300">{notice}</div>}

        {config && draft && (
          <>
            <Tabs<Tab>
              ariaLabel="Section"
              value={tab}
              onChange={setTab}
              items={[
                { id: "overview", label: "Overview" },
                { id: "auction", label: "Auction" },
                { id: "settings", label: "Settings" },
                { id: "members", label: "Members" },
              ]}
            />

            {tab === "overview" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="font-semibold text-white">Tournament data</h2>
                  {t ? (
                    <p className="mt-2 text-sm text-gray-300">
                      {t.name} ({t.status}) · {t.teams} teams · {t.players} players · {t.fixtures} fixtures, {t.fixturesScored} scored
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-red-300">The tournament is missing.</p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">The superadmin uploads players, fixtures and points{isSuperadmin ? "" : "; ask them when a match needs scoring"}.</p>
                  {isSuperadmin && t && (
                    <Link href={`/superadmin/cricket/${t.id}`} className="mt-3 inline-block text-sm text-green-300 hover:underline">
                      Open tournament data →
                    </Link>
                  )}
                </section>
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="font-semibold text-white">Season</h2>
                  <p className="mt-2 text-sm text-gray-300">
                    {config.completedAt ? `Marked complete on ${new Date(config.completedAt).toLocaleDateString("en-IN")}.` : "In progress. It completes on its own once every match is scored."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/${config.league.slug}/cricket/standings`} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 hover:bg-white/10">
                      Standings
                    </Link>
                    {config.completedAt ? (
                      <button type="button" onClick={() => setComplete(false)} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 hover:bg-white/10">
                        Reopen season
                      </button>
                    ) : (
                      <button type="button" onClick={() => setComplete(true)} className="rounded-lg bg-yellow-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-yellow-400">
                        Mark complete
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}

            {tab === "auction" && (
              <CricketAuctionAdmin
                leagueId={leagueId}
                leagueSlug={config.league.slug}
                franchiseEnabled={config.settings.franchiseAuctionEnabled}
                isSuperadmin={isSuperadmin}
                onChanged={() => setVersion((v) => v + 1)}
              />
            )}

            {tab === "settings" && (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                {config.settingsLocked && (
                  <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    The auction has started, so only the timers can change now.
                  </p>
                )}
                <CricketSettingsForm value={draft} onChange={setDraft} tournamentLocked />
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="mt-5 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </section>
            )}

            {tab === "members" && <MembersTab leagueId={leagueId} />}
          </>
        )}
      </main>
    </div>
  );
}
