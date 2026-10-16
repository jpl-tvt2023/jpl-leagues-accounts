import type { SoldMomentView } from "@/components/auction/SoldMoment";
import type { PauseOutcome } from "@/lib/sports/cricket/auction/snapshot";
import type { ViewPlayer } from "@/lib/sports/cricket/league";
import { PlayerChips } from "./PlayerChips";

/** The cricket pause outcome, worded for the room's SOLD moment. */
export function cricketSoldMoment(
  outcome: PauseOutcome | null,
  ctx: {
    nameOf: (teamId: string | null | undefined) => string;
    /** The team's own name (a franchise buyer is renamed to it at once, so the sale says who bought it). */
    ownNameOf: (teamId: string | null | undefined) => string;
    myTeamId: string | null;
    money: (lakhs: number) => string;
    player: (id: number) => ViewPlayer | undefined;
    realTeamCode: (id: number) => string | undefined;
  },
): SoldMomentView | null {
  if (!outcome) return null;
  if (outcome.type === "sold") {
    const p = outcome.playerId != null ? ctx.player(outcome.playerId) : undefined;
    return {
      type: "sold",
      lotNumber: outcome.lotNumber,
      itemName: outcome.name,
      identity: p ? (
        <PlayerChips role={p.role} teamCode={ctx.realTeamCode(p.teamId)} overseas={p.overseas} />
      ) : outcome.cricketTeamId != null ? (
        <PlayerChips teamCode={ctx.realTeamCode(outcome.cricketTeamId)} />
      ) : undefined,
      winnerName: outcome.kind === "franchise" ? ctx.ownNameOf(outcome.teamId) : ctx.nameOf(outcome.teamId),
      winnerIsMe: outcome.teamId === ctx.myTeamId,
      price: ctx.money(outcome.price),
    };
  }
  return {
    type: "missed",
    teamName: ctx.nameOf(outcome.teamId),
    detail:
      outcome.type === "penalised"
        ? "Nothing usable on their wishlist — a penalty slot (one squad place fewer, until it's redeemed)."
        : "Their turn was skipped — there was nothing they could still buy.",
  };
}
