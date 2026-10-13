/**
 * The cricket auction engine: nomination turns, lots, bids and sales.
 *
 * It follows the FPL auction's proven mechanics (src/lib/sports/fpl/formats/auction/resolve-bid.ts)
 * on cricket's own tables. Every connected browser drives the same session through `tick` (the SSE
 * stream polls every 2s), so many processes run this cycle concurrently against one session row.
 * Every write that moves the turn is therefore a compare-and-swap against the state the caller
 * observed, and the states that must never be seen separately commit together:
 *
 *   - claiming the nomination window + opening the lot                 (nominateLot)
 *   - marking a lot sold + recording the purchase + opening the pause  (resolveExpiredLot)
 *   - consuming the pause + arming the next nominator                  (advanceNominator)
 *
 * A session's two kinds: "franchise" (each team buys one franchise; the nominator opens at the
 * rising floor) and "player" (squads; the nominator opens at the player's base price).
 */

import { and, asc, count, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  cricketAuctionSessions,
  cricketAuctionLots,
  cricketAuctionBidLogs,
  cricketAuctionTurnEvents,
  cricketWishlists,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketTeamState,
  cricketTeamPenalties,
  cricketLeagueConfig,
  type CricketAuctionLot,
  type CricketAuctionSession,
} from "@/lib/db";
import { generateId } from "@/lib/id";
import { bumpStateVersion } from "../league";
import { nextMinBid } from "./rules";
import {
  affordableFranchises,
  canNominateAnything,
  checkFranchisePurchase,
  checkPlayerPurchase,
  franchiseOpening,
  loadAuctionData,
  type AuctionData,
} from "./data";

export type TurnActor = "stream" | "rest" | "nominate" | "admin";

/** Grace after a lot's timer for bids already in flight. */
export const BID_GRACE_MS = 2000;
/** Each bid adds this to the clock, never past the session's bid timer from now. */
export const ANTI_SNIPE_MS = 10_000;

export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getSession(sessionId: string): Promise<CricketAuctionSession | null> {
  const [row] = await db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.id, sessionId)).limit(1);
  return row ?? null;
}

export async function getOpenLot(sessionId: string): Promise<CricketAuctionLot | null> {
  const [row] = await db
    .select()
    .from(cricketAuctionLots)
    .where(and(eq(cricketAuctionLots.sessionId, sessionId), eq(cricketAuctionLots.status, "open")))
    .limit(1);
  return row ?? null;
}

/** Best-effort audit of the turn cycle; never allowed to break the auction. */
export async function logTurnEvent(e: {
  sessionId: string;
  leagueId: string;
  teamId?: string | null;
  nominatorIndex?: number | null;
  event: string;
  actor: TurnActor;
  detail?: unknown;
}): Promise<void> {
  try {
    await db.insert(cricketAuctionTurnEvents).values({
      id: generateId(),
      sessionId: e.sessionId,
      leagueId: e.leagueId,
      teamId: e.teamId ?? null,
      nominatorIndex: e.nominatorIndex ?? null,
      event: e.event,
      actor: e.actor,
      detail: e.detail === undefined ? null : JSON.stringify(e.detail),
    });
  } catch (err) {
    console.error("[cricket turn-event] insert failed", e.event, err);
  }
}

// ─── Turns ───────────────────────────────────────────────────────────────────

/**
 * Move the turn to the next team that can nominate something: a team owed a make-up turn first,
 * otherwise the next in the ring. Teams with nothing they could nominate (full squad, franchise
 * already owned, nothing affordable) are skipped. With nobody left, the session idles until the
 * admin completes it.
 *
 * `claimIntermission` consumes the post-sale pause in the same write (only one caller wins it);
 * `expectIndex` pins the cursor the caller observed.
 */
