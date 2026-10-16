import type { ReactNode } from "react";
import { AuctionTimerRing } from "@/components/AuctionTimerRing";
import { HelpTip } from "@/components/HelpTip";
import type { RoomTheme } from "./theme";

/**
 * The lot on the block: what it is, who nominated it, the current bid, who leads and the bid
 * timer, with the bidding controls underneath (the FPL room's lot card).
 */
export function LotStage({
  theme,
  kicker = "On the Block",
  lotNumber,
  title,
  identity,
  meta,
  action,
  bid,
  leader,
  leaderIsMe,
  seconds,
  maxSeconds,
  ringSize = 88,
  banner,
  footer,
}: {
  theme: RoomTheme;
  kicker?: string;
  lotNumber?: number | null;
  title: string;
  /** Chips under the name: role or position, team, overseas. */
  identity?: ReactNode;
  /** "Nominated by X · Base ₹Y". */
  meta?: ReactNode;
  /** Beside the meta line: the shortlist toggle. */
  action?: ReactNode;
  bid: string;
  leader: string;
  leaderIsMe: boolean;
  seconds: number;
  maxSeconds: number;
  ringSize?: number;
  /** Above the stats: e.g. "You've been outbid". */
  banner?: ReactNode;
  /** Under the stats: bid buttons, "You are the high bidder", errors. */
  footer?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 ${theme.lotCard} p-5 backdrop-blur h-full`}>
      <div className="text-center mb-4">
        <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          {kicker}
          {lotNumber != null && <span className={`ml-1 ${theme.accentText} opacity-80`}>#{lotNumber}</span>}
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 break-words">{title}</h2>
        {identity && <div className="flex flex-wrap items-center justify-center gap-1.5 mb-1">{identity}</div>}
        {meta && <div className="text-xs text-gray-400">{meta}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {banner}
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div>
          <div className="text-[10px] uppercase text-gray-400">
            <HelpTip tip="The current highest bid. Your next bid must beat it.">Bid</HelpTip>
          </div>
          <div className={`text-lg sm:text-2xl font-mono font-bold ${theme.amountText}`}>{bid}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-400">
            <HelpTip tip="The team holding the top bid. If the timer hits zero, they win.">Leader</HelpTip>
          </div>
          <div className={`text-sm font-bold ${leaderIsMe ? theme.accentText : "text-white"}`}>
            {leader}
            {leaderIsMe && " (YOU)"}
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-[10px] uppercase text-gray-400 mb-1">
            <HelpTip tip="Seconds left to bid. A bid adds time; when it reaches zero the leader wins.">Timer</HelpTip>
          </div>
          <AuctionTimerRing seconds={seconds} max={maxSeconds} size={ringSize} stroke={8} />
        </div>
      </div>
      {footer}
    </div>
  );
}
