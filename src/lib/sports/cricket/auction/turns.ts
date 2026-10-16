/**
 * Admin turn corrections, as pure decisions (the engine's turn order is in engine.ts's
 * advanceNominator: owed make-up turns first, then the ring resumes after `ringReturnIndex`).
 */

export type SetNominatorPlan = { ok: true; index: number; ringReturnIndex: number | null } | { ok: false; error: string };

/**
 * Who nominates next, set by the admin while the session is paused: one back or forward from the
 * current nominator, or a given team. With make-up turns still owed, those are served first, so
 * the ring's return point is set just before the chosen team — it nominates as soon as they're done.
 */
export function planSetNominator(input: {
  ring: readonly string[];
  cursor: number;
  queueLength: number;
  direction?: "back" | "forward";
  teamId?: string;
}): SetNominatorPlan {
  const n = input.ring.length;
  if (n === 0) return { ok: false, error: "The session has no nomination order yet" };
  let index: number;
  if (input.teamId) {
    index = input.ring.indexOf(input.teamId);
    if (index < 0) return { ok: false, error: "That team isn't in this session" };
  } else if (input.direction === "back" || input.direction === "forward") {
    index = (input.cursor + (input.direction === "forward" ? 1 : -1) + n) % n;
  } else {
    return { ok: false, error: "Say which team, or back or forward" };
  }
  return { ok: true, index, ringReturnIndex: input.queueLength > 0 ? (index - 1 + n) % n : null };
}
