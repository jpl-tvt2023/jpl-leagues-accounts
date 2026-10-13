import { and, asc, count, eq, inArray, or } from "drizzle-orm";
import {
  auctionOwnership,
  auctionSessions,
  db,
  fixtures,
  fplClassicEntrants,
  gameweekCaptains,
  gameweeks,
  joinRequests,
  leagueAdmins,
  leagues,
  players,
  results,
  teamMembers,
  teams,
  type User,
} from "@/lib/db";
import { CONTINENTAL_FORMAT } from "@/lib/format-palette";
import { isCricketFormat } from "@/lib/sports/registry";
import { getLeagueView } from "@/lib/sports/cricket/league";
import { needsSetup, hasPlayerSlots } from "@/lib/membership";
import { computeLeagueStageStandings } from "@/lib/sports/fpl/standings/league-stage";
import { resolveSubmissionWindow } from "@/lib/sports/fpl/gameweeks/window";
import { getFinishedGwNumbers } from "@/lib/sports/fpl/gameweeks/finished-set";
import { cupGroupPosition } from "@/lib/sports/fpl/formats/continental-championship/cup-progress";
import { loadAuctionStandings } from "@/lib/sports/fpl/formats/auction/standings-load";
import { buildTeamLedger } from "@/lib/sports/fpl/formats/auction/finance";
import { rankRows } from "@/lib/sports/fpl/formats/fpl-classic/leaderboard";
import { myClassicEntries, type MyClassicEntry } from "@/lib/sports/fpl/formats/fpl-classic/my-entries";
import {
  buildOverview,
  type AuctionStatus,
  type ClassicStatus,
  type CricketStatus,
  type FixtureBrief,
  type H2hStatus,
  type MyLeagueCard,
  type OtherLeague,
  type Overview,
  type ResultBrief,
} from "./overview";

/**
 * Reads behind the signed-in home page (`GET /api/me/overview`): one card per league the person
 * plays in, runs, or has an FPL team entered in, each with a compact status.
 *
 * Every number comes from the helper the league's own pages use — the league-stage table, the
 * submission window, the auction standings, the cup group position — so the home page can't
 * disagree with them. No calls to FPL itself beyond the shared, cached finished-gameweek set.
 */

type Gw = { id: string; number: number; deadline: Date };
type FinishedSet = Set<number> | null;

const H2H_FORMATS = new Set(["tvt", CONTINENTAL_FORMAT]);

function nextDeadlineOf(gwsAsc: Gw[], now: Date): MyLeagueCard["nextDeadline"] {
  const next = gwsAsc.find((g) => g.deadline.getTime() > now.getTime());
  return next ? { gw: next.number, at: next.deadline.toISOString() } : null;
}

async function leagueGameweeks(leagueId: string): Promise<Gw[]> {
  return db
    .select({ id: gameweeks.id, number: gameweeks.number, deadline: gameweeks.deadline })
    .from(gameweeks)
    .where(eq(gameweeks.leagueId, leagueId))
    .orderBy(asc(gameweeks.number));
}

