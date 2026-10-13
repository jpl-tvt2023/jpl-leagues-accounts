/**
 * Cricket auction actions outside the turn cycle: running sessions (league admins and the
 * superadmin), corrections, reset, penalty redemption, wishlists, and a simulated auction for
 * rehearsals and tests (superadmin only).
 *
 * Session order: the franchise session (when the league has one) must finish before the player
 * session starts. There are no mini-auctions — once the player session completes, squads are final.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  teams,
  cricketAuctionSessions,
  cricketAuctionLots,
  cricketAuctionBidLogs,
  cricketAuctionTurnEvents,
  cricketWishlists,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketTeamState,
  cricketTeamPenalties,
  type CricketAuctionSession,
} from "@/lib/db";
import { generateId } from "@/lib/id";
import { bumpStateVersion, loadCricketLeague } from "../league";
import { playersStillNeeded } from "./rules";
import { checkFranchisePurchase, checkPlayerPurchase, cheapestUnsoldBase, franchiseOpening, loadAuctionData } from "./data";
import { getOpenLot, getSession, logTurnEvent, parseIdList, type ActionResult } from "./engine";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

async function leagueSessions(leagueId: string): Promise<CricketAuctionSession[]> {
  return db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, leagueId)).orderBy(asc(cricketAuctionSessions.createdAt));
}

async function sessionInLeague(leagueId: string, sessionId: string): Promise<CricketAuctionSession | null> {
  const s = await getSession(sessionId);
  return s && s.leagueId === leagueId ? s : null;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(
  leagueId: string,
  type: "franchise" | "player",
  opts: { scheduledAt?: Date | null; bidTimerSeconds?: number; nominationTimeoutSeconds?: number },
): Promise<ActionResult<{ sessionId: string }>> {
  const info = await loadCricketLeague(leagueId);
  if (!info) return fail(404, "Not a cricket league");
  if (type === "franchise" && !info.config.franchiseAuctionEnabled) return fail(400, "This league has no franchise auction");
  const existing = await leagueSessions(info.league.id);
  if (existing.some((s) => s.type === type)) return fail(409, `There is already a ${type} auction session`);
  const sessionId = generateId();
  await db.batch([
    db.insert(cricketAuctionSessions).values({
      id: sessionId,
      leagueId: info.league.id,
      type,
      scheduledAt: opts.scheduledAt ?? null,
      bidTimerSeconds: opts.bidTimerSeconds ?? info.config.bidTimerSeconds,
      nominationTimeoutSeconds: opts.nominationTimeoutSeconds ?? info.config.nominationTimeoutSeconds,
    }),
    bumpStateVersion(info.league.id),
  ]);
  return { ok: true, sessionId };
}

export async function scheduleSession(leagueId: string, sessionId: string, scheduledAt: Date | null): Promise<ActionResult> {
  const s = await sessionInLeague(leagueId, sessionId);
  if (!s) return fail(404, "Session not found");
  if (s.status !== "pending") return fail(400, "Only a session that hasn't started can be rescheduled");
  await db.batch([db.update(cricketAuctionSessions).set({ scheduledAt }).where(eq(cricketAuctionSessions.id, sessionId)), bumpStateVersion(leagueId)]);
  return { ok: true };
}

export async function startSession(leagueId: string, sessionId: string): Promise<ActionResult> {
  const info = await loadCricketLeague(leagueId);
  if (!info) return fail(404, "Not a cricket league");
  const sessions = await leagueSessions(info.league.id);
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return fail(404, "Session not found");
  if (s.status !== "pending") return fail(400, "This session has already started");
  if (sessions.some((x) => x.status === "active" || x.status === "paused")) return fail(409, "Another auction session is running");
  if (s.type === "player" && info.config.franchiseAuctionEnabled && !sessions.some((x) => x.type === "franchise" && x.status === "completed")) {
    return fail(409, "Finish the franchise auction before the player auction");
  }
  const teamIds = (await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, info.league.id), eq(teams.isGhost, false)))).map((t) => t.id);
  if (teamIds.length < 2) return fail(400, "The league needs at least two teams");
  const ring = shuffle(teamIds);
  const res = await db
    .update(cricketAuctionSessions)
    .set({ status: "active", ringOrder: JSON.stringify(ring), currentNominatorIndex: 0, nominationDeadline: null, intermissionUntil: null, startedAt: new Date() })
    .where(and(eq(cricketAuctionSessions.id, sessionId), eq(cricketAuctionSessions.status, "pending")));
  if (res.rowsAffected === 0) return fail(409, "This session has already started");
  await bumpStateVersion(info.league.id);
  await logTurnEvent({ sessionId, leagueId: info.league.id, event: "started", actor: "admin", detail: { ring } });
  return { ok: true };
}

export async function pauseSession(leagueId: string, sessionId: string): Promise<ActionResult> {
  const res = await db
    .update(cricketAuctionSessions)
    .set({ status: "paused", pausedAt: new Date() })
    .where(and(eq(cricketAuctionSessions.id, sessionId), eq(cricketAuctionSessions.leagueId, leagueId), eq(cricketAuctionSessions.status, "active")));
  if (res.rowsAffected === 0) return fail(400, "The session isn't running");
  await bumpStateVersion(leagueId);
  await logTurnEvent({ sessionId, leagueId, event: "paused", actor: "admin" });
  return { ok: true };
}

/** Resume, moving every open deadline forward by the time spent paused. */
export async function resumeSession(leagueId: string, sessionId: string): Promise<ActionResult> {
  const s = await sessionInLeague(leagueId, sessionId);
  if (!s || s.status !== "paused") return fail(400, "The session isn't paused");
  const pausedMs = Date.now() - (s.pausedAt?.getTime() ?? Date.now());
  const shift = (d: Date | null) => (d ? new Date(d.getTime() + pausedMs) : null);
  const lot = await getOpenLot(sessionId);
  await db.batch([
    db
      .update(cricketAuctionSessions)
      .set({ status: "active", pausedAt: null, nominationDeadline: shift(s.nominationDeadline), intermissionUntil: shift(s.intermissionUntil) })
      .where(and(eq(cricketAuctionSessions.id, sessionId), eq(cricketAuctionSessions.status, "paused"))),
    ...(lot ? [db.update(cricketAuctionLots).set({ expiresAt: shift(lot.expiresAt)! }).where(eq(cricketAuctionLots.id, lot.id))] : []),
    bumpStateVersion(leagueId),
  ]);
  await logTurnEvent({ sessionId, leagueId, event: "resumed", actor: "admin", detail: { pausedMs } });
  return { ok: true };
}

