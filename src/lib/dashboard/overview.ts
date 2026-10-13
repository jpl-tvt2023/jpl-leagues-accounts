/**
 * The signed-in home page ("My leagues"): types, plus the pure step that turns per-league cards
 * into the summary tiles, the to-do list and the sport sections.
 *
 * Imports nothing that touches the database, so client components can import the types and
 * `tests/unit/overview.test.ts` can run `buildOverview` without one. The per-league reads live in
 * `league-summary.ts`.
 */

import { compareSports, sportInfo, type SportInfo } from "../sports";

export interface FixtureBrief {
  gw: number;
  opponent: string;
  home: boolean;
}

export interface ResultBrief extends FixtureBrief {
  outcome: "W" | "D" | "L";
  scored: number;
  conceded: number;
}

/** TVT and Continental Championship: head-to-head leagues. */
export interface H2hStatus {
  kind: "h2h";
  /** Rank in the team's group (TVT) or in the whole JPL table (Continental). */
  rank: number;
  of: number;
  /** TVT group letter, when the league has two groups. */
  groupName: string | null;
  /** TVT qualification band; null for Continental. */
  zone: "playoffs" | "challenger" | "eliminated" | null;
  /** League stage over — wording only ("Eliminated" vs "Elimination zone"). */
  stageComplete: boolean;
  leaguePoints: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  lastResult: ResultBrief | null;
  nextFixture: FixtureBrief | null;
  /** Captain for the gameweek currently open for submissions; null when nothing is open. */
  captain: { gw: number; deadline: string; set: boolean } | null;
  /** Continental only: JPL Cup group position. */
  cup: { rank: number; of: number; zone: "jcl" | "jel" } | null;
}

export interface AuctionStatus {
  kind: "auction";
  rank: number;
  of: number;
  totalPoints: number;
  purse: number;
  squadSize: number;
  lastGw: { gw: number; points: number; rank: number | null } | null;
  /** A live (active/paused) session, or the next scheduled one. */
  auction: { state: "live" | "scheduled"; sessionId: string; at: string | null } | null;
}

export interface ClassicStatus {
  kind: "classic";
  rank: number;
  of: number;
  totalPoints: number;
  entryName: string;
}

/** Classic Cricket Auction. */
export interface CricketStatus {
  kind: "cricket";
  rank: number;
  of: number;
  totalPoints: number;
  /** Lakhs. */
  purse: number;
  squadSize: number;
  franchiseCode: string | null;
  /** A live (active/paused) auction session, or the next pending one. */
  auction: { state: "live" | "scheduled"; type: "franchise" | "player"; at: string | null } | null;
}

export type LeagueStatus = H2hStatus | AuctionStatus | ClassicStatus | CricketStatus;

/** One league the person plays in, runs, or (FPL Classic) has a saved FPL team in. */
export interface MyLeagueCard {
  leagueId: string;
  slug: string;
  name: string;
  sport: string;
  format: string;
  season: string;
  isActive: boolean;
  teamSize: number | null;
  /** "team": plays here; "admin": runs it without playing; "classic": an FPL team of theirs is entered. */
  relation: "team" | "admin" | "classic";
  /** Also an admin of this league (admins can play too). */
  isAdmin: boolean;
  teamName: string | null;
  role: "owner" | "member" | null;
  needsSetup: boolean;
  isProfileComplete: boolean;
  /** Whether the team has a second FPL manager to wait for (TVT, Continental). */
  hasPartnerSlot: boolean;
  /** Join requests waiting for this league's admins (admins only). */
  pendingRequests: number;
  /** The league's next FPL deadline after `now`, if it has one. */
  nextDeadline: { gw: number; at: string } | null;
  status: LeagueStatus | null;
  /** The status couldn't be loaded; the card still renders. */
  error: boolean;
}

/** An active league the person has nothing to do with. */
export interface OtherLeague {
  id: string;
  slug: string;
  name: string;
  sport: string;
  format: string;
  season: string;
  isActive: boolean;
  teamSize: number | null;
}

export interface PendingJoin {
  requestId: string;
  leagueId: string;
  slug: string;
  leagueName: string;
}

export type TodoKind = "setup" | "partner" | "captain" | "auction-live" | "auction-soon" | "join-requests" | "awaiting-approval";