export async function advanceNominator(
  sessionId: string,
  opts: { claimIntermission?: Date | null; expectIndex?: number; actor?: TurnActor; data?: AuctionData } = {},
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  const data = opts.data ?? (await loadAuctionData(session.leagueId));
  if (!data) return;
  const actor = opts.actor ?? "stream";
  const ring = parseIdList(session.ringOrder);
  if (ring.length === 0) return;

  const guards = [eq(cricketAuctionSessions.id, sessionId), eq(cricketAuctionSessions.makeupQueue, session.makeupQueue)];
  if (opts.claimIntermission) guards.push(eq(cricketAuctionSessions.intermissionUntil, opts.claimIntermission));
  if (opts.expectIndex != null) guards.push(eq(cricketAuctionSessions.currentNominatorIndex, opts.expectIndex));
  const where = and(...guards);
  const claimSet = opts.claimIntermission ? { intermissionUntil: null } : {};
  const deadline = new Date(Date.now() + session.nominationTimeoutSeconds * 1000);
  const cursor = session.currentNominatorIndex;

  // Make-up turns first: an insertion, so the ring resumes exactly where it stopped.
  const queue = parseIdList(session.makeupQueue);
  for (let k = 0; k < queue.length; k++) {
    const teamId = queue[k];
    const armIndex = ring.indexOf(teamId);
    if (armIndex < 0 || !canNominateAnything(data, session.type, teamId)) continue;
    const remaining = queue.slice(k + 1);
    const ringReturn = session.ringReturnIndex ?? cursor;
    const res = await db
      .update(cricketAuctionSessions)
      .set({ ...claimSet, currentNominatorIndex: armIndex, ringReturnIndex: ringReturn, makeupQueue: JSON.stringify(remaining), nominationDeadline: deadline })
      .where(where);
    if (res.rowsAffected > 0) {
      await logTurnEvent({ sessionId, leagueId: session.leagueId, teamId, nominatorIndex: armIndex, event: "makeup-armed", actor, detail: { remaining } });
    }
    return;
  }

  const start = session.ringReturnIndex ?? cursor;
  for (let step = 1; step <= ring.length; step++) {
    const next = (start + step) % ring.length;
    if (!canNominateAnything(data, session.type, ring[next])) continue;
    const res = await db
      .update(cricketAuctionSessions)
      .set({ ...claimSet, currentNominatorIndex: next, nominationDeadline: deadline, ringReturnIndex: null, makeupQueue: "[]" })
      .where(where);
    if (res.rowsAffected > 0) {
      await logTurnEvent({ sessionId, leagueId: session.leagueId, teamId: ring[next], nominatorIndex: next, event: "advanced", actor, detail: { from: start } });
    }
    return;
  }

  // Nobody can nominate anything: idle until the admin completes the session.
  const res = await db
    .update(cricketAuctionSessions)
    .set({ ...claimSet, nominationDeadline: null, ringReturnIndex: null, makeupQueue: "[]" })
    .where(where);
  if (res.rowsAffected > 0) await logTurnEvent({ sessionId, leagueId: session.leagueId, event: "idle", actor });
}

/**
 * Arm the current nominator's window when nothing is armed (a session just started or resumed, or
 * a nomination was cancelled). Writes only if no deadline, pause or open lot exists at write time.
 */
export async function armNominationWindow(sessionId: string, opts: { expectIndex?: number; actor?: TurnActor } = {}): Promise<void> {
  const session = await getSession(sessionId);
  if (!session || session.status !== "active" || session.intermissionUntil || session.nominationDeadline) return;
  const actor = opts.actor ?? "stream";
  if (parseIdList(session.makeupQueue).length > 0) {
    await advanceNominator(sessionId, { expectIndex: opts.expectIndex ?? session.currentNominatorIndex, actor });
    return;
  }
  const ring = parseIdList(session.ringOrder);
  const teamId = ring[session.currentNominatorIndex];
  const data = await loadAuctionData(session.leagueId);
  if (!data) return;
  if (!teamId || !canNominateAnything(data, session.type, teamId)) {
    await advanceNominator(sessionId, { expectIndex: session.currentNominatorIndex, actor, data });
    return;
  }
  if (await getOpenLot(sessionId)) return;
  const guards = [
    eq(cricketAuctionSessions.id, sessionId),
    isNull(cricketAuctionSessions.nominationDeadline),
    isNull(cricketAuctionSessions.intermissionUntil),
    eq(cricketAuctionSessions.status, "active"),
  ];
  if (opts.expectIndex != null) guards.push(eq(cricketAuctionSessions.currentNominatorIndex, opts.expectIndex));
  const res = await db
    .update(cricketAuctionSessions)
    .set({ nominationDeadline: new Date(Date.now() + session.nominationTimeoutSeconds * 1000) })
    .where(and(...guards));
  if (res.rowsAffected > 0) {
    await logTurnEvent({ sessionId, leagueId: session.leagueId, teamId, nominatorIndex: session.currentNominatorIndex, event: "armed", actor });
  }
}