/** TVT / Continental: table position, last and next match, captain. */
async function h2hStatus(
  card: MyLeagueCard,
  team: { teamId: string; groupId: string | null; groupCount: number },
  now: Date,
  finished: () => Promise<FinishedSet>,
): Promise<{ status: H2hStatus; nextDeadline: MyLeagueCard["nextDeadline"] }> {
  const isContinental = card.format === CONTINENTAL_FORMAT;
  const { teamId } = team;

  const [gwsAsc, table, teamFixtures, leagueTeams, roster] = await Promise.all([
    leagueGameweeks(card.leagueId),
    computeLeagueStageStandings(card.leagueId),
    db
      .select({
        gw: gameweeks.number,
        homeTeamId: fixtures.homeTeamId,
        awayTeamId: fixtures.awayTeamId,
        competitionType: fixtures.competitionType,
        isChallenge: fixtures.isChallenge,
        homeScore: results.homeScore,
        awayScore: results.awayScore,
        homeMatchPoints: results.homeMatchPoints,
        awayMatchPoints: results.awayMatchPoints,
      })
      .from(fixtures)
      .innerJoin(gameweeks, eq(gameweeks.id, fixtures.gameweekId))
      .leftJoin(results, eq(results.fixtureId, fixtures.id))
      .where(and(eq(gameweeks.leagueId, card.leagueId), or(eq(fixtures.homeTeamId, teamId), eq(fixtures.awayTeamId, teamId)))),
    db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.leagueId, card.leagueId)),
    db.select({ id: players.id }).from(players).where(eq(players.teamId, teamId)),
  ]);
  const nameOf = new Map(leagueTeams.map((t) => [t.id, t.name]));

  // Position: the same ranked table the standings page and the dashboard read.
  const row = table.rows.find((r) => r.teamId === teamId) ?? null;
  let rank = 0;
  let of = 0;
  if (isContinental) {
    const all = table.byGroup.get("A") ?? table.rows;
    rank = all.findIndex((r) => r.teamId === teamId) + 1;
    of = all.length;
  } else if (row) {
    rank = row.groupRank;
    of = (table.byGroup.get(row.group ?? "A") ?? table.rows).length;
  }

  // Last result and next match: league fixtures only for Continental (the cup is its own line).
  const own = teamFixtures.filter((f) => !isContinental || !f.competitionType || f.competitionType === "jpl");
  const brief = (f: (typeof own)[number]): FixtureBrief => {
    const home = f.homeTeamId === teamId;
    return { gw: f.gw, home, opponent: nameOf.get(home ? f.awayTeamId : f.homeTeamId) ?? "TBC" };
  };
  const played = own.filter((f) => f.homeScore !== null).sort((a, b) => b.gw - a.gw || Number(a.isChallenge) - Number(b.isChallenge));
  const upcoming = own.filter((f) => f.homeScore === null).sort((a, b) => a.gw - b.gw || Number(a.isChallenge) - Number(b.isChallenge));

  let lastResult: ResultBrief | null = null;
  if (played[0]) {
    const f = played[0];
    const home = f.homeTeamId === teamId;
    const points = home ? f.homeMatchPoints! : f.awayMatchPoints!;
    lastResult = {
      ...brief(f),
      outcome: points === 2 ? "W" : points === 1 ? "D" : "L",
      scored: home ? f.homeScore! : f.awayScore!,
      conceded: home ? f.awayScore! : f.homeScore!,
    };
  }

  // Captain for the gameweek open for submissions — the same window the dashboard's form uses.
  // Asked only when the team actually plays that gameweek (an eliminated team has nothing to pick).
  let captain: H2hStatus["captain"] = null;
  const window = resolveSubmissionWindow(gwsAsc, now, isContinental ? null : await finished(), {
    requirePreviousFinished: !isContinental,
  });
  if (window.state === "open" && window.gw && teamFixtures.some((f) => f.gw === window.gw!.number) && roster.length > 0) {
    const [picked] = await db
      .select({ id: gameweekCaptains.id })
      .from(gameweekCaptains)
      .where(and(eq(gameweekCaptains.gameweekId, window.gw.id), inArray(gameweekCaptains.playerId, roster.map((p) => p.id))))
      .limit(1);
    captain = { gw: window.gw.number, deadline: window.gw.deadline.toISOString(), set: !!picked };
  }

  let cup: H2hStatus["cup"] = null;
  if (isContinental && team.groupId) {
    const pos = await cupGroupPosition(teamId, team.groupId);
    if (pos.totalTeams > 0) cup = { rank: pos.rank, of: pos.totalTeams, zone: pos.cupZone };
  }

  return {
    nextDeadline: nextDeadlineOf(gwsAsc, now),
    status: {
      kind: "h2h",
      rank,
      of,
      groupName: !isContinental && team.groupCount > 1 ? row?.group ?? null : null,
      zone: isContinental ? null : row?.zone ?? null,
      stageComplete: table.maxPlayedGw >= table.leagueStageEnd,
      leaguePoints: row?.leaguePoints ?? 0,
      played: row?.played ?? 0,
      wins: row?.wins ?? 0,
      draws: row?.draws ?? 0,
      losses: row?.losses ?? 0,
      lastResult,
      nextFixture: upcoming[0] ? brief(upcoming[0]) : null,
      captain,
      cup,
    },
  };
}

/** Auction: table position, purse, squad, and any auction happening now or next. */
async function auctionStatus(
  card: MyLeagueCard,
  teamId: string,
  now: Date,
): Promise<{ status: AuctionStatus; nextDeadline: MyLeagueCard["nextDeadline"] }> {
  const [table, ledger, [squad], sessions, gwsAsc] = await Promise.all([
    loadAuctionStandings(card.leagueId),
    buildTeamLedger(card.leagueId, teamId),
    db
      .select({ n: count() })
      .from(auctionOwnership)
      .where(and(eq(auctionOwnership.teamId, teamId), eq(auctionOwnership.leagueId, card.leagueId), eq(auctionOwnership.status, "active"))),
    db
      .select({ id: auctionSessions.id, status: auctionSessions.status, scheduledAt: auctionSessions.scheduledAt })
      .from(auctionSessions)
      .where(eq(auctionSessions.leagueId, card.leagueId)),
    leagueGameweeks(card.leagueId),
  ]);

  const mine = table.standings.find((s) => s.teamId === teamId);
  const last = mine?.gwHistory.at(-1) ?? null;
  // Same rule as the live-status endpoint: an active or paused session is a live auction.
  const live = sessions.find((s) => s.status === "active" || s.status === "paused");
  const scheduled = sessions
    .filter((s) => s.status === "pending" && s.scheduledAt && s.scheduledAt.getTime() > now.getTime())
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];

  return {
    nextDeadline: nextDeadlineOf(gwsAsc, now),
    status: {
      kind: "auction",
      rank: mine?.rank ?? 0,
      of: table.standings.length,
      totalPoints: mine?.totalPoints ?? 0,
      // The Finance ledger is the purse's source of truth (as on the dashboard).
      purse: ledger?.currentPurse ?? mine?.purse ?? 0,
      squadSize: squad?.n ?? 0,
      lastGw: last ? { gw: last.gw, points: last.totalPoints, rank: last.rank || null } : null,
      auction: live
        ? { state: "live", sessionId: live.id, at: null }
        : scheduled
          ? { state: "scheduled", sessionId: scheduled.id, at: scheduled.scheduledAt!.toISOString() }
          : null,
    },
  };
}

