"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeague } from "@/lib/league-context";
import { formatLakhs } from "@/lib/format/currency";
import { formatIst } from "@/lib/sports/cricket/sheets/ist";
import { bidStep } from "@/lib/sports/cricket/auction/rules";
import { AuctionTimerRing } from "@/components/AuctionTimerRing";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { indexView, ROLE_STYLE } from "../_components/view-helpers";
import { useAuctionFeed, useTicker, type RoomState } from "./useAuctionFeed";
import { WishlistPanel } from "./WishlistPanel";

const TYPE_LABEL = { franchise: "Franchise auction", player: "Player auction" } as const;
const STATUS_LABEL = { pending: "Not started", active: "Live", paused: "Paused", completed: "Finished" } as const;

function secondsLeft(iso: string | null, now: number): number {
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0;
}

export default function CricketAuctionRoomPage() {
  const { league } = useLeague();
  const { state, error, connected, refresh, now } = useAuctionFeed(league.slug);
  const { data: view, reload: reloadView } = useCricketLeague(league.slug);
  useTicker();
  const t = now();

  // The league view names teams after their franchise and knows every player; refresh it whenever
  // something sells so names and squads stay current.
  const lastSale = state?.sales[0]?.lotId;
  useEffect(() => {
    if (lastSale) reloadView();
  }, [lastSale, reloadView]);

  const idx = useMemo(() => (view ? indexView(view) : null), [view]);
  const teamName = (id: string | null | undefined) => (id ? idx?.team.get(id)?.name ?? state?.teams.find((x) => x.id === id)?.name ?? "—" : "—");
  const cur = state?.current ?? null;
  const me = state?.teams.find((x) => x.id === state.myTeamId) ?? null;

  return (
    <CricketShell
      currentPage="auction"
      title="Auction"
      subtitle={cur && <>{TYPE_LABEL[cur.type]} · {STATUS_LABEL[cur.status]}{!connected && cur.status === "active" && " · reconnecting…"}</>}
      loading={!state}
      error={error}
      wide
    >
      {state && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {me && <MyBar state={state} refresh={refresh} slug={league.slug} />}
            {!cur && (
              <Card>
                <p className="text-sm text-gray-300">The auction hasn&apos;t been set up yet. Your league admin schedules it.</p>
              </Card>
            )}
            {cur?.status === "pending" && (
              <Card>
                <p className="text-sm text-gray-300">
                  {TYPE_LABEL[cur.type]} {state.sessions.find((s) => s.id === cur.sessionId)?.scheduledAt ? `starts ${formatIst(new Date(state.sessions.find((s) => s.id === cur.sessionId)!.scheduledAt!))} IST` : "hasn't been scheduled yet"}.
                  Build your wishlist below in the meantime.
                </p>
              </Card>
            )}
            {cur?.status === "completed" && (
              <Card>
                <p className="text-sm text-gray-300">The {TYPE_LABEL[cur.type].toLowerCase()} is finished.</p>
              </Card>
            )}
            {cur && (cur.status === "active" || cur.status === "paused") && (
              <>
                {cur.status === "paused" && (
                  <Card className="border-amber-500/40 bg-amber-500/10">
                    <p className="text-sm text-amber-200">Paused by the admin. Timers resume where they stopped.</p>
                  </Card>
                )}
                {cur.lot ? (
                  <LotCard state={state} now={t} teamName={teamName} slug={league.slug} refresh={refresh} />
                ) : cur.intermissionUntil ? (
                  <Card className="text-center">
                    <p className="text-sm text-gray-400">Next nomination in</p>
                    <p className="text-3xl font-bold text-white">{secondsLeft(cur.intermissionUntil, t)}s</p>
                  </Card>
                ) : (
                  <Card>
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-gray-300">
                        {cur.nominatorTeamId === state.myTeamId ? (
                          <span className="font-semibold text-green-300">Your turn to nominate</span>
                        ) : (
                          <>
                            Waiting for <span className="font-semibold text-white">{teamName(cur.nominatorTeamId)}</span> to nominate
                          </>
                        )}
                      </p>
                      {cur.nominationDeadline && <AuctionTimerRing seconds={secondsLeft(cur.nominationDeadline, t)} max={60} size={64} stroke={6} />}
                    </div>
                    {cur.nominatorTeamId === state.myTeamId && cur.status === "active" && view && (
                      <NominatePanel state={state} view={view} slug={league.slug} refresh={refresh} />
                    )}
                  </Card>
                )}
              </>
            )}
            {cur?.type !== "franchise" && state.myTeamId && view && <WishlistPanel slug={league.slug} view={view} />}
          </div>

          <div className="space-y-4">
            <Card className="p-0 sm:p-0">
              <h2 className="px-4 pt-4 text-sm font-semibold text-white">Teams</h2>
              <ul className="mt-2 divide-y divide-white/5 text-sm">
                {state.teams.map((team) => {
                  const isNominator = cur?.nominatorTeamId === team.id;
                  const fr = team.franchiseId ? state.franchises.find((f) => f.id === team.franchiseId) : null;
                  return (
                    <li key={team.id} className={`flex items-center justify-between gap-2 px-4 py-2 ${isNominator ? "bg-green-500/10" : ""} ${team.id === state.myTeamId ? "font-semibold" : ""}`}>
                      <span className="truncate text-gray-200">
                        {isNominator && "▶ "}
                        {teamName(team.id)}
                        {fr && <span className="ml-1 text-xs text-gray-500">{fr.code}</span>}
                      </span>
                      <span className="whitespace-nowrap text-xs text-gray-400">
                        {formatLakhs(team.purse)} · {team.squadSize}/{team.cap}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
            {cur?.type === "franchise" && (
              <Card className="p-0 sm:p-0">
                <h2 className="px-4 pt-4 text-sm font-semibold text-white">Franchises</h2>
                <ul className="mt-2 divide-y divide-white/5 text-sm">
                  {state.franchises.map((f) => (
                    <li key={f.id} className="flex justify-between px-4 py-2">
                      <span className="text-gray-200">
                        {f.code} <span className="text-xs text-gray-500">{f.name}</span>
                      </span>
                      <span className="text-xs text-gray-400">{f.ownerTeamId ? teamName(f.ownerTeamId) : `opens ${formatLakhs(f.openingPrice)}`}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card className="p-0 sm:p-0">
              <h2 className="px-4 pt-4 text-sm font-semibold text-white">Recent sales</h2>
              {state.sales.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400">Nothing sold yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-white/5 text-sm">
                  {state.sales.map((s) => (
                    <li key={s.lotId} className="flex justify-between gap-2 px-4 py-2">
                      <span className="truncate text-gray-200">
                        {s.name} <span className="text-xs text-gray-500">→ {teamName(s.teamId)}</span>
                      </span>
                      <span className="whitespace-nowrap text-gray-300">{formatLakhs(s.price)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </CricketShell>
  );
}

function MyBar({ state, refresh, slug }: { state: RoomState; refresh: () => void; slug: string }) {
  const me = state.teams.find((x) => x.id === state.myTeamId)!;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const redeem = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/cricket/auction/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ league: slug }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMsg(body.error ?? "Couldn't redeem");
    refresh();
  };
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-gray-300">
        Purse <span className="font-semibold text-white">{formatLakhs(me.purse)}</span> · Squad{" "}
        <span className="font-semibold text-white">
          {me.squadSize}/{me.cap}
        </span>{" "}
        · You can bid up to <span className="font-semibold text-white">{formatLakhs(me.maxBid)}</span>
      </div>
      {me.penaltySlots > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-red-300">{me.penaltySlots} penalty slot(s)</span>
          <button type="button" disabled={busy} onClick={redeem} className="rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">
            Redeem one
          </button>
        </div>
      )}
      {msg && <p className="w-full text-xs text-red-300">{msg}</p>}
    </Card>
  );
}

function LotCard({ state, now, teamName, slug, refresh }: { state: RoomState; now: number; teamName: (id: string) => string; slug: string; refresh: () => void }) {
  const cur = state.current!;
  const lot = cur.lot!;
  const me = state.teams.find((x) => x.id === state.myTeamId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const left = secondsLeft(lot.expiresAt, now);
  const amounts = [lot.nextMinBid, lot.nextMinBid + bidStep(lot.nextMinBid), lot.nextMinBid + bidStep(lot.nextMinBid) * 3];
  const mineHigh = lot.currentHighBidderId === state.myTeamId;

  const bid = async (amount: number) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/cricket/auction/bid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ league: slug, lotId: lot.id, amount }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMsg(body.error ?? "Bid refused");
    else setCustom("");
    refresh();
  };

  return (
    <Card className="border-green-400/30">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">
            Lot {lot.lotNumber} · {lot.kind === "franchise" ? "Franchise" : "Player"} · nominated by {teamName(lot.nominatorTeamId)}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-white">{lot.name}</h2>
          <p className="mt-1 text-sm text-gray-400">Opened at {formatLakhs(lot.openingPrice)}</p>
          <p className="mt-3 text-3xl font-extrabold text-green-300">{formatLakhs(lot.currentHighBid)}</p>
          <p className={`text-sm ${mineHigh ? "font-semibold text-green-200" : "text-gray-300"}`}>{mineHigh ? "You're the highest bidder" : `Highest: ${teamName(lot.currentHighBidderId)}`}</p>
        </div>
        <AuctionTimerRing seconds={left} max={cur.bidTimerSeconds} />
      </div>
      {me && cur.status === "active" && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            {amounts.map((a) => (
              <button
                key={a}
                type="button"
                disabled={busy || mineHigh || !me.canBid || a > me.maxBid}
                onClick={() => bid(a)}
                className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-40"
              >
                Bid {formatLakhs(a)}
              </button>
            ))}
            <input
              type="number"
              value={custom}
              step={bidStep(lot.nextMinBid)}
              min={lot.nextMinBid}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Lakhs"
              className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              disabled={busy || mineHigh || !custom}
              onClick={() => bid(Number(custom))}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-40"
            >
              Bid
            </button>
          </div>
          {!me.canBid && !mineHigh && <p className="text-xs text-gray-400">You can&apos;t take this lot (squad rules or purse).</p>}
          {msg && <p className="text-xs text-red-300">{msg}</p>}
        </div>
      )}
    </Card>
  );
}

function NominatePanel({ state, view, slug, refresh }: { state: RoomState; view: NonNullable<ReturnType<typeof useCricketLeague>["data"]>; slug: string; refresh: () => void }) {
  const cur = state.current!;
  const me = state.teams.find((x) => x.id === state.myTeamId)!;
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const idx = indexView(view);

  const nominate = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/cricket/auction/nominate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ league: slug, ...body }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMsg(out.error ?? "Couldn't nominate");
    refresh();
  };

  if (cur.type === "franchise") {
    return (
      <div className="mt-4 space-y-2">
        <p className="text-xs text-gray-400">Pick a franchise. You open the bidding at its price.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {state.franchises
            .filter((f) => !f.ownerTeamId)
            .map((f) => (
              <button
                key={f.id}
                type="button"
                disabled={busy || f.openingPrice > me.maxBid}
                onClick={() => nominate({ cricketTeamId: f.id })}
                className="flex justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-40"
              >
                <span className="text-white">{f.name}</span>
                <span className="text-gray-400">{formatLakhs(f.openingPrice)}</span>
              </button>
            ))}
        </div>
        {msg && <p className="text-xs text-red-300">{msg}</p>}
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const options = view.players
    .filter((p) => !p.ownerTeamId)
    .filter((p) => (!needle || p.name.toLowerCase().includes(needle)) && (!role || p.role === role))
    .sort((a, b) => b.points - a.points || b.basePrice - a.basePrice)
    .slice(0, 60);
  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" className="min-w-[10rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" aria-label="Role">
          <option value="">All roles</option>
          {["WK", "BAT", "AR", "BOWL"].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <ul className="max-h-80 divide-y divide-white/5 overflow-auto rounded-lg border border-white/10 text-sm">
        {options.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={busy || p.basePrice > me.maxBid}
              onClick={() => nominate({ playerId: p.id })}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/10 disabled:opacity-40"
            >
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 text-[10px] font-semibold ${ROLE_STYLE[p.role]}`}>{p.role}</span>
                <span className="text-white">{p.name}</span>
                <span className="text-xs text-gray-500">{idx.realTeam.get(p.teamId)?.code}</span>
                {p.overseas && <span className="text-xs text-sky-300">✈</span>}
              </span>
              <span className="text-gray-400">{formatLakhs(p.basePrice)}</span>
            </button>
          </li>
        ))}
      </ul>
      {msg && <p className="text-xs text-red-300">{msg}</p>}
    </div>
  );
}
