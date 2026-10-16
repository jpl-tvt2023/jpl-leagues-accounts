/**
 * Matching a sale to the room's post-sale pause, for rooms that learn of sales from their history
 * rather than with the pause itself (the FPL room). The pause opens when a lot is sold, so the sale
 * it follows happened about `intermissionSeconds` before the pause ends.
 */

/**
 * Whether a sale at `eventAtMs` is the one the current pause follows: no earlier than the pause's
 * start (less a tolerance for clocks and polling) and no later than its end.
 */
export function belongsToPause(eventAtMs: number, intermissionUntilMs: number, intermissionSeconds: number, toleranceMs = 10_000): boolean {
  const pauseStart = intermissionUntilMs - intermissionSeconds * 1000;
  return eventAtMs >= pauseStart - toleranceMs && eventAtMs <= intermissionUntilMs;
}