export interface TodoItem {
  id: string;
  kind: TodoKind;
  leagueName: string;
  text: string;
  href: string;
  /** When it stops being actionable (a deadline, an auction start). */
  dueAt: string | null;
  /** Needs doing now, rather than just worth knowing. */
  urgent: boolean;
}

export interface OverviewSummary {
  /** Distinct leagues on the page as "yours" (playing in one you also run counts once). */
  leagues: number;
  playing: number;
  running: number;
  nextDeadline: { gw: number; at: string } | null;
  /** Head-to-head record in the latest gameweek any head-to-head league has a result for. */
  lastGw: { gw: number; wins: number; draws: number; losses: number } | null;
  todoCount: number;
}

export interface SportSectionData extends SportInfo {
  mine: MyLeagueCard[];
  others: OtherLeague[];
}

export interface Overview {
  serverTime: string;
  /** For the greeting. */
  person: { name: string | null; username: string | null };
  summary: OverviewSummary;
  todo: TodoItem[];
  sports: SportSectionData[];
  pending: PendingJoin[];
  /** Superadmin: runs every league from /admin. */
  allLeagues: boolean;
}

export interface OverviewInput {
  now: Date;
  person: Overview["person"];
  /** The league the person opened last (cookie), shown first. */
  lastLeagueSlug: string | null;
  cards: MyLeagueCard[];
  others: OtherLeague[];
  pending: PendingJoin[];
  allLeagues: boolean;
}

const AUCTION_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/** Where a card's main link goes. */
export function cardHref(card: Pick<MyLeagueCard, "slug" | "leagueId" | "relation" | "needsSetup">): string {
  if (card.relation === "admin") return `/admin/${card.leagueId}`;
  if (card.relation === "classic") return `/${card.slug}/standings`;
  return card.needsSetup ? `/${card.slug}/setup` : `/${card.slug}/dashboard`;
}

function todosFor(card: MyLeagueCard, now: Date): TodoItem[] {
  const items: TodoItem[] = [];
  const base = { leagueName: card.name };
  const id = (kind: TodoKind) => `${kind}:${card.leagueId}`;

  if (card.relation === "team") {
    if (card.needsSetup) {
      items.push({ ...base, id: id("setup"), kind: "setup", text: "Finish setting up your team", href: `/${card.slug}/setup`, dueAt: null, urgent: true });
    } else if (card.hasPartnerSlot && !card.isProfileComplete && card.role === "owner") {
      items.push({ ...base, id: id("partner"), kind: "partner", text: "Your partner hasn't joined yet — send them an invite", href: `/${card.slug}/team`, dueAt: null, urgent: true });
    }

    const s = card.status;
    if (s?.kind === "h2h" && s.captain && !s.captain.set && Date.parse(s.captain.deadline) > now.getTime()) {
      items.push({
        ...base,
        id: id("captain"),
        kind: "captain",
        text: `Pick your captain for GW${s.captain.gw}`,
        href: `/${card.slug}/dashboard`,
        dueAt: s.captain.deadline,
        urgent: true,
      });
    }
    if (s?.kind === "auction" && s.auction) {
      if (s.auction.state === "live") {
        items.push({ ...base, id: id("auction-live"), kind: "auction-live", text: "The auction is live", href: `/${card.slug}/auction`, dueAt: null, urgent: true });
      } else if (s.auction.at && Date.parse(s.auction.at) - now.getTime() <= AUCTION_SOON_MS) {
        items.push({ ...base, id: id("auction-soon"), kind: "auction-soon", text: "An auction is coming up", href: `/${card.slug}/auction`, dueAt: s.auction.at, urgent: false });
      }
    }
    if (s?.kind === "cricket" && s.auction) {
      const href = `/${card.slug}/cricket/auction`;
      const what = s.auction.type === "franchise" ? "franchise auction" : "player auction";
      if (s.auction.state === "live") {
        items.push({ ...base, id: id("auction-live"), kind: "auction-live", text: `The ${what} is live`, href, dueAt: null, urgent: true });
      } else if (s.auction.at && Date.parse(s.auction.at) > now.getTime() && Date.parse(s.auction.at) - now.getTime() <= AUCTION_SOON_MS) {
        items.push({ ...base, id: id("auction-soon"), kind: "auction-soon", text: `The ${what} is coming up`, href, dueAt: s.auction.at, urgent: false });
      }
    }
  }

  if (card.isAdmin && card.pendingRequests > 0) {
    const n = card.pendingRequests;
    items.push({
      ...base,
      id: id("join-requests"),
      kind: "join-requests",
      text: `${n} join request${n === 1 ? "" : "s"} waiting for you`,
      href: `/admin/${card.leagueId}`,
      dueAt: null,
      urgent: true,
    });
  }
  return items;
}