/** Teams that would finish the player auction short of the minimum squad. */
export async function shortSquads(leagueId: string): Promise<Array<{ teamId: string; name: string; needed: number }>> {
  const data = await loadAuctionData(leagueId);
  if (!data) return [];
  return [...data.teams.values()]
    .map((t) => ({ teamId: t.id, name: t.name, needed: playersStillNeeded(t.squad, data.info.config.squadRules) }))
    .filter((t) => t.needed > 0);
}

export async function completeSession(leagueId: string, sessionId: string, force: boolean): Promise<ActionResult<{ short?: Array<{ name: string; needed: number }> }>> {
  const s = await sessionInLeague(leagueId, sessionId);
  if (!s || (s.status !== "active" && s.status !== "paused")) return fail(400, "The session isn't running");
  if (await getOpenLot(sessionId)) return fail(409, "A lot is still open — let it finish or cancel it first");
  if (s.type === "player" && !force) {
    const short = await shortSquads(leagueId);
    if (short.length) {
      return { ok: false, status: 409, error: `${short.length} team(s) are short of a full squad: ${short.map((t) => `${t.name} needs ${t.needed}`).join(", ")}` };
    }
  }
  await db.batch([
    db
      .update(cricketAuctionSessions)
      .set({ status: "completed", completedAt: new Date(), nominationDeadline: null, intermissionUntil: null, pausedAt: null })
      .where(eq(cricketAuctionSessions.id, sessionId)),
    bumpStateVersion(leagueId),
  ]);
  await logTurnEvent({ sessionId, leagueId, event: "completed", actor: "admin", detail: { force } });
  return { ok: true };
}

/** Delete a session that hasn't started. */
export async function deletePendingSession(leagueId: string, sessionId: string): Promise<ActionResult> {
  const res = await db
    .delete(cricketAuctionSessions)
    .where(and(eq(cricketAuctionSessions.id, sessionId), eq(cricketAuctionSessions.leagueId, leagueId), eq(cricketAuctionSessions.status, "pending")));
  if (res.rowsAffected === 0) return fail(400, "Only a session that hasn't started can be deleted");
  await bumpStateVersion(leagueId);
  return { ok: true };
}

// ─── Corrections ─────────────────────────────────────────────────────────────

