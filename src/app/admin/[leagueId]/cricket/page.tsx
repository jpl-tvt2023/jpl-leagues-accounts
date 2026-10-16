"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { CricketSettingsForm } from "@/components/cricket/CricketSettingsForm";
import { CRICKET_AUCTION_FORMAT } from "@/lib/sports/registry";
import { getFormatPalette } from "@/lib/format-palette";
import type { CricketLeagueSettings } from "@/lib/sports/cricket/league-settings";
import { MembersTab } from "../MembersTab";
import { FeedbackTab } from "../FeedbackTab";
import { CricketAuctionAdmin } from "./CricketAuctionAdmin";
import { CricketManagersTab } from "./CricketManagersTab";
import { CricketBackupTab } from "./CricketBackupTab";
import { CricketFinanceTab } from "./CricketFinanceTab";

// Same sections, order and look as the FPL auction console (admin/[leagueId]/page.tsx).
type Tab = "managers" | "members" | "backup" | "scoring" | "auction" | "finance" | "settings" | "feedback";
const TABS: { id: Tab; label: string }[] = [
  { id: "managers", label: "Manager Management" },
  { id: "members", label: "Members" },
  { id: "backup", label: "Backup" },
  { id: "scoring", label: "Scoring" },
  { id: "auction", label: "Auction" },
  { id: "finance", label: "Finance" },
  { id: "settings", label: "Settings" },
  { id: "feedback", label: "Feedback" },
];

interface ConfigPayload {
  league: { id: string; slug: string; name: string; season: string; teamSize: number };
  tournament: {
    id: string;
    name: string;
    kind: "league" | "window";
    status: string;
    teams: number;
    players: number;
    fixtures: number;
    playoffFixtures: number;
    fixturesScored: number;
  } | null;
  settings: CricketLeagueSettings;
  completedAt: string | null;
  settingsLocked: boolean;
}

type Message = { type: "success" | "error"; text: string };

/** League admin console for a Classic Cricket Auction league, laid out like the FPL console. */
/** The cricket palette's page background (the console matches the league's own pages). */
const CRICKET_BG = getFormatPalette(CRICKET_AUCTION_FORMAT, null).pageBg;

export default function CricketAdminPage() {
  // useSearchParams (the ?tab= the host room links back with) needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingScreen variant="cricket" bgClass={CRICKET_BG} label="Loading the league console" />}>
      <CricketAdminConsole />
    </Suspense>
  );
}

function CricketAdminConsole() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const requestedTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => t.id === requestedTab)?.id ?? "managers");
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [draft, setDraft] = useState<CricketLeagueSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [version, setVersion] = useState(0);
  const onMessage = useCallback((m: Message) => setMessage(m), []);

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
        setLoadError(body.error ?? "Couldn't load the league");
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
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/${leagueId}/cricket/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) setMessage({ type: "error", text: body.error ?? "Couldn't save" });
      else {
        setConfig(body);
        setDraft(body.settings);
        setMessage({ type: "success", text: "Settings saved." });
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
    if (res.ok) {
      setMessage({ type: "success", text: complete ? "Season marked complete." : "Season reopened." });
      setVersion((v) => v + 1);
    }
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  };

  if (!config && !loadError) return <LoadingScreen variant="cricket" bgClass={CRICKET_BG} label="Loading the league console" />;

  const t = config?.tournament;
  return (
    <div className={`min-h-screen ${CRICKET_BG}`}>
      <AppNav
        context={{ surface: "admin-league", leagueId, format: CRICKET_AUCTION_FORMAT, isSuperadminViewer: isSuperadmin, variant: "full" }}
        activeKey="admin-dashboard"
        brandHref="/admin"
        brandLabel="Admin Dashboard"
        brandBadge={{ label: "CCA", bgClass: "bg-green-500/20", textClass: "text-green-200" }}
        onSignOut={handleSignOut}
      />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{config?.league.name ?? leagueId}</h1>
          <p className="mt-1 text-sm text-gray-400">Classic Cricket Auction{t && ` · ${t.name}`}</p>
        </header>
        {loadError && <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-400">{loadError}</div>}

        {config && draft && (
          <>
            {/* Tabs */}
            <div className="mb-8 border-b border-white/10 pb-4">
              <div role="group" aria-label="Section" className="flex flex-wrap gap-2 sm:gap-4">
                {TABS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={tab === x.id}
                    onClick={() => {
                      setTab(x.id);
                      setMessage(null);
                    }}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition sm:px-4 sm:text-base ${
                      tab === x.id ? "bg-green-500 text-slate-900" : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Global message */}
            {message && (
              <div className={`mb-6 rounded-lg p-4 ${message.type === "success" ? "border border-green-500/30 bg-green-500/10 text-green-400" : "border border-red-500/30 bg-red-500/10 text-red-400"}`}>
                <p>{message.text}</p>
              </div>
            )}

            {tab === "managers" && <CricketManagersTab key={version} leagueId={leagueId} onMessage={onMessage} />}

            {tab === "members" && <MembersTab leagueId={leagueId} />}

            {tab === "backup" && (
              <CricketBackupTab leagueId={leagueId} leagueSlug={config.league.slug} onMessage={onMessage} onRestored={() => setVersion((v) => v + 1)} />
            )}

            {tab === "scoring" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="font-semibold text-white">Tournament data</h2>
                  {t ? (
                    <p className="mt-2 text-sm text-gray-300">
                      {t.name} ({t.status}) · {t.teams} teams · {t.players} players · {t.fixtures} fixtures
                      {t.playoffFixtures > 0 && ` (${t.playoffFixtures} playoffs)`}, {t.fixturesScored} scored
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-red-300">The tournament is missing.</p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    The superadmin uploads players, fixtures and points{isSuperadmin ? "" : "; ask them when a match needs scoring"}. Scores update the
                    standings as soon as they&apos;re uploaded.
                  </p>
                  {isSuperadmin && t && (
                    <Link href={`/superadmin/cricket/${t.id}`} className="mt-3 inline-block text-sm text-green-300 hover:underline">
                      Open tournament data →
                    </Link>
                  )}
                </section>
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="font-semibold text-white">Standings</h2>
                  <p className="mt-2 text-sm text-gray-300">
                    {config.completedAt ? `The season was marked complete on ${new Date(config.completedAt).toLocaleDateString("en-IN")}.` : "In progress."}
                  </p>
                  <Link
                    href={`/${config.league.slug}/cricket/standings`}
                    className="mt-3 inline-block rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
                  >
                    Open standings
                  </Link>
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

            {tab === "finance" && <CricketFinanceTab key={version} leagueId={leagueId} />}

            {tab === "settings" && (
              <div className="space-y-4">
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
                    className="mt-5 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save settings"}
                  </button>
                </section>
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <h2 className="font-semibold text-white">Season</h2>
                  <p className="mt-2 text-sm text-gray-300">
                    {config.completedAt
                      ? `Marked complete on ${new Date(config.completedAt).toLocaleDateString("en-IN")}.`
                      : "In progress. It completes on its own once every match is scored, or mark it complete here."}
                  </p>
                  <div className="mt-3">
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

            {tab === "feedback" && <FeedbackTab endpoint={`/api/admin/${leagueId}/feedback`} scopeLabel="this league" />}
          </>
        )}
      </div>
    </div>
  );
}
