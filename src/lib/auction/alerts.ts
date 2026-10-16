/**
 * When an auction room should get the manager's attention — their turn to nominate, or someone
 * outbidding them — as pure decisions on two consecutive views of the room. Shared by the FPL and
 * cricket rooms (the sound and the tab title live in components/auction/useAuctionAlerts.ts).
 */

export type AlertKind = "turn" | "outbid";

/** The few facts about the room the alerts watch. */
export interface AlertSignal {
  /** It's this manager's turn to nominate, and their window is open. */
  myTurn: boolean;
  /** Identifies the open lot (null between lots). */
  lotKey: string | null;
  /** This manager holds the open lot's top bid. */
  leaderIsMe: boolean;
  lotName?: string | null;
}

/**
 * The alerts a change of view raises. Nothing on the first view (opening the room never alerts);
 * "turn" when the turn becomes yours; "outbid" when, on the same lot, you led and no longer do.
 */
export function detectAlerts(prev: AlertSignal | null, next: AlertSignal): AlertKind[] {
  if (!prev) return [];
  const out: AlertKind[] = [];
  if (next.myTurn && !prev.myTurn) out.push("turn");
  if (next.lotKey !== null && next.lotKey === prev.lotKey && prev.leaderIsMe && !next.leaderIsMe) out.push("outbid");
  return out;
}

/** The tab title shown while an alert flashes. */
export function alertTitle(kind: AlertKind, lotName?: string | null): string {
  return kind === "turn" ? "(!) Your turn to nominate" : `(!) Outbid${lotName ? ` on ${lotName}` : ""}`;
}

/** The tab title at flash tick `tick`: the alert on even ticks, the page's own title on odd ones. */
export function titleFrame(base: string, message: string, tick: number): string {
  return tick % 2 === 0 ? message : base;
}

/** Whether an alert still applies: a turn alert while it's still your turn, an outbid one while you still trail on that lot. */
export function alertStillApplies(kind: AlertKind, raisedOnLot: string | null, now: AlertSignal): boolean {
  if (kind === "turn") return now.myTurn;
  return now.lotKey !== null && now.lotKey === raisedOnLot && !now.leaderIsMe;
}