/** Open the post-turn pause (idempotent: never extends one already running). */
export async function beginIntermission(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  const secs = Math.max(1, session.intermissionSeconds);
  await db
    .update(cricketAuctionSessions)
    .set({ intermissionUntil: new Date(Date.now() + secs * 1000), nominationDeadline: null })
    .where(and(eq(cricketAuctionSessions.id, sessionId), isNull(cricketAuctionSessions.intermissionUntil)));
}

// ─── Lots ────────────────────────────────────────────────────────────────────

export type NominateTarget = { playerId: number } | { cricketTeamId: number };

/** Validate a nomination for `teamId` and describe the lot it would open. */
function describeLot(
  data: AuctionData,
  type: "franchise" | "player",
  teamId: string,
  target: NominateTarget,
): { ok: true; kind: "player" | "franchise"; playerId: number | null; cricketTeamId: number | null; name: string; opening: number } | { ok: false; error: string } {
  if (type === "player") {
    if (!("playerId" in target)) return { ok: false, error: "Nominate a player" };
    const p = data.pool.players.get(target.playerId);
    if (!p) return { ok: false, error: "No such player in this tournament" };
    const check = checkPlayerPurchase(data, teamId, p.id, p.basePrice);
    if (!check.ok) return check;
    return { ok: true, kind: "player", playerId: p.id, cricketTeamId: null, name: p.name, opening: p.basePrice };
  }
  if (!("cricketTeamId" in target)) return { ok: false, error: "Nominate a franchise" };
  const t = data.pool.realTeams.get(target.cricketTeamId);
  if (!t) return { ok: false, error: "No such franchise in this tournament" };
  const opening = franchiseOpening(data, t.id);
  const check = checkFranchisePurchase(data, teamId, t.id, opening);
  if (!check.ok) return check;
  return { ok: true, kind: "franchise", playerId: null, cricketTeamId: t.id, name: t.name, opening };
}

/** Insert a lot plus its nomination log. Run inside the caller's transaction. */
async function insertLot(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: CricketAuctionSession,
  nominatorTeamId: string,
  lot: { kind: "player" | "franchise"; playerId: number | null; cricketTeamId: number | null; name: string; opening: number },
): Promise<string> {
  const lotId = generateId();
  await tx.insert(cricketAuctionLots).values({
    id: lotId,
    leagueId: session.leagueId,
    sessionId: session.id,
    lotKind: lot.kind,
    playerId: lot.playerId,
    cricketTeamId: lot.cricketTeamId,
    name: lot.name,
    nominatorTeamId,
    openingPrice: lot.opening,
    currentHighBid: lot.opening,
    currentHighBidderId: nominatorTeamId,
    status: "open",
    expiresAt: new Date(Date.now() + session.bidTimerSeconds * 1000),
  });
  await tx.insert(cricketAuctionBidLogs).values({ id: generateId(), lotId, teamId: nominatorTeamId, amount: lot.opening, type: "nomination" });
  return lotId;
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/**
 * Nominate for the current nominator. `asTeamId` is the caller's team (it must be their turn);
 * null means an admin nominating on the current nominator's behalf.
 */
export async function nominateLot(sessionId: string, asTeamId: string | null, target: NominateTarget): Promise<ActionResult<{ lotId: string }>> {
  let session = await getSession(sessionId);
  if (!session || session.status !== "active") return { ok: false, status: 400, error: "The auction isn't live" };
  if (session.intermissionUntil && Date.now() < session.intermissionUntil.getTime()) {
    return { ok: false, status: 409, error: "Between lots — wait for the next nomination window" };
  }
  // Safety net: close a lot whose timer ran out. If that happens here, this request was not a valid
  // window (the turn moves on after the pause), so the caller must wait.
  const stale = await getOpenLot(sessionId);
  if (stale && Date.now() > stale.expiresAt.getTime() + BID_GRACE_MS) {
    await resolveExpiredLot(stale);
    return { ok: false, status: 409, error: "That lot just closed — the next nomination window is opening" };
  }
  if (stale) return { ok: false, status: 409, error: "Another lot is still open" };
  session = await getSession(sessionId);
  if (!session || session.status !== "active") return { ok: false, status: 400, error: "The auction isn't live" };

  const ring = parseIdList(session.ringOrder);
  const nominator = ring[session.currentNominatorIndex];
  if (!nominator) return { ok: false, status: 409, error: "Nobody's turn right now" };
  if (asTeamId !== null && asTeamId !== nominator) return { ok: false, status: 403, error: "It isn't your turn to nominate" };

  const data = await loadAuctionData(session.leagueId);
  if (!data) return { ok: false, status: 404, error: "Not a cricket league" };
  const lot = describeLot(data, session.type, nominator, target);
  if (!lot.ok) return { ok: false, status: 400, error: lot.error };

  // Claim the window and open the lot in one commit: whoever nulls the deadline first wins, so a
  // late nomination and the timeout can never both happen.
  const current = session;
  const lotId = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(cricketAuctionSessions)
      .set({ nominationDeadline: null, intermissionUntil: null })
      .where(
        and(
          eq(cricketAuctionSessions.id, sessionId),
          isNotNull(cricketAuctionSessions.nominationDeadline),
          eq(cricketAuctionSessions.currentNominatorIndex, current.currentNominatorIndex),
        ),
      );
    if (claimed.rowsAffected === 0) return null;
    return insertLot(tx, current, nominator, lot);
  });
  if (!lotId) return { ok: false, status: 409, error: "Your nomination window has passed" };
  await logTurnEvent({ sessionId, leagueId: session.leagueId, teamId: nominator, nominatorIndex: session.currentNominatorIndex, event: "nominated", actor: asTeamId ? "nominate" : "admin", detail: { lotId, name: lot.name, opening: lot.opening } });
  return { ok: true, lotId };
}

