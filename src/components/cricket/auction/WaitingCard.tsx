import { AuctionTimerRing } from "@/components/AuctionTimerRing";
import type { RoomTheme } from "@/components/auction/theme";

/**
 * Between lots, waiting for a nomination: on your turn, the auto-nomination countdown and a button
 * to your Nominate tab (or straight to nominating what you've picked); otherwise whose turn it is.
 * When nobody can nominate anything more, says the auction is waiting for the admin to finish it.
 */
export function WaitingCard({
  theme,
  what,
  nominatorName,
  myTurn,
  secondsLeft,
  maxSeconds,
  done,
  picked,
  onCta,
  ctaDisabled,
}: {
  theme: RoomTheme;
  /** "player" or "franchise". */
  what: string;
  nominatorName: string | null;
  myTurn: boolean;
  /** Seconds left in the nomination window; 0 when none is open. */
  secondsLeft: number;
  maxSeconds: number;
  /** Nobody can nominate anything more. */
  done: boolean;
  picked?: string | null;
  onCta?: () => void;
  ctaDisabled?: boolean;
}) {
  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 backdrop-blur text-center h-full flex flex-col items-center justify-center gap-2">
        <div className="text-3xl">🏁</div>
        <div className="text-base font-bold text-white">Nothing left to nominate</div>
        <p className="text-sm text-gray-300">Every team is done. Waiting for the admin to finish the auction.</p>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border p-5 backdrop-blur text-center h-full flex flex-col items-center justify-center ${myTurn ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5"}`}>
      <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Waiting for Nomination</div>
      {myTurn ? (
        <>
          <p className={`text-lg font-bold ${theme.accentText}`}>Your turn to nominate</p>
          <p className="mb-2 text-sm text-white">Pick a {what} — if the clock runs out, your wishlist is used.</p>
          {secondsLeft > 0 && (
            <div className="mb-3 flex justify-center">
              <AuctionTimerRing seconds={secondsLeft} max={maxSeconds} size={64} stroke={6} label="auto-nom" />
            </div>
          )}
          {onCta && (
            <button type="button" onClick={onCta} disabled={ctaDisabled} className={`rounded-lg px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${theme.primaryButton}`}>
              {picked ? `Nominate ${picked}` : `Pick a ${what}`}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-gray-400">{nominatorName ? `Waiting for ${nominatorName} to nominate…` : "Waiting for the next nomination…"}</p>
          {secondsLeft > 0 && <div className="mt-1 font-mono text-xs text-gray-500">Auto-nom in {secondsLeft}s</div>}
        </>
      )}
    </div>
  );
}
