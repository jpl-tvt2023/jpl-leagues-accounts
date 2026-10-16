/**
 * The auction room's feed and log: every closed lot of a session (sold or cancelled) with its
 * nomination, bids and result, plus the turn events a manager cares about (missed turns, automatic
 * nominations, sales undone or moved). The room fetches it when a sale or a penalty lands, not on
 * every bid — the open lot's bids come with the snapshot.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, cricketAuctionSessions, cricketAuctionLots, cricketAuctionBidLogs, cricketAuctionTurnEvents } from "@/lib/db";
import { loadCricketLeague } from "../league";
import { pickCurrent } from "./snapshot";

/** Turn events that belong in the room's feed. */
export const FEED_EVENTS = ["penalised", "skipped", "auto-nominated", "sale-undone", "sale-moved"] as const;

export interface FeedLog {
  teamId: string;
  amount: number;
  type: "nomination" | "bid" | "sold" | "cancelled";
  at: string;
}

export interface FeedLot {
  id: string;
  /** Sold lots are numbered in the order they were nominated; cancelled ones have none. */
  lotNumber: number | null;
  kind: "player" | "franchise";
  name: string;
  playerId: number | null;
  cricketTeamId: number | null;
  status: "sold" | "cancelled";
  /** The buyer (sold) or the last high bidder (cancelled). */
  teamId: string;
  price: number;
  nominatorTeamId: string;
  at: string;
  logs: FeedLog[];
}

export interface FeedEvent {
  id: string;
  event: (typeof FEED_EVENTS)[number];
  teamId: string | null;
  at: string;
  detail: unknown;
}

export interface SessionFeed {
  sessionId: string | null;
  lots: FeedLot[];
  events: FeedEvent[];
}

const parseDetail = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** A session's feed, newest first (the room's current session when none is named). */
export async function loadSessionFeed(leagueRef: string, sessionId?: string | null): Promise<SessionFeed | null> {
  const info = await loadCricketLeague(leagueRef);
  if (!info) return null;
  const lid = info.league.id;
  const sessions = await db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, lid)).orderBy(asc(cricketAuctionSessions.createdAt));
  const session = sessionId ? sessions.find((s) => s.id === sessionId) : pickCurrent(sessions);
  if (!session) return { sessionId: null, lots: [], events: [] };

  const [lots, events] = await Promise.all([
    db
      .select()
      .from(cricketAuctionLots)
      .where(and(eq(cricketAuctionLots.sessionId, session.id), inArray(cricketAuctionLots.status, ["sold", "cancelled"])))
      .orderBy(asc(cricketAuctionLots.createdAt)),
    db
      .select()
      .from(cricketAuctionTurnEvents)
      .where(and(eq(cricketAuctionTurnEvents.sessionId, session.id), inArray(cricketAuctionTurnEvents.event, [...FEED_EVENTS])))
      .orderBy(desc(cricketAuctionTurnEvents.createdAt)),
  ]);
  const logs = lots.length
    ? await db
        .select()
        .from(cricketAuctionBidLogs)
        .where(inArray(cricketAuctionBidLogs.lotId, lots.map((l) => l.id)))
        .orderBy(asc(cricketAuctionBidLogs.createdAt), asc(cricketAuctionBidLogs.amount))
    : [];
  const logsByLot = new Map<string, FeedLog[]>();
  for (const l of logs) {
    logsByLot.set(l.lotId, [...(logsByLot.get(l.lotId) ?? []), { teamId: l.teamId, amount: l.amount, type: l.type as FeedLog["type"], at: l.createdAt.toISOString() }]);
  }

  let sold = 0;
  const feedLots: FeedLot[] = lots.map((l) => ({
    id: l.id,
    lotNumber: l.status === "sold" ? ++sold : null,
    kind: l.lotKind,
    name: l.name,
    playerId: l.playerId,
    cricketTeamId: l.cricketTeamId,
    status: l.status as FeedLot["status"],
    teamId: l.currentHighBidderId,
    price: l.currentHighBid,
    nominatorTeamId: l.nominatorTeamId,
    at: l.updatedAt.toISOString(),
    logs: logsByLot.get(l.id) ?? [],
  }));
  return {
    sessionId: session.id,
    lots: feedLots.reverse(),
    events: events.map((e) => ({ id: e.id, event: e.event as FeedEvent["event"], teamId: e.teamId, at: e.createdAt.toISOString(), detail: parseDetail(e.detail) })),
  };
}