/** Urgent first; then anything with a time, soonest first; then the rest in league order. */
function compareTodos(a: TodoItem, b: TodoItem): number {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  if (a.dueAt && b.dueAt) return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return 0;
}

/**
 * Card order inside a sport: the league opened last, then leagues with something to do, then
 * leagues you play in before ones you only run or follow, then by name.
 */
function orderCards(cards: MyLeagueCard[], lastLeagueSlug: string | null, todoLeagues: Set<string>): MyLeagueCard[] {
  const relationRank = { team: 0, classic: 1, admin: 2 } as const;
  return [...cards].sort((a, b) => {
    const aLast = a.slug === lastLeagueSlug;
    const bLast = b.slug === lastLeagueSlug;
    if (aLast !== bLast) return aLast ? -1 : 1;
    const aTodo = todoLeagues.has(a.leagueId);
    const bTodo = todoLeagues.has(b.leagueId);
    if (aTodo !== bTodo) return aTodo ? -1 : 1;
    if (a.relation !== b.relation) return relationRank[a.relation] - relationRank[b.relation];
    return a.name.localeCompare(b.name);
  });
}

function lastGwRecord(cards: MyLeagueCard[]): OverviewSummary["lastGw"] {
  const results = cards
    .map((c) => (c.relation === "team" && c.status?.kind === "h2h" ? c.status.lastResult : null))
    .filter((r): r is ResultBrief => r !== null);
  if (results.length === 0) return null;
  const gw = Math.max(...results.map((r) => r.gw));
  const latest = results.filter((r) => r.gw === gw);
  return {
    gw,
    wins: latest.filter((r) => r.outcome === "W").length,
    draws: latest.filter((r) => r.outcome === "D").length,
    losses: latest.filter((r) => r.outcome === "L").length,
  };
}

function nextDeadline(cards: MyLeagueCard[], now: Date): OverviewSummary["nextDeadline"] {
  let best: { gw: number; at: string } | null = null;
  for (const c of cards) {
    if (c.relation !== "team" || !c.nextDeadline) continue;
    const at = Date.parse(c.nextDeadline.at);
    if (at <= now.getTime()) continue;
    if (!best || at < Date.parse(best.at)) best = c.nextDeadline;
  }
  return best;
}

export function buildOverview(input: OverviewInput): Overview {
  const { now, cards, others, pending } = input;

  const todo = cards.flatMap((c) => todosFor(c, now));
  for (const p of pending) {
    todo.push({
      id: `awaiting-approval:${p.leagueId}`,
      kind: "awaiting-approval",
      leagueName: p.leagueName,
      text: "Your request to join is waiting for the admin",
      href: `/${p.slug}`,
      dueAt: null,
      urgent: false,
    });
  }
  todo.sort(compareTodos);
  const todoLeagues = new Set(cards.filter((c) => todosFor(c, now).length > 0).map((c) => c.leagueId));

  const sportSlugs = [...new Set([...cards.map((c) => c.sport), ...others.map((o) => o.sport)])].sort(compareSports);
  const sports: SportSectionData[] = sportSlugs.map((sport) => ({
    ...sportInfo(sport),
    mine: orderCards(cards.filter((c) => c.sport === sport), input.lastLeagueSlug, todoLeagues),
    others: others.filter((o) => o.sport === sport).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return {
    serverTime: now.toISOString(),
    person: input.person,
    summary: {
      leagues: cards.length,
      playing: cards.filter((c) => c.relation === "team" || c.relation === "classic").length,
      running: cards.filter((c) => c.isAdmin).length,
      nextDeadline: nextDeadline(cards, now),
      lastGw: lastGwRecord(cards),
      todoCount: todo.length,
    },
    todo,
    sports,
    pending,
    allLeagues: input.allLeagues,
  };
}
