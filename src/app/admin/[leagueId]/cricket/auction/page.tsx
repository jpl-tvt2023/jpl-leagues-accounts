"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { FinalResults } from "@/components/auction/FinalResults";
import { LiveFeed } from "@/components/auction/LiveFeed";
import { RoomHeader } from "@/components/auction/RoomHeader";
import { ScheduledCountdown } from "@/components/auction/ScheduledCountdown";
import { SoldMoment } from "@/components/auction/SoldMoment";
import { CRICKET_ROOM_THEME as theme } from "@/components/auction/theme";
import { CricketOrderTable } from "@/components/cricket/auction/CricketOrderTable";
import { LotPanel } from "@/components/cricket/auction/LotPanel";
import type { NomineePick } from "@/components/cricket/auction/NominatePicker";
import { PlayerChips } from "@/components/cricket/auction/PlayerChips";
import { WaitingCard } from "@/components/cricket/auction/WaitingCard";
import { cricketSoldMoment } from "@/components/cricket/auction/outcome-view";
import { useAuctionFeed, useTicker } from "@/components/cricket/auction/useAuctionFeed";
import { useCricketFeed } from "@/components/cricket/auction/useCricketFeed";
import { useCricketLeague } from "@/components/cricket/useCricketLeague";
import { getFormatPalette } from "@/lib/format-palette";
import { formatLakhs } from "@/lib/format/currency";
import { buildCricketFeed } from "@/lib/sports/cricket/auction/feed-view";
import { cricketFinalResults } from "@/lib/sports/cricket/auction/results-view";
import { CRICKET_AUCTION_FORMAT } from "@/lib/sports/registry";
import { SalesCorrections } from "./SalesCorrections";
import { TurnCorrections, type TurnEvent } from "./TurnCorrections";

const CRICKET_BG = getFormatPalette(CRICKET_AUCTION_FORMAT, null).pageBg;
const TYPE_LABEL = { franchise: "Franchise auction", player: "Player auction" } as const;
const secondsUntil = (iso: string | null, at: number) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - at) / 1000)) : 0);
const ctl = "rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-40";
const ctlPrimary = "rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-40";

interface Extras {
  league: { slug: string; name: string };
  sessionId: string | null;
  events: TurnEvent[];
  short: Array<{ teamId: string; name: string; needed: number }>;
}

/**
 * The cricket auction's host room (league admins and the superadmin), like the FPL admin room: run
 * the session, watch the lot and every squad live, correct turns, nominate for a team, undo or move
 * sales. The live state comes from the room's own stream; turn events from a light admin poll.
 */