/** Classic Cricket Auction: from the league view the cricket pages use (cached per data version). */
async function cricketStatus(card: MyLeagueCard, teamId: string): Promise<CricketStatus | null> {
  const view = await getLeagueView(card.leagueId);
  if (!view) return null;
  const row = view.standings.rows.find((r) => r.teamId === teamId);
  const team = view.teams.find((t) => t.id === teamId);
  const live = view.auctionSessions.find((s) => s.status === "active" || s.status === "paused");
  const next = view.auctionSessions.find((s) => s.status === "pending");
  return {
    kind: "cricket",
    rank: row?.rank ?? 0,
    of: view.teams.length,
    totalPoints: row?.total ?? 0,
    purse: team?.purse ?? view.config.purse,
    squadSize: team?.squadSize ?? 0,
    franchiseCode: team?.franchise?.code ?? null,
    auction: live
      ? { state: "live", type: live.type, at: null }
      : next
        ? { state: "scheduled", type: next.type, at: next.scheduledAt }
        : null,
  };
}

/**
 * FPL Classic: rank among the league's active entrants by season points, from the stored totals
 * the Classic sync keeps (so it can trail the live table by a sync).
 */
async function classicStatus(entry: MyClassicEntry): Promise<ClassicStatus> {
  const entrants = await db
    .select({ id: fplClassicEntrants.id, totalPoints: fplClassicEntrants.totalPoints, entryName: fplClassicEntrants.entryName })
    .from(fplClassicEntrants)
    .where(and(eq(fplClassicEntrants.leagueId, entry.leagueId), eq(fplClassicEntrants.isActive, true)));
  const ranked = rankRows(entrants.map((e) => ({ entrantId: e.id, value: e.totalPoints, name: e.entryName })));
  const mine = ranked.find((r) => r.entrantId === entry.entrantId);
  return { kind: "classic", rank: mine?.rank ?? 0, of: ranked.length, totalPoints: entry.totalPoints, entryName: entry.entryName };
}

const BLANK = {
  isAdmin: false,
  teamName: null,
  role: null,
  needsSetup: false,
  isProfileComplete: true,
  hasPartnerSlot: false,
  pendingRequests: 0,
  nextDeadline: null,
  status: null,
  error: false,
} satisfies Partial<MyLeagueCard>;