/** Withdraw the open lot without a sale. The same team then nominates again. */
export async function cancelOpenLot(leagueId: string, sessionId: string): Promise<ActionResult> {
  const lot = await getOpenLot(sessionId);
  if (!lot || lot.leagueId !== leagueId) return fail(400, "No lot is open");
  const res = await db
    .update(cricketAuctionLots)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(cricketAuctionLots.id, lot.id), eq(cricketAuctionLots.status, "open")));
  if (res.rowsAffected === 0) return fail(409, "The lot just closed");
  await db.insert(cricketAuctionBidLogs).values({ id: generateId(), lotId: lot.id, teamId: lot.nominatorTeamId, amount: lot.currentHighBid, type: "cancelled" });
  await logTurnEvent({ sessionId, leagueId, teamId: lot.nominatorTeamId, event: "nomination-cancelled", actor: "admin", detail: { lotId: lot.id } });
  return { ok: true };
}

/** Reverse a sale: the buyer gets the money back and the player (or franchise) is unsold again. */
export async function undoSale(leagueId: string, lotId: string): Promise<ActionResult> {
  const [lot] = await db.select().from(cricketAuctionLots).where(and(eq(cricketAuctionLots.id, lotId), eq(cricketAuctionLots.leagueId, leagueId))).limit(1);
  if (!lot || lot.status !== "sold") return fail(400, "That lot wasn't sold");
  const session = await getSession(lot.sessionId);
  if (session?.status === "completed" && session.type === "player") return fail(409, "The player auction is finished; squads are final");
  const now = new Date();
  await db.batch([
    lot.lotKind === "player"
      ? db.delete(cricketSquadPlayers).where(and(eq(cricketSquadPlayers.lotId, lot.id), eq(cricketSquadPlayers.leagueId, leagueId)))
      : db.delete(cricketFranchiseOwnership).where(and(eq(cricketFranchiseOwnership.lotId, lot.id), eq(cricketFranchiseOwnership.leagueId, leagueId))),
    db
      .update(cricketTeamState)
      .set({ purse: sql`${cricketTeamState.purse} + ${lot.currentHighBid}`, spent: sql`${cricketTeamState.spent} - ${lot.currentHighBid}`, updatedAt: now })
      .where(eq(cricketTeamState.teamId, lot.currentHighBidderId)),
    db.update(cricketAuctionLots).set({ status: "cancelled", updatedAt: now }).where(eq(cricketAuctionLots.id, lot.id)),
    db.insert(cricketAuctionBidLogs).values({ id: generateId(), lotId: lot.id, teamId: lot.currentHighBidderId, amount: lot.currentHighBid, type: "cancelled" }),
    bumpStateVersion(leagueId),
  ]);
  await logTurnEvent({ sessionId: lot.sessionId, leagueId, teamId: lot.currentHighBidderId, event: "sale-undone", actor: "admin", detail: { lotId, name: lot.name, price: lot.currentHighBid } });
  return { ok: true };
}

/** Owe a team an extra nomination turn (served before the ring continues). */
export async function grantMakeupTurn(leagueId: string, sessionId: string, teamId: string): Promise<ActionResult> {
  const s = await sessionInLeague(leagueId, sessionId);
  if (!s || s.status === "completed") return fail(400, "The session isn't running");
  if (!parseIdList(s.ringOrder).includes(teamId)) return fail(400, "That team isn't in this session");
  const queue = [...parseIdList(s.makeupQueue), teamId];
  const res = await db
    .update(cricketAuctionSessions)
    .set({ makeupQueue: JSON.stringify(queue) })
    .where(and(eq(cricketAuctionSessions.id, sessionId), eq(cricketAuctionSessions.makeupQueue, s.makeupQueue)));
  if (res.rowsAffected === 0) return fail(409, "The session changed — try again");
  await logTurnEvent({ sessionId, leagueId, teamId, event: "makeup-granted", actor: "admin", detail: { queue } });
  return { ok: true };
}

/** Undo the whole auction: sessions, sales, franchises and penalties go; purses are restored. */
export async function resetAuction(leagueId: string): Promise<ActionResult> {
  const info = await loadCricketLeague(leagueId);
  if (!info) return fail(404, "Not a cricket league");
  const lid = info.league.id;
  const lotIds = (await db.select({ id: cricketAuctionLots.id }).from(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, lid))).map((l) => l.id);
  await db.batch([
    db.delete(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, lid)),
    ...(lotIds.length ? [db.delete(cricketAuctionBidLogs).where(inArray(cricketAuctionBidLogs.lotId, lotIds))] : []),
    db.delete(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, lid)),
    db.delete(cricketTeamPenalties).where(eq(cricketTeamPenalties.leagueId, lid)),
    db.delete(cricketAuctionTurnEvents).where(eq(cricketAuctionTurnEvents.leagueId, lid)),
    db.delete(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, lid)),
    db.delete(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, lid)),
    db.update(cricketTeamState).set({ purse: info.config.purse, spent: 0, penaltySlots: 0, updatedAt: new Date() }).where(eq(cricketTeamState.leagueId, lid)),
    bumpStateVersion(lid),
  ]);
  return { ok: true };
}

