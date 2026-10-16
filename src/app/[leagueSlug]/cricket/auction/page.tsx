"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/lib/league-context";
import { formatLakhs } from "@/lib/format/currency";
import { AlertToggle } from "@/components/auction/AlertToggle";
import { FinalResults, type ResultTeam } from "@/components/auction/FinalResults";
import { LiveFeed } from "@/components/auction/LiveFeed";
import { RoomHeader } from "@/components/auction/RoomHeader";
import { ScheduledCountdown } from "@/components/auction/ScheduledCountdown";
import { SoldMoment } from "@/components/auction/SoldMoment";
import { CRICKET_ROOM_THEME as theme } from "@/components/auction/theme";
import { useAuctionAlerts } from "@/components/auction/useAuctionAlerts";
import { Tabs } from "@/components/ui/Tabs";
import { CricketOrderTable } from "@/components/cricket/auction/CricketOrderTable";
import { LotPanel } from "@/components/cricket/auction/LotPanel";
import { NominatePicker, type NomineePick } from "@/components/cricket/auction/NominatePicker";
import { PlayerChips } from "@/components/cricket/auction/PlayerChips";
import { WaitingCard } from "@/components/cricket/auction/WaitingCard";
import { WishlistTab } from "@/components/cricket/auction/WishlistTab";
import { cricketSoldMoment } from "@/components/cricket/auction/outcome-view";
import { useAuctionFeed, useTicker, type RoomState } from "@/components/cricket/auction/useAuctionFeed";
import { useCricketFeed } from "@/components/cricket/auction/useCricketFeed";
import { useCricketWishlist } from "@/components/cricket/auction/useCricketWishlist";
import { useCricketLeague } from "@/components/cricket/useCricketLeague";
import { buildCricketFeed } from "@/lib/sports/cricket/auction/feed-view";
import { cricketFinalResults } from "@/lib/sports/cricket/auction/results-view";
import type { LeagueView } from "@/lib/sports/cricket/league";
import { CricketShell, Card } from "../_components/CricketShell";

const TYPE_LABEL = { franchise: "Franchise auction", player: "Player auction" } as const;

const secondsUntil = (iso: string | null, at: number) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - at) / 1000)) : 0);

/** The league view's results for a session type, as FinalResults cards (chips for players). */
function resultCards(view: LeagueView, type: "franchise" | "player", myTeamId: string | null): ResultTeam[] {
  return cricketFinalResults(view, type).map((t) => ({
    ...t,
    isMe: t.id === myTeamId,
    items: t.items.map((i) => ({ ...i, chip: <PlayerChips role={i.role} teamCode={i.teamCode} overseas={i.overseas} /> })),
  }));
}

/**
 * The cricket auction room, laid out like the FPL room: the header (status, live, whose turn, your
 * purse, alerts), your purse strip, then the lot — or the SOLD moment between lots, or the turn
 * card — beside the nomination order and squads; then your Wishlist / Nominate tabs beside the live
 * feed. Before it starts: a countdown; once it's over: the final results.
 */