/** Place a bid on the session's open lot. */
export async function placeBid(sessionId: string, teamId: string, amount: number, lotId?: string): Promise<ActionResult<{ amount: number; expiresAt: string }>> {
  const session = await getSession(sessionId);
  if (!session || session.status !== "active") return { ok: false, status: 400, error: "The auction isn't live" };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, status: 400, error: "Bid a whole number of lakhs" };
  const lot = await getOpenLot(sessionId);
  if (!lot) return { ok: false, status: 400, error: "Nothing is up for bidding" };
  if (lotId && lot.id !== lotId) return { ok: false, status: 409, error: "That lot has closed — this is a new one" };
  if (Date.now() > lot.expiresAt.getTime() + BID_GRACE_MS) return { ok: false, status: 400, error: "Bidding on this lot has closed" };
  if (lot.currentHighBidderId === teamId) return { ok: false, status: 400, error: "You're already the highest bidder" };
  const min = nextMinBid(lot.currentHighBid);
  if (amount < min) return { ok: false, status: 400, error: `The minimum bid is ${min} L` };

  const data = await loadAuctionData(session.leagueId);
  if (!data) return { ok: false, status: 404, error: "Not a cricket league" };
  const check =
    lot.lotKind === "player" ? checkPlayerPurchase(data, teamId, lot.playerId!, amount) : checkFranchisePurchase(data, teamId, lot.cricketTeamId!, amount);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  const newExpiry = new Date(Math.min(lot.expiresAt.getTime() + ANTI_SNIPE_MS, Date.now() + session.bidTimerSeconds * 1000));
  // Compare-and-swap on the bid we validated against: a bid that lands first wins, and this one
  // is refused rather than silently overwriting it.
  const ok = await db.transaction(async (tx) => {
    const res = await tx
      .update(cricketAuctionLots)
      .set({ currentHighBid: amount, currentHighBidderId: teamId, expiresAt: newExpiry, updatedAt: new Date() })
      .where(
        and(
          eq(cricketAuctionLots.id, lot.id),
          eq(cricketAuctionLots.status, "open"),
          eq(cricketAuctionLots.currentHighBid, lot.currentHighBid),
          eq(cricketAuctionLots.currentHighBidderId, lot.currentHighBidderId),
        ),
      );
    if (res.rowsAffected === 0) return false;
    await tx.insert(cricketAuctionBidLogs).values({ id: generateId(), lotId: lot.id, teamId, amount, type: "bid" });
    return true;
  });
  if (!ok) return { ok: false, status: 409, error: "Someone bid first — try again" };
  return { ok: true, amount, expiresAt: newExpiry.toISOString() };
}

/**
 * Close a lot whose timer has run out: it always sells (the nominator is the opening bidder).
 * The sale, the purchase, the purse and the post-sale pause commit together. Returns false if
 * another caller already closed it (or a bid extended it).
 */
