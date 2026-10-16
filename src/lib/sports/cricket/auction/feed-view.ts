/**
 * The cricket room's feed lines, from the session feed (closed lots and turn events) and the open
 * lot's live bids. Pure, so the team room and the host room word things the same way.
 */

import type { FeedEntry } from "@/components/auction/LiveFeed";
import type { SessionFeed } from "./feed";
import type { SnapshotLot } from "./snapshot";

interface Words {
  /** A team's display name. */
  nameOf: (teamId: string | null | undefined) => string;
  /** A team's own name — for franchise sales, whose buyer is renamed to the franchise at once. */
  ownNameOf?: (teamId: string | null | undefined) => string;
  money: (lakhs: number) => string;
}

const detailOf = (detail: unknown): Record<string, unknown> => (detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {});

function logLine(lotId: string, i: number, log: { teamId: string; amount: number; type: string; at: string }, w: Words): FeedEntry {
  const who = w.nameOf(log.teamId);
  const text =
    log.type === "nomination" ? `${who} nominated at ${w.money(log.amount)}` : log.type === "bid" ? `${who} bid ${w.money(log.amount)}` : log.type === "sold" ? `Sold to ${who}` : "Cancelled";
  return { id: `${lotId}-${i}`, at: log.at, kind: log.type === "nomination" || log.type === "cancelled" ? "info" : "bid", text };
}

/**
 * Newest first: the open lot's bids as they come in, then each closed lot (SOLD, or cancelled —
 * opening shows its nomination and bids) and the turns that were missed, automatic, undone or moved.
 */
export function buildCricketFeed(feed: SessionFeed | null, openLot: SnapshotLot | null | undefined, w: Words): FeedEntry[] {
  const entries: FeedEntry[] = [];
  if (openLot) {
    openLot.history.forEach((h, i) => {
      entries.push({
        id: `live-${openLot.id}-${i}`,
        at: h.at,
        kind: h.type === "nomination" ? "info" : "live",
        text: h.type === "nomination" ? `${w.nameOf(h.teamId)} nominated ${openLot.name} at ${w.money(h.amount)}` : `${w.nameOf(h.teamId)} bid ${w.money(h.amount)} on ${openLot.name}`,
      });
    });
  }
  for (const lot of feed?.lots ?? []) {
    const children = lot.logs.filter((l) => l.type === "nomination" || l.type === "bid").map((l, i) => logLine(lot.id, i, l, w));
    entries.push(
      lot.status === "sold"
        ? { id: lot.id, at: lot.at, kind: "sold", text: `SOLD: ${lot.name} → ${(lot.kind === "franchise" && w.ownNameOf ? w.ownNameOf : w.nameOf)(lot.teamId)} for ${w.money(lot.price)}`, children }
        : { id: lot.id, at: lot.at, kind: "info", text: `Nomination cancelled: ${lot.name}`, children },
    );
  }
  for (const e of feed?.events ?? []) {
    const d = detailOf(e.detail);
    const who = w.nameOf(e.teamId);
    const name = typeof d.name === "string" ? d.name : "a lot";
    const text =
      e.event === "penalised"
        ? `${who} missed their turn — penalty slot`
        : e.event === "skipped"
          ? `${who}'s turn was skipped${typeof d.reason === "string" ? ` (${d.reason})` : ""}`
          : e.event === "auto-nominated"
            ? `${who} ran out of time — ${name} nominated for them`
            : e.event === "sale-undone"
              ? `Sale undone by the admin: ${name}`
              : `Sale moved by the admin: ${name} → ${who}${typeof d.price === "number" ? ` for ${w.money(d.price)}` : ""}`;
    entries.push({ id: e.id, at: e.at, kind: e.event === "penalised" ? "penalty" : "info", text });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
