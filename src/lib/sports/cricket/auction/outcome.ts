/**
 * What just happened, for the room's post-turn pause ("SOLD to X for ₹Y", or "X missed their turn").
 * Pure: the snapshot passes in the session's newest turn event and its newest sale.
 */

export type PauseOutcome =
  | {
      type: "sold";
      lotId: string;
      kind: "player" | "franchise";
      name: string;
      playerId: number | null;
      cricketTeamId: number | null;
      teamId: string;
      price: number;
      lotNumber: number;
    }
  | { type: "penalised" | "skipped"; teamId: string | null };

/** A turn event, as far as the pause cares: the turn that the pause follows. */
export interface OutcomeEvent {
  event: string;
  teamId: string | null;
  at: Date;
}

export interface OutcomeSale {
  lotId: string;
  kind: "player" | "franchise";
  name: string;
  playerId: number | null;
  cricketTeamId: number | null;
  teamId: string;
  price: number;
  at: Date;
  lotNumber: number;
}

/** The turn events a pause can follow (pause/resume and admin events are not turns). */
export const TURN_OUTCOME_EVENTS = ["nominated", "auto-nominated", "penalised", "skipped"] as const;

/**
 * The pause follows the session's latest turn: a missed turn (penalised / skipped) is itself the
 * outcome; a nomination's outcome is its sale, when the newest sale came after that nomination.
 * Anything else — no turn yet, or a sale older than the nomination (it was cancelled) — is null.
 */
export function pickPauseOutcome(input: { lastEvent: OutcomeEvent | null; lastSale: OutcomeSale | null }): PauseOutcome | null {
  const { lastEvent, lastSale } = input;
  if (!lastEvent) return null;
  if (lastEvent.event === "penalised" || lastEvent.event === "skipped") return { type: lastEvent.event, teamId: lastEvent.teamId };
  if ((lastEvent.event === "nominated" || lastEvent.event === "auto-nominated") && lastSale && lastSale.at.getTime() >= lastEvent.at.getTime()) {
    const { lotId, kind, name, playerId, cricketTeamId, teamId, price, lotNumber } = lastSale;
    return { type: "sold", lotId, kind, name, playerId, cricketTeamId, teamId, price, lotNumber };
  }
  return null;
}
