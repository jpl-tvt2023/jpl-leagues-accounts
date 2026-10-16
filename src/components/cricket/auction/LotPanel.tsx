"use client";

import { useState } from "react";
import { LotStage } from "@/components/auction/LotStage";
import type { RoomTheme } from "@/components/auction/theme";
import { formatLakhs } from "@/lib/format/currency";
import { bidStep, jumpBids } from "@/lib/sports/cricket/auction/rules";
import type { LeagueView } from "@/lib/sports/cricket/league";
import type { RoomState } from "./useAuctionFeed";
import type { CricketWishlist } from "./useCricketWishlist";
import { PlayerChips } from "./PlayerChips";

const secondsUntil = (iso: string, at: number) => Math.max(0, Math.ceil((new Date(iso).getTime() - at) / 1000));

/**
 * The open lot. For a manager: quick bids on the ladder (next bid, +1 step, +3 steps), a custom
 * amount checked against what they may bid, the shortlist star, and an "outbid" banner. For the
 * host (`readOnly`) the same card without controls.
 */
export function LotPanel({
  theme,
  state,
  view,
  clock,
  nameOf,
  slug,
  refresh,
  readOnly,
  outbid,
  wishlist,
  ringSize,
}: {
  theme: RoomTheme;
  state: RoomState;
  view: LeagueView | null;
  /** Server time now (or the pause moment while paused), ms. */
  clock: number;
  nameOf: (teamId: string | null | undefined) => string;
  slug: string;
  refresh: () => void;
  readOnly?: boolean;
  /** Show the "you've been outbid" banner. */
  outbid?: boolean;
  wishlist?: CricketWishlist;
  ringSize?: number;
}) {
  const cur = state.current!;
  const lot = cur.lot!;
  const me = readOnly ? null : (state.teams.find((t) => t.id === state.myTeamId) ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const seconds = secondsUntil(lot.expiresAt, clock);
  const mineHigh = !!me && lot.currentHighBidderId === me.id;
  const player = lot.playerId != null ? view?.players.find((p) => p.id === lot.playerId) : undefined;
  const franchise = lot.cricketTeamId != null ? state.franchises.find((f) => f.id === lot.cricketTeamId) : undefined;
  const code = (id: number) => view?.realTeams.find((t) => t.id === id)?.code;

  const bid = async (amount: number) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/cricket/auction/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: slug, lotId: lot.id, amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(body.error ?? "Bid refused");
      else setCustom("");
    } catch {
      setMsg("Couldn't reach the server");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  // A custom amount: whole lakhs, at least the next bid, within what you may bid.
  const customAmount = Number(custom);
  const customProblem = !custom
    ? null
    : !Number.isInteger(customAmount)
      ? "Whole lakhs only"
      : customAmount < lot.nextMinBid
        ? `At least ${formatLakhs(lot.nextMinBid)}`
        : me && customAmount > me.maxBid
          ? `You can bid up to ${formatLakhs(me.maxBid)}`
          : null;

  let footer = null;
  if (me && cur.status === "active") {
    if (mineHigh) {
      footer = (
        <div className="rounded-lg border border-white/20 bg-white/5 py-2 text-center text-xs font-semibold text-green-200">
          You&apos;re the highest bidder
        </div>
      );
    } else if (seconds > 0) {
      const amounts = jumpBids(lot.currentHighBid);
      footer = (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {amounts.map((amount, i) => {
              const tooMuch = amount > me.maxBid;
              return (
                <button
                  key={amount}
                  type="button"
                  onClick={() => bid(amount)}
                  disabled={busy || !me.canBid || tooMuch}
                  title={!me.canBid ? "Squad rules or your purse rule this lot out" : tooMuch ? `More than you can bid (${formatLakhs(me.maxBid)})` : `Bid ${formatLakhs(amount)}`}
                  className={`min-w-[80px] flex-1 rounded-lg px-2 py-2.5 font-bold transition disabled:opacity-50 ${i === 0 ? theme.primaryButton : "border border-white/20 bg-white/10 text-white hover:bg-white/20"}`}
                >
                  <div className="text-sm">Bid {formatLakhs(amount)}</div>
                  {i === 0 && <div className="text-[10px] opacity-70">+{formatLakhs(bidStep(lot.currentHighBid))}</div>}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              value={custom}
              min={lot.nextMinBid}
              step={bidStep(lot.nextMinBid)}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={`Your amount, lakhs (≥ ${lot.nextMinBid})`}
              aria-label="Custom bid in lakhs"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              disabled={busy || !me.canBid || !custom || !!customProblem}
              onClick={() => bid(customAmount)}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-40"
            >
              Place
            </button>
          </div>
          {customProblem && <p className="text-xs text-amber-300">{customProblem}</p>}
          {!me.canBid && <p className="text-xs text-gray-400">You can&apos;t take this lot (squad rules or purse).</p>}
          {msg && <p className="text-xs text-red-300">{msg}</p>}
        </div>
      );
    }
  }

  return (
    <LotStage
      theme={theme}
      kicker={lot.kind === "franchise" ? "Franchise on the Block" : "On the Block"}
      lotNumber={lot.lotNumber}
      title={lot.name}
      identity={player ? <PlayerChips role={player.role} teamCode={code(player.teamId)} overseas={player.overseas} /> : franchise ? <PlayerChips teamCode={franchise.code} /> : undefined}
      meta={
        <>
          Nominated by {nameOf(lot.nominatorTeamId)} · {lot.kind === "franchise" ? "Opened at" : "Base"} {formatLakhs(lot.openingPrice)}
          {player && player.points !== 0 && <> · {Math.round(player.points * 100) / 100} pts so far</>}
        </>
      }
      action={
        wishlist && player && !readOnly ? (
          <button
            type="button"
            onClick={() => wishlist.toggle(player.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              wishlist.has(player.id) ? "border-yellow-400/50 bg-yellow-400/15 text-yellow-300" : "border-white/20 bg-white/5 text-gray-300 hover:bg-white/10"
            }`}
          >
            {wishlist.has(player.id) ? "★ On your wishlist" : "☆ Add to wishlist"}
          </button>
        ) : undefined
      }
      bid={formatLakhs(lot.currentHighBid)}
      leader={nameOf(lot.currentHighBidderId)}
      leaderIsMe={mineHigh}
      seconds={seconds}
      maxSeconds={cur.bidTimerSeconds}
      ringSize={ringSize}
      banner={
        outbid && !mineHigh ? (
          <div role="alert" className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 py-2 text-center text-sm font-semibold text-red-200">
            You&apos;ve been outbid — {nameOf(lot.currentHighBidderId)} leads at {formatLakhs(lot.currentHighBid)}
          </div>
        ) : undefined
      }
      footer={footer}
    />
  );
}