export async function loadOverview(user: Pick<User, "id" | "role" | "name" | "username">, opts: { now?: Date; lastLeagueSlug?: string | null } = {}): Promise<Overview> {
  const now = opts.now ?? new Date();

  const [memberships, adminRows, classic, pendingRows, activeLeagues] = await Promise.all([
    db
      .select({
        leagueId: leagues.id,
        slug: leagues.slug,
        name: leagues.name,
        sport: leagues.sport,
        format: leagues.format,
        season: leagues.season,
        isActive: leagues.isActive,
        teamSize: leagues.teamSize,
        groupCount: leagues.groupCount,
        teamId: teams.id,
        teamName: teams.name,
        groupId: teams.groupId,
        isProfileComplete: teams.isProfileComplete,
        playerId: teamMembers.playerId,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .innerJoin(leagues, eq(leagues.id, teamMembers.leagueId))
      .where(eq(teamMembers.userId, user.id)),
    user.role === "admin"
      ? db
          .select({
            leagueId: leagues.id,
            slug: leagues.slug,
            name: leagues.name,
            sport: leagues.sport,
            format: leagues.format,
            season: leagues.season,
            isActive: leagues.isActive,
            teamSize: leagues.teamSize,
          })
          .from(leagueAdmins)
          .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
          .where(eq(leagueAdmins.userId, user.id))
      : Promise.resolve([]),
    myClassicEntries(user.id),
    db
      .select({ requestId: joinRequests.id, leagueId: leagues.id, slug: leagues.slug, leagueName: leagues.name })
      .from(joinRequests)
      .innerJoin(leagues, eq(leagues.id, joinRequests.leagueId))
      .where(and(eq(joinRequests.userId, user.id), eq(joinRequests.status, "pending"))),
    db
      .select({
        id: leagues.id,
        slug: leagues.slug,
        name: leagues.name,
        sport: leagues.sport,
        format: leagues.format,
        season: leagues.season,
        isActive: leagues.isActive,
        teamSize: leagues.teamSize,
      })
      .from(leagues)
      .where(eq(leagues.isActive, true)),
  ]);

  const adminIds = new Set(adminRows.map((a) => a.leagueId));
  const requestCounts = new Map<string, number>();
  if (adminIds.size > 0) {
    const rows = await db
      .select({ leagueId: joinRequests.leagueId, n: count() })
      .from(joinRequests)
      .where(and(inArray(joinRequests.leagueId, [...adminIds]), eq(joinRequests.status, "pending")))
      .groupBy(joinRequests.leagueId);
    for (const r of rows) requestCounts.set(r.leagueId, r.n);
  }

  // One card per league: playing beats running beats a Classic entry.
  const cards = new Map<string, MyLeagueCard>();
  const teamOf = new Map<string, { teamId: string; groupId: string | null; groupCount: number }>();
  for (const m of memberships) {
    cards.set(m.leagueId, {
      ...BLANK,
      leagueId: m.leagueId,
      slug: m.slug,
      name: m.name,
      sport: m.sport,
      format: m.format,
      season: m.season,
      isActive: m.isActive,
      teamSize: m.teamSize,
      relation: "team",
      isAdmin: adminIds.has(m.leagueId),
      teamName: m.teamName,
      role: m.role,
      needsSetup: needsSetup({ format: m.format, isProfileComplete: m.isProfileComplete, playerId: m.playerId }),
      isProfileComplete: m.isProfileComplete,
      hasPartnerSlot: hasPlayerSlots(m.format),
      pendingRequests: requestCounts.get(m.leagueId) ?? 0,
    });
    teamOf.set(m.leagueId, { teamId: m.teamId, groupId: m.groupId, groupCount: m.groupCount });
  }
  for (const a of adminRows) {
    if (cards.has(a.leagueId)) continue;
    cards.set(a.leagueId, {
      ...BLANK,
      ...a,
      relation: "admin",
      isAdmin: true,
      pendingRequests: requestCounts.get(a.leagueId) ?? 0,
    });
  }
  const classicById = new Map<string, MyClassicEntry>();
  for (const c of classic) {
    if (cards.has(c.leagueId)) continue;
    classicById.set(c.leagueId, c);
    cards.set(c.leagueId, {
      ...BLANK,
      leagueId: c.leagueId,
      slug: c.slug,
      name: c.leagueName,
      sport: c.sport,
      format: "fpl-classic",
      season: c.season,
      isActive: c.isActive,
      teamSize: null,
      relation: "classic",
      teamName: c.entryName,
    });
  }

  // The finished-gameweek set is one cached FPL read; fetch it at most once, and only if a TVT
  // league needs it for its captain window.
  let finishedPromise: Promise<FinishedSet> | null = null;
  const finished = () => (finishedPromise ??= getFinishedGwNumbers());

  // Each league on its own: one that fails to load shows an error card, not a broken page.
  await Promise.all(
    [...cards.values()].map(async (card) => {
      try {
        const team = teamOf.get(card.leagueId);
        if (card.relation === "team" && team && !card.needsSetup) {
          if (H2H_FORMATS.has(card.format)) {
            Object.assign(card, await h2hStatus(card, team, now, finished));
          } else if (card.format === "auction") {
            Object.assign(card, await auctionStatus(card, team.teamId, now));
          } else if (isCricketFormat(card.format)) {
            card.status = await cricketStatus(card, team.teamId);
          }
        } else if (card.relation === "classic") {
          card.status = await classicStatus(classicById.get(card.leagueId)!);
        }
      } catch (err) {
        console.error(`[overview] ${card.slug} status failed:`, err);
        card.status = null;
        card.error = true;
      }
    }),
  );

  const others: OtherLeague[] = activeLeagues
    .filter((l) => !cards.has(l.id))
    .map((l) => ({ ...l, teamSize: l.teamSize ?? null }));

  return buildOverview({
    now,
    person: { name: user.name || null, username: user.username },
    lastLeagueSlug: opts.lastLeagueSlug ?? null,
    cards: [...cards.values()],
    others,
    pending: pendingRows,
    allLeagues: user.role === "superadmin",
  });
}
