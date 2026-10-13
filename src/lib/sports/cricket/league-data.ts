/** League-scoped cricket rows: what a cricket league owns beyond the shared league/team rows. */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  cricketLeagueConfig,
  cricketTeamState,
  cricketAuctionSessions,
  cricketAuctionLots,
  cricketAuctionBidLogs,
  cricketAuctionTurnEvents,
  cricketWishlists,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketTeamPenalties,
} from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Delete every cricket row of a league, children first. ON DELETE CASCADE would cover most of
 * these, but the league delete route deletes explicitly rather than trusting the foreign-key
 * pragma, and this keeps it that way. Tournament data is shared and is never touched.
 */
export async function deleteCricketLeagueData(tx: Tx, leagueId: string): Promise<void> {
  const lotIds = (await tx.select({ id: cricketAuctionLots.id }).from(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, leagueId))).map((l) => l.id);
  if (lotIds.length) await tx.delete(cricketAuctionBidLogs).where(inArray(cricketAuctionBidLogs.lotId, lotIds));
  await tx.delete(cricketAuctionTurnEvents).where(eq(cricketAuctionTurnEvents.leagueId, leagueId));
  await tx.delete(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, leagueId));
  await tx.delete(cricketWishlists).where(eq(cricketWishlists.leagueId, leagueId));
  await tx.delete(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, leagueId));
  await tx.delete(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, leagueId));
  await tx.delete(cricketTeamPenalties).where(eq(cricketTeamPenalties.leagueId, leagueId));
  await tx.delete(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, leagueId));
  await tx.delete(cricketTeamState).where(eq(cricketTeamState.leagueId, leagueId));
  await tx.delete(cricketLeagueConfig).where(eq(cricketLeagueConfig.leagueId, leagueId));
}