// ─── Team actions ────────────────────────────────────────────────────────────

/** Clear one penalty slot for the league's redeem price, while the player auction is still on. */
export async function redeemPenalty(leagueId: string, teamId: string): Promise<ActionResult<{ price: number }>> {
  const data = await loadAuctionData(leagueId);
  if (!data) return fail(404, "Not a cricket league");
  const team = data.teams.get(teamId);
  if (!team) return fail(403, "You're not on a team in this league");
  if (team.penaltySlots <= 0) return fail(400, "You have no penalty slots");
  const sessions = await leagueSessions(data.info.league.id);
  if (sessions.some((s) => s.type === "player" && s.status === "completed")) return fail(409, "The player auction is over");
  const price = data.info.config.penaltyRedeemPrice;
  const reserve = playersStillNeeded(team.squad, data.info.config.squadRules) * cheapestUnsoldBase(data);
  if (team.purse - price < reserve) return fail(400, "You can't afford that and still complete your squad");
  const [penalty] = await db
    .select({ id: cricketTeamPenalties.id })
    .from(cricketTeamPenalties)
    .where(and(eq(cricketTeamPenalties.teamId, teamId), isNull(cricketTeamPenalties.redeemedAt)))
    .orderBy(asc(cricketTeamPenalties.createdAt))
    .limit(1);
  const now = new Date();
  const ok = await db.transaction(async (tx) => {
    const res = await tx
      .update(cricketTeamState)
      .set({ purse: sql`${cricketTeamState.purse} - ${price}`, spent: sql`${cricketTeamState.spent} + ${price}`, penaltySlots: sql`${cricketTeamState.penaltySlots} - 1`, updatedAt: now })
      .where(and(eq(cricketTeamState.teamId, teamId), sql`${cricketTeamState.penaltySlots} > 0`, sql`${cricketTeamState.purse} >= ${price}`));
    if (res.rowsAffected === 0) return false;
    if (penalty) await tx.update(cricketTeamPenalties).set({ redeemedAt: now, redemptionPrice: price }).where(eq(cricketTeamPenalties.id, penalty.id));
    return true;
  });
  if (!ok) return fail(409, "That didn't go through — try again");
  await bumpStateVersion(data.info.league.id);
  return { ok: true, price };
}

export async function getWishlist(leagueId: string, teamId: string): Promise<number[]> {
  const rows = await db
    .select({ playerId: cricketWishlists.playerId })
    .from(cricketWishlists)
    .where(and(eq(cricketWishlists.leagueId, leagueId), eq(cricketWishlists.teamId, teamId)))
    .orderBy(asc(cricketWishlists.priority));
  return rows.map((r) => r.playerId);
}

/** Replace a team's wishlist with `playerIds`, in priority order. */
export async function setWishlist(leagueId: string, teamId: string, playerIds: number[]): Promise<ActionResult> {
  const data = await loadAuctionData(leagueId);
  if (!data) return fail(404, "Not a cricket league");
  const unique = [...new Set(playerIds)].filter((id) => data.pool.players.has(id)).slice(0, 200);
  await db.batch([
    db.delete(cricketWishlists).where(and(eq(cricketWishlists.leagueId, data.info.league.id), eq(cricketWishlists.teamId, teamId))),
    ...(unique.length
      ? [db.insert(cricketWishlists).values(unique.map((playerId, i) => ({ id: generateId(), leagueId: data.info.league.id, teamId, playerId, priority: i + 1 })))]
      : []),
  ]);
  return { ok: true };
}

// ─── Simulation (superadmin rehearsals and tests) ────────────────────────────

/**
 * Run both auctions instantly: every team buys a franchise it can afford (at the opening price, in
 * a random order), then players are dealt round by round at base price until every squad reaches
 * the minimum. Records real sessions, lots and purchases, all completed. Only on a league whose
 * auction hasn't started.
 */
