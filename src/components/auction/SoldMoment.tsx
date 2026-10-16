import type { ReactNode } from "react";
import { AuctionTimerRing } from "@/components/AuctionTimerRing";
import type { RoomTheme } from "./theme";

/** What the pause between turns shows, already worded for the room. */
export type SoldMomentView =
  | { type: "sold"; lotNumber?: number | null; itemName: string; identity?: ReactNode; winnerName: string; winnerIsMe: boolean; price: string }
  | { type: "unsold"; itemName: string }
  | { type: "missed"; teamName: string; detail: string };

/**
 * The pause between turns: "SOLD to X for Y" (or the turn that was missed), with a ring counting
 * down to the next nomination. With nothing to show it is the plain "next up" ring card.
 */
export function SoldMoment({ theme, outcome, secondsLeft, maxSeconds }: { theme: RoomTheme; outcome: SoldMomentView | null; secondsLeft: number; maxSeconds: number }) {
  const ring = <AuctionTimerRing seconds={secondsLeft} max={maxSeconds} size={outcome ? 84 : 104} stroke={outcome ? 7 : 9} label="next nom" />;

  if (!outcome) {
    return (
      <div className="rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 to-slate-900/40 p-5 backdrop-blur text-center h-full flex flex-col items-center justify-center gap-3">
        <div className="text-[10px] uppercase tracking-widest text-yellow-300/80">Lot sold — next up</div>
        {ring}
        <p className="text-sm text-gray-300">Get ready — the next nomination is coming up</p>
      </div>
    );
  }

  return (
    <div role="status" className={`rounded-2xl border ${theme.soldCard} p-5 backdrop-blur text-center h-full flex flex-col items-center justify-center gap-3`}>
      {outcome.type === "sold" && (
        <>
          <div className={`animate-sold-stamp motion-reduce:animate-none rounded-lg border-4 px-5 py-1 text-3xl font-black tracking-[0.3em] ${theme.soldStamp}`}>SOLD</div>
          <div className="text-[10px] uppercase tracking-widest text-gray-400">
            Lot{outcome.lotNumber != null && ` #${outcome.lotNumber}`}
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white break-words">{outcome.itemName}</h2>
          {outcome.identity && <div className="flex flex-wrap items-center justify-center gap-1.5">{outcome.identity}</div>}
          <p className="text-sm text-gray-300">
            to <span className={`font-bold ${outcome.winnerIsMe ? theme.accentText : "text-white"}`}>{outcome.winnerName}{outcome.winnerIsMe && " (YOU)"}</span> for{" "}
            <span className={`font-mono font-bold ${theme.amountText}`}>{outcome.price}</span>
          </p>
        </>
      )}
      {outcome.type === "unsold" && (
        <>
          <div className="rounded-lg border-4 border-yellow-400 px-5 py-1 text-3xl font-black tracking-[0.3em] text-yellow-300">UNSOLD</div>
          <h2 className="text-xl font-bold text-white break-words">{outcome.itemName}</h2>
        </>
      )}
      {outcome.type === "missed" && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-red-300/80">Turn missed</div>
          <p className="text-base text-white">
            <span className="font-bold">{outcome.teamName}</span> missed their turn
          </p>
          <p className="text-sm text-gray-400">{outcome.detail}</p>
        </>
      )}
      {ring}
    </div>
  );
}