export async function resolveExpiredLot(lot: CricketAuctionLot): Promise<boolean> {
  const session = await getSession(lot.sessionId);
  if (!session) return false;
  const now = new Date();
  const cutoff = new Date(Date.now() - BID_GRACE_MS);
  const pauseUntil = new Date(Date.now() + Math.max(1, session.intermissionSeconds) * 1000);

  const outcome = await db.transaction(async (tx) => {
    const [sold] = await tx
      .update(cricketAuctionLots)
      .set({ status: "sold", updatedAt: now })
      .where(and(eq(cricketAuctionLots.id, lot.id), eq(cricketAuctionLots.status, "open"), lte(cricketAuctionLots.expiresAt, cutoff)))
      .returning();
    if (!sold) return null;
    await tx
      .update(cricketAuctionSessions)
      .set({ intermissionUntil: pauseUntil, nominationDeadline: null })
      .where(eq(cricketAuctionSessions.id, sold.sessionId));

    const winner = sold.currentHighBidderId;
    const price = sold.currentHighBid;
    // Double-sale guard: the unique indexes would refuse a second owner, but failing the whole
    // transaction would leave the lot open forever; cancel this lot instead.
    let duplicate = false;
    if (sold.lotKind === "player") {
      const [owned] = await tx
        .select({ id: cricketSquadPlayers.id })
        .from(cricketSquadPlayers)
        .where(and(eq(cricketSquadPlayers.leagueId, sold.leagueId), eq(cricketSquadPlayers.playerId, sold.playerId!)))
        .limit(1);
      duplicate = !!owned;
      if (!duplicate) {
        await tx.insert(cricketSquadPlayers).values({ id: generateId(), leagueId: sold.leagueId, teamId: winner, playerId: sold.playerId!, price, sessionId: sold.sessionId, lotId: sold.id });
      }
    } else {
      const [owned] = await tx
        .select({ id: cricketFranchiseOwnership.id })
        .from(cricketFranchiseOwnership)
        .where(
          and(
            eq(cricketFranchiseOwnership.leagueId, sold.leagueId),
            sql`(${cricketFranchiseOwnership.teamId} = ${winner} OR ${cricketFranchiseOwnership.cricketTeamId} = ${sold.cricketTeamId})`,
          ),
        )
        .limit(1);
      duplicate = !!owned;
      if (!duplicate) {
        await tx
          .insert(cricketFranchiseOwnership)
          .values({ id: generateId(), leagueId: sold.leagueId, teamId: winner, cricketTeamId: sold.cricketTeamId!, price, sessionId: sold.sessionId, lotId: sold.id });
      }
    }
    if (duplicate) {
      await tx.update(cricketAuctionLots).set({ status: "cancelled", updatedAt: now }).where(eq(cricketAuctionLots.id, sold.id));
      await tx.insert(cricketAuctionBidLogs).values({ id: generateId(), lotId: sold.id, teamId: winner, amount: price, type: "cancelled" });
      return "duplicate" as const;
    }
    await tx
      .update(cricketTeamState)
      .set({ purse: sql`${cricketTeamState.purse} - ${price}`, spent: sql`${cricketTeamState.spent} + ${price}`, updatedAt: now })
      .where(eq(cricketTeamState.teamId, winner));
    await tx.insert(cricketAuctionBidLogs).values({ id: generateId(), lotId: sold.id, teamId: winner, amount: price, type: "sold" });
    await tx
      .update(cricketLeagueConfig)
      .set({ stateVersion: sql`${cricketLeagueConfig.stateVersion} + 1`, updatedAt: now })
      .where(eq(cricketLeagueConfig.leagueId, sold.leagueId));
    return "sold" as const;
  });
  if (outcome === "duplicate") console.error("[cricket auction] duplicate sale prevented; lot cancelled", { lotId: lot.id });
  return outcome === "sold";
}

// ─── Timeouts ────────────────────────────────────────────────────────────────

/**
 * A nominator's window ran out (the caller has already claimed it). Player auction: nominate the
 * first affordable, allowed player on their wishlist; with none, a penalty slot. Franchise auction:
 * nominate a random franchise they can afford, with them as opening bidder; with none, skip them.
 */