export default function CricketHostRoomPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reloadExtras = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/${leagueId}/cricket/auction?extras=1`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(body.error ?? "Couldn't load the auction");
        else {
          setLoadError(null);
          setExtras(body);
        }
      } catch {
        if (!cancelled) setLoadError("Couldn't reach the server");
      }
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [leagueId, version]);

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  };

  return (
    <div className={`min-h-screen ${CRICKET_BG}`} data-pull-refresh="off">
      <AppNav
        // The minimal nav only offers a way back out (to the console, by slug once it's known).
        context={{ surface: "admin-league", leagueId: extras?.league.slug ?? leagueId, format: CRICKET_AUCTION_FORMAT, isSuperadminViewer: false, variant: "minimal" }}
        activeKey=""
        brandHref="/admin"
        brandLabel="Host room"
        brandBadge={{ label: "CCA", bgClass: "bg-green-500/20", textClass: "text-green-200" }}
        onSignOut={handleSignOut}
      />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link href={`/admin/${leagueId}/cricket?tab=auction`} className="text-sm text-green-300 hover:underline">
            ← League console
          </Link>
          {extras && (
            <Link href={`/${extras.league.slug}/cricket/auction`} className="text-sm text-gray-400 hover:text-white">
              Managers&apos; room →
            </Link>
          )}
        </div>
        {loadError && !extras ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{loadError}</div>
        ) : !extras ? (
          <LoadingScreen variant="cricket" fullScreen={false} label="Loading the host room" />
        ) : (
          <HostRoom leagueId={leagueId} extras={extras} reloadExtras={reloadExtras} />
        )}
      </div>
    </div>
  );
}

function HostRoom({ leagueId, extras, reloadExtras }: { leagueId: string; extras: Extras; reloadExtras: () => void }) {
  const slug = extras.league.slug;
  const { state, error, connected, refresh, now } = useAuctionFeed(slug);
  const { data: view, reload: reloadView } = useCricketLeague(slug);
  useTicker();
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [picked, setPicked] = useState<NomineePick>(null);

  const cur = state?.current ?? null;
  const saleKey = state ? `${state.sales[0]?.lotId ?? ""}:${cur?.soldCount ?? 0}:${cur?.sessionId ?? ""}:${cur?.status ?? ""}` : null;
  useEffect(() => {
    if (saleKey) reloadView();
  }, [saleKey, reloadView]);
  const penalties = state?.teams.reduce((s, t) => s + t.penaltySlots, 0) ?? 0;
  const feedPayload = useCricketFeed(slug, cur ? `${cur.sessionId}:${cur.soldCount}:${state?.sales[0]?.lotId ?? ""}:${penalties}:${cur.status}` : null);
  // The franchise auction's sales stay correctable during the player auction.
  const otherSession = state?.sessions.find((s) => s.type === "franchise" && s.id !== cur?.sessionId && s.status === "completed") ?? null;
  const otherFeed = useCricketFeed(slug, otherSession ? `${otherSession.id}:${state?.sales[0]?.lotId ?? ""}` : null, otherSession?.id);

  /** Run an admin action; true if it went through. Completing with short squads offers to force it. */
  const act = useCallback(
    async (body: Record<string, unknown>, confirmText?: string): Promise<boolean> => {
      if (confirmText && !confirm(confirmText)) return false;
      setBusy(true);
      setActError(null);
      try {
        const res = await fetch(`/api/admin/${leagueId}/cricket/auction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (body.action === "complete" && res.status === 409 && /short of a full squad/.test(out.error ?? "")) {
            setBusy(false);
            return confirm(`${out.error}\n\nComplete anyway? Squads are then final.`) ? act({ ...body, force: true }) : false;
          }
          setActError(out.error ?? "That didn't work");
        }
        return res.ok;
      } catch {
        setActError("Couldn't reach the server");
        return false;
      } finally {
        setBusy(false);
        refresh();
        reloadExtras();
      }
    },
    [leagueId, refresh, reloadExtras],
  );

  const nameOf = (id: string | null | undefined) => (id ? (state?.teams.find((t) => t.id === id)?.displayName ?? "—") : "—");
  const ownNameOf = (id: string | null | undefined) => (id ? (state?.teams.find((t) => t.id === id)?.name ?? "—") : "—");
  const soldMoment = useMemo(
    () =>
      cricketSoldMoment(cur?.lastOutcome ?? null, {
        nameOf: (id) => (id ? (state?.teams.find((t) => t.id === id)?.displayName ?? "—") : "—"),
        ownNameOf: (id) => (id ? (state?.teams.find((t) => t.id === id)?.name ?? "—") : "—"),
        myTeamId: null,
        money: formatLakhs,
        player: (id) => view?.players.find((p) => p.id === id),
        realTeamCode: (id) => view?.realTeams.find((t) => t.id === id)?.code,
      }),
    [cur?.lastOutcome, state?.teams, view],
  );

  if (!state) return <LoadingScreen variant="cricket" fullScreen={false} label="Loading the host room" />;
  if (!cur) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-gray-300">
        No auction sessions yet. Create them in the{" "}
        <Link href={`/admin/${leagueId}/cricket?tab=auction`} className="text-green-300 hover:underline">
          league console
        </Link>
        .
      </div>
    );
  }

  const clock = cur.status === "paused" && cur.pausedAt ? new Date(cur.pausedAt).getTime() : now();
  const lot = cur.lot;
  const running = cur.status === "active" || cur.status === "paused";
  const done =
    cur.status === "active" && !lot && !cur.intermissionUntil && !cur.nominationDeadline &&
    (cur.type === "franchise" ? state.teams.every((t) => t.franchiseId !== null) : state.teams.every((t) => t.squadSize >= t.cap));
  const feed = buildCricketFeed(feedPayload, lot, { nameOf, ownNameOf, money: formatLakhs });
  const playerFinal = state.sessions.some((s) => s.type === "player" && s.status === "completed");
  const soldOnly = (f: typeof feedPayload) => (f?.lots ?? []).filter((l) => l.status === "sold");
  const label = TYPE_LABEL[cur.type];

  const controls = (
    <div className="flex flex-wrap gap-2">
      {cur.status === "pending" && (
        <button type="button" disabled={busy} className={ctlPrimary} onClick={() => act({ action: "start", sessionId: cur.sessionId }, `Start the ${label.toLowerCase()} now?`)}>
          Start
        </button>
      )}
      {cur.status === "active" && (
        <button type="button" disabled={busy} className={ctl} onClick={() => act({ action: "pause", sessionId: cur.sessionId })}>
          Pause
        </button>
      )}
      {cur.status === "paused" && (
        <button type="button" disabled={busy} className={ctlPrimary} onClick={() => act({ action: "resume", sessionId: cur.sessionId })}>
          Resume
        </button>
      )}
      {running && (
        <button type="button" disabled={busy || !!lot} title={lot ? "Finish or cancel the open lot first" : undefined} className={ctl} onClick={() => act({ action: "complete", sessionId: cur.sessionId }, `Finish the ${label.toLowerCase()}?`)}>
          Complete
        </button>
      )}
    </div>
  );

  return (
    <>
      <RoomHeader
        theme={theme}
        status={cur.status}
        title={`${label} · host room`}
        titleAs="h1"
        subtitle={cur.soldCount > 0 ? `${cur.soldCount} sold` : undefined}
        live={running ? connected : null}
        nominator={running ? (cur.nominatorTeamId ? { name: nameOf(cur.nominatorTeamId), isMe: false } : null) : undefined}
        right={controls}
      />
      <div className="-mt-3 mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
        <span>Bid timer {cur.bidTimerSeconds}s</span>
        <span>Nomination {cur.nominationTimeoutSeconds}s</span>
        <span>Between lots {cur.intermissionSeconds}s</span>
        {cur.type === "player" && extras.short.length > 0 && (
          <span className="text-amber-200">Short of a full squad: {extras.short.map((s) => `${s.name} (${s.needed})`).join(", ")}</span>
        )}
      </div>
      {(actError || error) && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actError ?? error}</div>}

      {running && (
        <TurnCorrections theme={theme} state={state} view={view} events={extras.events} nameOf={nameOf} busy={busy} act={act} picked={picked} onPick={setPicked} />
      )}

      {cur.status === "pending" && (
        <div className="mb-4 rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500/10 to-slate-900/40 p-6 text-center backdrop-blur">
          <div className="mb-2 text-[11px] uppercase tracking-widest text-green-300">{label} — not started</div>
          {cur.scheduledAt ? <ScheduledCountdown scheduledAt={cur.scheduledAt} now={now} /> : <p className="text-sm text-gray-300">No start time set. Press Start when everyone is in.</p>}
        </div>
      )}

      {cur.status === "completed" && view && (
        <FinalResults
          theme={theme}
          teams={cricketFinalResults(view, cur.type).map((t) => ({ ...t, items: t.items.map((i) => ({ ...i, chip: <PlayerChips role={i.role} teamCode={i.teamCode} overseas={i.overseas} /> })) }))}
          formatMoney={formatLakhs}
        />
      )}

      {cur.status !== "completed" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {running && (
            <div className="lg:col-span-3">
              {lot ? (
                <LotPanel theme={theme} state={state} view={view} clock={clock} nameOf={nameOf} slug={slug} refresh={refresh} readOnly ringSize={96} />
              ) : cur.intermissionUntil ? (
                <SoldMoment theme={theme} outcome={soldMoment} secondsLeft={secondsUntil(cur.intermissionUntil, clock)} maxSeconds={Math.max(1, cur.intermissionSeconds)} />
              ) : (
                <WaitingCard
                  theme={theme}
                  what={cur.type === "franchise" ? "franchise" : "player"}
                  nominatorName={cur.nominatorTeamId ? nameOf(cur.nominatorTeamId) : null}
                  myTurn={false}
                  secondsLeft={secondsUntil(cur.nominationDeadline, clock)}
                  maxSeconds={cur.nominationTimeoutSeconds}
                  done={done}
                />
              )}
            </div>
          )}
          <div className={running ? "lg:col-span-2" : "lg:col-span-5"}>
            <CricketOrderTable theme={theme} state={state} view={view} />
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LiveFeed title={cur.status === "completed" ? "Auction log" : "Live Feed"} entries={feed} maxHeightClass="max-h-96" />
        <SalesCorrections
          groups={[
            { title: label, lots: soldOnly(feedPayload) },
            ...(otherSession ? [{ title: TYPE_LABEL.franchise, lots: soldOnly(otherFeed) }] : []),
          ]}
          teams={state.teams.map((t) => ({ id: t.id, name: t.displayName }))}
          nameOf={nameOf}
          busy={busy}
          act={act}
          final={playerFinal}
        />
      </div>
    </>
  );
}