export default function CricketAuctionRoomPage() {
  const { league } = useLeague();
  const slug = league.slug;
  const { state, error, connected, refresh, now } = useAuctionFeed(slug);
  const { data: view, reload: reloadView } = useCricketLeague(slug);
  useTicker();

  const cur = state?.current ?? null;
  const myTeamId = state?.myTeamId ?? null;
  const me = state?.teams.find((t) => t.id === myTeamId) ?? null;

  // The league view knows every player and squad; refresh it when something sells or the session changes.
  const saleKey = state ? `${state.sales[0]?.lotId ?? ""}:${cur?.soldCount ?? 0}:${cur?.sessionId ?? ""}:${cur?.status ?? ""}` : null;
  useEffect(() => {
    if (saleKey) reloadView();
  }, [saleKey, reloadView]);

  const wishlist = useCricketWishlist(slug, !!myTeamId);
  const penalties = state?.teams.reduce((s, t) => s + t.penaltySlots, 0) ?? 0;
  const feedPayload = useCricketFeed(slug, cur ? `${cur.sessionId}:${cur.soldCount}:${state?.sales[0]?.lotId ?? ""}:${penalties}:${cur.status}` : null);

  // Countdowns freeze while paused (the deadlines move on when it resumes).
  const clock = cur?.status === "paused" && cur.pausedAt ? new Date(cur.pausedAt).getTime() : now();
  const nameOf = (id: string | null | undefined) => (id ? (state?.teams.find((t) => t.id === id)?.displayName ?? "—") : "—");

  const lot = cur?.lot ?? null;
  const running = cur?.status === "active" || cur?.status === "paused";
  const pauseLeft = cur && !lot ? secondsUntil(cur.intermissionUntil, clock) : 0;
  const nominationLeft = cur && !lot ? secondsUntil(cur.nominationDeadline, clock) : 0;
  const myTurn = !!me && cur?.status === "active" && !lot && !cur.intermissionUntil && cur.nominatorTeamId === me.id && !!cur.nominationDeadline;
  const alerts = useAuctionAlerts({ myTurn, lotKey: lot?.id ?? null, leaderIsMe: !!me && lot?.currentHighBidderId === me.id, lotName: lot?.name ?? null }, { enabled: !!myTeamId });

  // Nomination: pick any time, nominate on your turn.
  const [picked, setPicked] = useState<NomineePick>(null);
  const [nominating, setNominating] = useState(false);
  const [nominateError, setNominateError] = useState<string | null>(null);
  const [tab, setTab] = useState<"wishlist" | "nominate">("nominate");
  const tabsRef = useRef<HTMLDivElement>(null);
  const stillAvailable =
    !picked || (picked.kind === "player" ? !!view?.players.find((p) => p.id === picked.id && !p.ownerTeamId) : !!state?.franchises.find((f) => f.id === picked.id && !f.ownerTeamId));
  const pick = stillAvailable && picked?.kind === (cur?.type === "franchise" ? "franchise" : "player") ? picked : null;

  const nominate = async () => {
    if (!pick) return;
    setNominating(true);
    setNominateError(null);
    try {
      const res = await fetch("/api/cricket/auction/nominate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: slug, ...(pick.kind === "player" ? { playerId: pick.id } : { cricketTeamId: pick.id }) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setNominateError(body.error ?? "Couldn't nominate");
      else setPicked(null);
    } catch {
      setNominateError("Couldn't reach the server");
    } finally {
      setNominating(false);
      refresh();
    }
  };

  const blockedReason = !me
    ? null
    : cur?.status !== "active"
      ? "The auction isn't running."
      : lot
        ? "A lot is open — nominate when it's your turn."
        : cur.intermissionUntil
          ? "The next turn starts in a moment."
          : !myTurn
            ? `It's ${nameOf(cur.nominatorTeamId)}'s turn.`
            : null;

  const soldMoment = useMemo(
    () =>
      cricketSoldMoment(cur?.lastOutcome ?? null, {
        nameOf: (id) => (id ? (state?.teams.find((t) => t.id === id)?.displayName ?? "—") : "—"),
        ownNameOf: (id) => (id ? (state?.teams.find((t) => t.id === id)?.name ?? "—") : "—"),
        myTeamId,
        money: formatLakhs,
        player: (id) => view?.players.find((p) => p.id === id),
        realTeamCode: (id) => view?.realTeams.find((t) => t.id === id)?.code,
      }),
    [cur?.lastOutcome, state?.teams, myTeamId, view],
  );
  const ownNameOf = (id: string | null | undefined) => (id ? (state?.teams.find((t) => t.id === id)?.name ?? "—") : "—");
  const feed = buildCricketFeed(feedPayload, lot, { nameOf, ownNameOf, money: formatLakhs });
  const franchiseDone = state?.sessions.some((s) => s.type === "franchise" && s.status === "completed") ?? false;
  const done =
    !!state && !!cur && cur.status === "active" && !lot && !cur.intermissionUntil && !cur.nominationDeadline &&
    (cur.type === "franchise" ? state.teams.every((t) => t.franchiseId !== null) : state.teams.every((t) => t.squadSize >= t.cap));
  const showTabs = !!me && !!view && cur?.status !== "completed";

  return (
    <CricketShell currentPage="auction" title={cur ? undefined : "Auction"} loading={!state} error={error} maxWidth="7xl" hideBottomNav>
      {state && !cur && (
        <Card>
          <p className="text-sm text-gray-300">The auction hasn&apos;t been set up yet. Your league admin schedules it.</p>
        </Card>
      )}
      {state && cur && (
        <>
          <RoomHeader
            theme={theme}
            status={cur.status}
            title={TYPE_LABEL[cur.type]}
            titleAs="h1"
            subtitle={cur.soldCount > 0 ? `${cur.soldCount} sold` : undefined}
            live={running ? connected : null}
            nominator={running ? (cur.nominatorTeamId ? { name: nameOf(cur.nominatorTeamId), isMe: cur.nominatorTeamId === myTeamId } : null) : undefined}
            purse={me ? { label: "Your purse", value: formatLakhs(me.purse) } : null}
            right={myTeamId ? <AlertToggle muted={alerts.muted} onToggle={alerts.toggleMuted} /> : undefined}
          />

          {me && cur.status !== "completed" && <MyStrip state={state} slug={slug} redeemPrice={view?.config.penaltyRedeemPrice ?? null} refresh={refresh} />}

          {cur.status === "paused" && (
            <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-center text-sm text-yellow-300">Auction paused by the admin — timers resume where they stopped.</div>
          )}

          {cur.status === "pending" && (
            <>
              <div className="mb-4 rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500/10 to-slate-900/40 p-6 text-center backdrop-blur">
                <div className="mb-2 text-[11px] uppercase tracking-widest text-green-300">{TYPE_LABEL[cur.type]} scheduled</div>
                {cur.scheduledAt ? (
                  <>
                    <ScheduledCountdown scheduledAt={cur.scheduledAt} now={now} />
                    <div className="mt-2 text-xs text-gray-400">Starts {new Date(cur.scheduledAt).toLocaleString([], { dateStyle: "full", timeStyle: "short" })}</div>
                  </>
                ) : (
                  <>
                    <h2 className="mb-1 text-2xl font-bold text-white">Awaiting start</h2>
                    <p className="text-sm text-gray-400">Your league admin starts it. Build your wishlist in the meantime.</p>
                  </>
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-gray-400">
                  <span>Bid timer: {cur.bidTimerSeconds}s</span>
                  <span>Nomination timeout: {cur.nominationTimeoutSeconds}s</span>
                  <span>Between lots: {cur.intermissionSeconds}s</span>
                  <span>{state.teams.length} teams</span>
                </div>
              </div>
              {cur.type === "player" && franchiseDone && view && <FinalResults theme={theme} title="Franchise auction results" teams={resultCards(view, "franchise", myTeamId)} formatMoney={formatLakhs} />}
            </>
          )}

          {cur.status === "completed" && view && <FinalResults theme={theme} teams={resultCards(view, cur.type, myTeamId)} formatMoney={formatLakhs} />}

          {running && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <div className="lg:col-span-3">
                {lot ? (
                  <LotPanel
                    theme={theme}
                    state={state}
                    view={view}
                    clock={clock}
                    nameOf={nameOf}
                    slug={slug}
                    refresh={refresh}
                    outbid={alerts.lastAlert?.kind === "outbid" && alerts.lastAlert.lot === lot.id}
                    wishlist={me ? wishlist : undefined}
                  />
                ) : cur.intermissionUntil ? (
                  <SoldMoment theme={theme} outcome={soldMoment} secondsLeft={pauseLeft} maxSeconds={Math.max(1, cur.intermissionSeconds)} />
                ) : (
                  <WaitingCard
                    theme={theme}
                    what={cur.type === "franchise" ? "franchise" : "player"}
                    nominatorName={cur.nominatorTeamId ? nameOf(cur.nominatorTeamId) : null}
                    myTurn={myTurn}
                    secondsLeft={nominationLeft}
                    maxSeconds={cur.nominationTimeoutSeconds}
                    done={done}
                    picked={pick?.name ?? null}
                    ctaDisabled={nominating}
                    onCta={() => {
                      if (pick) void nominate();
                      else {
                        setTab("nominate");
                        tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                    }}
                  />
                )}
              </div>
              <div className="lg:col-span-2">
                <CricketOrderTable theme={theme} state={state} view={view} />
              </div>
            </div>
          )}
          {cur.status === "pending" && <CricketOrderTable theme={theme} state={state} view={view} />}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
            {showTabs && (
              <div ref={tabsRef} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur lg:col-span-2">
                <Tabs
                  ariaLabel="Your auction tools"
                  value={cur.type === "franchise" ? "nominate" : tab}
                  onChange={setTab}
                  accentClass={theme.tabActive}
                  className="mb-3"
                  items={cur.type === "franchise" ? [{ id: "nominate" as const, label: "Nominate" }] : [{ id: "wishlist" as const, label: "Wishlist" }, { id: "nominate" as const, label: "Nominate" }]}
                />
                {cur.type === "player" && tab === "wishlist" ? (
                  <WishlistTab view={view!} wishlist={wishlist} />
                ) : (
                  <NominatePicker
                    theme={theme}
                    state={state}
                    view={view!}
                    mode="team"
                    picked={pick}
                    onPick={setPicked}
                    onNominate={nominate}
                    busy={nominating}
                    canNominate={myTurn}
                    blockedReason={blockedReason}
                    wishlist={cur.type === "player" ? wishlist : undefined}
                    error={nominateError}
                  />
                )}
              </div>
            )}
            <LiveFeed
              title={cur.status === "completed" ? "Auction log" : "Live Feed"}
              entries={feed}
              emptyText={cur.status === "pending" ? "Nothing yet — the feed starts with the first nomination" : "No activity yet"}
              className={showTabs ? "lg:col-span-3" : "lg:col-span-5"}
              maxHeightClass={showTabs ? "max-h-96" : "max-h-[32rem]"}
            />
          </div>
          {myTeamId && <p className="mt-3 text-center text-[11px] text-gray-500">Alerts sound and flash this tab while the room is open; phones pause them when the browser is in the background.</p>}
        </>
      )}
    </CricketShell>
  );
}

/** Your purse, squad and how much you may bid; redeem a penalty slot. */
function MyStrip({ state, slug, redeemPrice, refresh }: { state: RoomState; slug: string; redeemPrice: number | null; refresh: () => void }) {
  const me = state.teams.find((t) => t.id === state.myTeamId)!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const redeem = async () => {
    if (!confirm(`Redeem a penalty slot${redeemPrice != null ? ` for ${formatLakhs(redeemPrice)}` : ""}? This can't be undone.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cricket/auction/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ league: slug }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(body.error ?? "Couldn't redeem");
    } catch {
      setMsg("Couldn't reach the server");
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm backdrop-blur">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-gray-300">
        <span>
          Purse <span className="font-mono font-semibold text-green-300">{formatLakhs(me.purse)}</span>
        </span>
        <span>
          Squad{" "}
          <span className="font-semibold text-white">
            {me.squadSize}/{me.cap}
          </span>
        </span>
        <span>
          You can bid up to <span className="font-mono font-semibold text-white">{formatLakhs(me.maxBid)}</span>
        </span>
      </div>
      {me.penaltySlots > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-red-300">
            {me.penaltySlots} penalty slot{me.penaltySlots === 1 ? "" : "s"}
          </span>
          <button type="button" disabled={busy} onClick={redeem} className="rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">
            Redeem one{redeemPrice != null && ` (${formatLakhs(redeemPrice)})`}
          </button>
        </div>
      )}
      {msg && <p className="w-full text-xs text-red-300">{msg}</p>}
    </div>
  );
}