export async function simulateAuction(leagueId: string): Promise<ActionResult<{ franchises: number; players: number }>> {
  const info = await loadCricketLeague(leagueId);
  if (!info) return fail(404, "Not a cricket league");
  const lid = info.league.id;
  const existing = await leagueSessions(lid);
  if (existing.some((s) => s.status !== "pending")) return fail(409, "The auction has already started — reset it first");
  await db.delete(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, lid));
  const teamIds = shuffle((await db.select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, lid), eq(teams.isGhost, false)))).map((t) => t.id));
  const now = new Date();
  let franchises = 0;
  let players = 0;

  const record = async (sessionId: string, teamId: string, kind: "player" | "franchise", id: number, name: string, price: number) => {
    const lotId = generateId();
    await db.batch([
      db.insert(cricketAuctionLots).values({
        id: lotId,
        leagueId: lid,
        sessionId,
        lotKind: kind,
        playerId: kind === "player" ? id : null,
        cricketTeamId: kind === "franchise" ? id : null,
        name,
        nominatorTeamId: teamId,
        openingPrice: price,
        currentHighBid: price,
        currentHighBidderId: teamId,
        status: "sold",
        expiresAt: now,
      }),
      kind === "player"
        ? db.insert(cricketSquadPlayers).values({ id: generateId(), leagueId: lid, teamId, playerId: id, price, sessionId, lotId })
        : db.insert(cricketFranchiseOwnership).values({ id: generateId(), leagueId: lid, teamId, cricketTeamId: id, price, sessionId, lotId }),
      db
        .update(cricketTeamState)
        .set({ purse: sql`${cricketTeamState.purse} - ${price}`, spent: sql`${cricketTeamState.spent} + ${price}` })
        .where(eq(cricketTeamState.teamId, teamId)),
    ]);
  };

  if (info.config.franchiseAuctionEnabled) {
    const sessionId = generateId();
    await db.insert(cricketAuctionSessions).values({ id: sessionId, leagueId: lid, type: "franchise", status: "completed", ringOrder: JSON.stringify(teamIds), startedAt: now, completedAt: now });
    for (const teamId of teamIds) {
      const data = (await loadAuctionData(lid))!;
      const options = [...data.pool.realTeams.values()].filter((t) => checkFranchisePurchase(data, teamId, t.id, franchiseOpening(data, t.id)).ok);
      if (!options.length) continue;
      const pick = options[Math.floor(Math.random() * options.length)];
      await record(sessionId, teamId, "franchise", pick.id, pick.name, franchiseOpening(data, pick.id));
      franchises++;
    }
  }

  const sessionId = generateId();
  await db.insert(cricketAuctionSessions).values({ id: sessionId, leagueId: lid, type: "player", status: "completed", ringOrder: JSON.stringify(teamIds), startedAt: now, completedAt: now });
  for (let round = 0; round < info.config.squadRules.maxSize; round++) {
    let bought = 0;
    for (const teamId of teamIds) {
      const data = (await loadAuctionData(lid))!;
      const team = data.teams.get(teamId)!;
      if (playersStillNeeded(team.squad, data.info.config.squadRules) === 0) continue;
      const options = [...data.pool.players.values()].filter((p) => !data.playerOwner.has(p.id) && checkPlayerPurchase(data, teamId, p.id, p.basePrice).ok);
      if (!options.length) continue;
      const pick = options[Math.floor(Math.random() * options.length)];
      await record(sessionId, teamId, "player", pick.id, pick.name, pick.basePrice);
      players++;
      bought++;
    }
    if (bought === 0) break;
  }
  await bumpStateVersion(lid);
  return { ok: true, franchises, players };
}

/** Recent sales (newest first) for the room's feed and the admin's undo list. */
export async function recentSales(leagueId: string, limit = 30) {
  return db
    .select({
      lotId: cricketAuctionLots.id,
      sessionId: cricketAuctionLots.sessionId,
      kind: cricketAuctionLots.lotKind,
      name: cricketAuctionLots.name,
      playerId: cricketAuctionLots.playerId,
      cricketTeamId: cricketAuctionLots.cricketTeamId,
      teamId: cricketAuctionLots.currentHighBidderId,
      price: cricketAuctionLots.currentHighBid,
      at: cricketAuctionLots.updatedAt,
    })
    .from(cricketAuctionLots)
    .where(and(eq(cricketAuctionLots.leagueId, leagueId), eq(cricketAuctionLots.status, "sold")))
    .orderBy(desc(cricketAuctionLots.updatedAt))
    .limit(limit);
}

/** Recent turn events, for the admin monitor. */
export async function recentTurnEvents(sessionId: string, limit = 40) {
  return db
    .select()
    .from(cricketAuctionTurnEvents)
    .where(eq(cricketAuctionTurnEvents.sessionId, sessionId))
    .orderBy(desc(cricketAuctionTurnEvents.createdAt))
    .limit(limit);
}
