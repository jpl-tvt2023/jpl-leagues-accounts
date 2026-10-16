/**
 * The FPL auction room's extras, as pure functions over what the room already loads: the latest
 * sale (for the SOLD moment during the post-sale pause) and the finished session's results.
 */

export interface FplHistoryBid {
  id: string;
  fplElementId?: number;
  lotNumber?: number | null;
  playerName: string;
  currentHighBid: number;
  currentHighBidderId: string;
  status: string;
  updatedAt: string;
}

export interface FplSale {
  bidId: string;
  fplElementId: number | null;
  lotNumber: number | null;
  playerName: string;
  winnerId: string;
  price: number;
  /** When it sold (server time, ms). */
  at: number;
}

/** The session's most recent sale in its bid history, or null. */
export function latestSale(bids: FplHistoryBid[] | undefined): FplSale | null {
  let best: FplHistoryBid | null = null;
  for (const b of bids ?? []) {
    if (b.status !== "sold") continue;
    if (!best || Date.parse(b.updatedAt) > Date.parse(best.updatedAt)) best = b;
  }
  if (!best) return null;
  return {
    bidId: best.id,
    fplElementId: best.fplElementId ?? null,
    lotNumber: best.lotNumber ?? null,
    playerName: best.playerName,
    winnerId: best.currentHighBidderId,
    price: best.currentHighBid,
    at: Date.parse(best.updatedAt),
  };
}

export interface FplResultItem {
  id: string;
  name: string;
  price: number;
  fplElementId?: number;
  /** Bought in this session (a mini-auction's results show whole squads). */
  boughtHere: boolean;
}

export interface FplResultTeam {
  id: string;
  name: string;
  isMe: boolean;
  purseLeft: number;
  countLabel: string;
  items: FplResultItem[];
}

/**
 * Each team's result, in nomination order. A player session shows the team's whole squad from the
 * league-owned summaries — which also covers simulated auctions, where no bids exist — marking this
 * session's buys; a club auction shows the club each team bought.
 */
export function buildFplFinalResults(input: {
  order: readonly string[];
  summaries: Record<string, { purse: number; players: Array<{ fplElementId: number; playerName: string; purchasePrice: number }> }>;
  /** This session's bids (any status); only the sold ones count. */
  bids: readonly FplHistoryBid[];
  clubAuction: boolean;
  nameOf: (teamId: string) => string;
  myTeamId: string | null;
}): FplResultTeam[] {
  const sold = input.bids.filter((b) => b.status === "sold");
  const boughtHere = new Set(sold.map((b) => `${b.currentHighBidderId}:${b.fplElementId}`));
  return input.order.map((teamId) => {
    const summary = input.summaries[teamId];
    if (input.clubAuction) {
      const clubs = sold.filter((b) => b.currentHighBidderId === teamId);
      return {
        id: teamId,
        name: input.nameOf(teamId),
        isMe: teamId === input.myTeamId,
        purseLeft: summary?.purse ?? 0,
        countLabel: clubs.length ? "Club" : "No club",
        items: clubs.map((b) => ({ id: b.id, name: b.playerName, price: b.currentHighBid, boughtHere: true })),
      };
    }
    const players = summary?.players ?? [];
    return {
      id: teamId,
      name: input.nameOf(teamId),
      isMe: teamId === input.myTeamId,
      purseLeft: summary?.purse ?? 0,
      countLabel: `${players.length} player${players.length === 1 ? "" : "s"}`,
      items: players.map((p) => ({ id: String(p.fplElementId), name: p.playerName, price: p.purchasePrice, fplElementId: p.fplElementId, boughtHere: boughtHere.has(`${teamId}:${p.fplElementId}`) })),
    };
  });
}