export async function handleNominationTimeout(sessionId: string, teamId: string): Promise<"auto-nominated" | "penalised" | "skipped"> {
  const session = await getSession(sessionId);
  if (!session) return "skipped";
  const data = await loadAuctionData(session.leagueId);
  if (!data) return "skipped";
  const base = { sessionId, leagueId: session.leagueId, teamId, nominatorIndex: session.currentNominatorIndex, actor: "stream" as const };

  const openAutoLot = async (target: NominateTarget, event: string): Promise<boolean> => {
    const lot = describeLot(data, session.type, teamId, target);
    if (!lot.ok) return false;
    const opened = await db.transaction(async (tx) => {
      // The window is already claimed; only refuse if a lot somehow exists.
      const [open] = await tx
        .select({ n: count() })
        .from(cricketAuctionLots)
        .where(and(eq(cricketAuctionLots.sessionId, sessionId), eq(cricketAuctionLots.status, "open")));
      if (open.n > 0) return null;
      await tx.update(cricketAuctionSessions).set({ intermissionUntil: null }).where(eq(cricketAuctionSessions.id, sessionId));
      return insertLot(tx, session, teamId, lot);
    });
    if (opened) await logTurnEvent({ ...base, event, detail: { lotId: opened, name: lot.name } });
    return !!opened;
  };

  if (session.type === "franchise") {
    const options = affordableFranchises(data, teamId);
    if (options.length > 0) {
      const pick = options[Math.floor(Math.random() * options.length)];
      if (await openAutoLot({ cricketTeamId: pick.id }, "auto-nominated")) return "auto-nominated";
    }
    await logTurnEvent({ ...base, event: "skipped", detail: { reason: "no affordable franchise" } });
    await beginIntermission(sessionId);
    return "skipped";
  }

  if (!canNominateAnything(data, "player", teamId)) {
    await logTurnEvent({ ...base, event: "skipped", detail: { reason: "squad full or nothing affordable" } });
    await beginIntermission(sessionId);
    return "skipped";
  }
  const wishlist = await db
    .select({ playerId: cricketWishlists.playerId })
    .from(cricketWishlists)
    .where(and(eq(cricketWishlists.leagueId, session.leagueId), eq(cricketWishlists.teamId, teamId)))
    .orderBy(asc(cricketWishlists.priority));
  for (const w of wishlist) {
    const p = data.pool.players.get(w.playerId);
    if (!p || !checkPlayerPurchase(data, teamId, p.id, p.basePrice).ok) continue;
    if (await openAutoLot({ playerId: p.id }, "auto-nominated")) return "auto-nominated";
    break;
  }

  // Nothing usable on the wishlist: a penalty slot, then the turn moves on.
  await db.batch([
    db.insert(cricketTeamPenalties).values({ id: generateId(), leagueId: session.leagueId, teamId, sessionId }),
    db
      .update(cricketTeamState)
      .set({ penaltySlots: sql`${cricketTeamState.penaltySlots} + 1`, updatedAt: new Date() })
      .where(eq(cricketTeamState.teamId, teamId)),
    bumpStateVersion(session.leagueId),
  ]);
  await logTurnEvent({ ...base, event: "penalised" });
  await beginIntermission(sessionId);
  return "penalised";
}

// ─── The tick ────────────────────────────────────────────────────────────────

/**
 * One step of the session's clock, run by every poller (the SSE stream every 2s, and state reads):
 * close an expired lot, end an elapsed pause by arming the next nominator, handle an expired
 * nomination window, or arm a window when none is set. Safe to run concurrently — every transition
 * is claimed by exactly one caller.
 */
export async function tick(sessionId: string, actor: TurnActor = "stream"): Promise<void> {
  const session = await getSession(sessionId);
  if (!session || session.status !== "active") return;
  const lot = await getOpenLot(sessionId);
  if (lot) {
    if (Date.now() > lot.expiresAt.getTime() + BID_GRACE_MS) await resolveExpiredLot(lot);
    return;
  }
  const now = Date.now();
  if (session.intermissionUntil) {
    if (now >= session.intermissionUntil.getTime()) {
      await advanceNominator(sessionId, { claimIntermission: session.intermissionUntil, expectIndex: session.currentNominatorIndex, actor });
    }
    return;
  }
  if (session.nominationDeadline && now > session.nominationDeadline.getTime()) {
    // Claim THIS exact window (observed deadline + cursor); a stale poller affects nothing.
    const claimed = await db
      .update(cricketAuctionSessions)
      .set({ nominationDeadline: null })
      .where(
        and(
          eq(cricketAuctionSessions.id, sessionId),
          eq(cricketAuctionSessions.nominationDeadline, session.nominationDeadline),
          eq(cricketAuctionSessions.currentNominatorIndex, session.currentNominatorIndex),
        ),
      );
    if (claimed.rowsAffected > 0) {
      const ring = parseIdList(session.ringOrder);
      const teamId = ring[session.currentNominatorIndex];
      if (teamId) await handleNominationTimeout(sessionId, teamId);
    }
    return;
  }
  if (!session.nominationDeadline) await armNominationWindow(sessionId, { expectIndex: session.currentNominatorIndex, actor });
}
