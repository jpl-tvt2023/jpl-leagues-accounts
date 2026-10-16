/** Players sheet. Pure. */

import type { CricketRole } from "@/lib/db/schema-cricket";
import { cellText, mapSheet } from "./columns";
import { normalizeName, slugifyName, type TeamLookup } from "./names";
import { error, rowNumber, warning, type RawRow, type SheetIssue } from "./types";
import { parseWhole, parseYesNo } from "./values";

export interface PlayerRow {
  row: number;
  /** The sheet's player_id; "" when left blank (assignPlayerCodes fills it in). */
  code: string;
  name: string;
  teamCode: string;
  role: CricketRole;
  basePrice: number;
  overseas: boolean;
  matchesTest: number;
  matchesOdi: number;
  matchesT20: number;
}

/** "Wicket-keeper", "wk bat", "Batter", "All rounder", "bowler" … → WK / BAT / AR / BOWL. */
export function parseRole(value: unknown): CricketRole | null {
  const t = cellText(value).toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  if (t === "wk" || t.startsWith("wicketkeeper") || t === "keeper" || t.startsWith("wkbat")) return "WK";
  if (t === "ar" || t.startsWith("allrounder") || t === "all") return "AR";
  if (t === "bowl" || t === "bowler" || t === "bowlers" || t === "bwl") return "BOWL";
  if (t === "bat" || t === "batsman" || t === "batter" || t === "batsmen" || t === "batters") return "BAT";
  return null;
}

export function parsePlayersSheet(raws: RawRow[], ctx: { teams: TeamLookup }): { rows: PlayerRow[]; issues: SheetIssue[] } {
  const { rows: mapped, missing } = mapSheet("players", raws);
  const issues: SheetIssue[] = missing.map((h) => error(0, `Missing column "${h}"`, h));
  if (missing.length) return { rows: [], issues };
  if (ctx.teams.size === 0) issues.push(error(0, "Upload the Teams sheet first — players need a team"));

  const rows: PlayerRow[] = [];
  const seenCode = new Map<string, number>();
  const seenName = new Map<string, number>();
  const seenTeamName = new Map<string, { row: number; hasCode: boolean }>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const code = cellText(values.code);
    const name = cellText(values.name);
    const teamText = cellText(values.team);
    const teamCode = ctx.teams.resolve(teamText) ?? "";
    const role = parseRole(values.role);
    const basePrice = parseWhole(values.basePrice, 1);
    const overseas = parseYesNo(values.overseas);
    const test = parseWhole(values.test);
    const odi = parseWhole(values.odi);
    const t20 = parseWhole(values.t20);
    let ok = true;
    const fail = (message: string, column: string) => {
      ok = false;
      issues.push(error(row, message, column));
    };
    if (!name) fail("name is blank", "name");
    if (!teamText) fail("team is blank", "team");
    else if (ctx.teams.size > 0 && !teamCode) fail(ctx.teams.unknownMessage(teamText), "team");
    if (!role) fail(`Role "${cellText(values.role)}" isn't WK, BAT, AR or BOWL`, "role");
    if (basePrice === undefined) fail("base_price is blank", "base_price");
    else if (basePrice === null) fail("base_price must be a whole number of lakhs, at least 1", "base_price");
    if (overseas === null) fail(`overseas "${cellText(values.overseas)}" should be Y or N`, "overseas");
    if (test === null) fail("Test must be a whole number", "Test");
    if (odi === null) fail("ODI must be a whole number", "ODI");
    if (t20 === null) fail("T20 must be a whole number", "T20");
    if (code && seenCode.has(code)) fail(`player_id ${code} is already on row ${seenCode.get(code)}`, "player_id");
    if (code && !seenCode.has(code)) seenCode.set(code, row);
    // Points sheets find players by name (within the team when the sheet has a team column), so two
    // teammates with one name need player_ids, and namesakes in different teams need that team column.
    const nameKey = normalizeName(name);
    const teamNameKey = `${teamCode}:${nameKey}`;
    const twin = name && teamCode ? seenTeamName.get(teamNameKey) : undefined;
    if (twin && (!code || !twin.hasCode)) {
      fail(`Row ${twin.row} has a ${teamCode} player with the same name — give both a player_id so points can tell them apart`, "player_id");
    } else if (twin) {
      issues.push(warning(row, `Row ${twin.row} has a ${teamCode} player with the same name; points sheets will need their player_id`, "name"));
    } else if (name && seenName.has(nameKey)) {
      issues.push(
        warning(row, `Another player on row ${seenName.get(nameKey)} has the same name — check they're different people; the points sheet will need a team column for them`, "name"),
      );
    }
    if (name && !seenName.has(nameKey)) seenName.set(nameKey, row);
    if (name && teamCode && !twin) seenTeamName.set(teamNameKey, { row, hasCode: !!code });
    if (ok && role && typeof basePrice === "number") {
      rows.push({
        row,
        code,
        name,
        teamCode,
        role,
        basePrice,
        overseas: overseas ?? false,
        matchesTest: test ?? 0,
        matchesOdi: odi ?? 0,
        matchesT20: t20 ?? 0,
      });
    }
  });
  if (mapped.length === 0) issues.push(error(0, "The sheet has no rows"));
  return { rows, issues };
}

/**
 * Fill in blank player_ids. A row whose name (and team) matches a player already uploaded keeps
 * that player's id — so re-uploading by name never duplicates anyone — else it gets a slug of the
 * name ("virat-kohli"), with "-<team>" added when the plain slug is taken.
 */
export function assignPlayerCodes(rows: PlayerRow[], existing: Array<{ code: string; name: string; teamCode: string }>): PlayerRow[] {
  const explicit = new Set(rows.filter((r) => r.code).map((r) => r.code));
  const taken = new Set(explicit);
  const existingByTeamName = new Map(existing.map((p) => [`${p.teamCode}:${normalizeName(p.name)}`, p.code]));
  const existingByName = new Map<string, string[]>();
  for (const p of existing) existingByName.set(normalizeName(p.name), [...(existingByName.get(normalizeName(p.name)) ?? []), p.code]);
  const claim = (r: PlayerRow, code: string | undefined): PlayerRow => {
    if (r.code || !code || taken.has(code)) return r;
    taken.add(code);
    return { ...r, code };
  };
  // Pass 1: the same name in the same team is that player. Pass 2: a name that exists exactly once
  // elsewhere is that player moving team. (Same-team matches go first so a namesake on another
  // team can't take them.)
  const sameTeam = rows.map((r) => claim(r, existingByTeamName.get(`${r.teamCode}:${normalizeName(r.name)}`)));
  const out = sameTeam.map((r) => {
    const anywhere = existingByName.get(normalizeName(r.name));
    return claim(r, anywhere?.length === 1 ? anywhere[0] : undefined);
  });
  // Pass 3: new players get a fresh slug.
  return out.map((r) => {
    if (r.code) return r;
    const base = slugifyName(r.name) || "player";
    let code = base;
    if (taken.has(code)) code = `${base}-${r.teamCode.toLowerCase()}`;
    for (let n = 2; taken.has(code); n++) code = `${base}-${r.teamCode.toLowerCase()}-${n}`;
    taken.add(code);
    return { ...r, code };
  });
}

export interface ExistingPlayer {
  id: number;
  code: string;
  name: string;
  teamId: number;
  role: CricketRole;
  basePrice: number;
  overseas: boolean;
  matchesTest: number;
  matchesOdi: number;
  matchesT20: number;
}

export interface PlayersPlan {
  inserts: Array<PlayerRow & { teamId: number }>;
  updates: Array<{ id: number; row: PlayerRow & { teamId: number } }>;
  deletes: number[];
  unchanged: number;
  issues: SheetIssue[];
}

/**
 * The sheet replaces the whole player list. A player missing from the file is deleted, unless they
 * have points or are in someone's squad.
 */
export function planPlayers(
  existing: ExistingPlayer[],
  incoming: PlayerRow[],
  ctx: {
    teamIdByCode: Map<string, number>;
    playersWithPoints: Set<number>;
    ownedPlayerIds: Set<number>;
    auctionStarted: boolean;
  },
): PlayersPlan {
  const plan: PlayersPlan = { inserts: [], updates: [], deletes: [], unchanged: 0, issues: [] };
  const byCode = new Map(existing.map((p) => [p.code, p]));
  const incomingCodes = new Set(incoming.map((p) => p.code));

  for (const row of incoming) {
    const teamId = ctx.teamIdByCode.get(row.teamCode);
    if (teamId === undefined) continue; // reported by the parser
    const next = { ...row, teamId };
    const current = byCode.get(row.code);
    if (!current) {
      plan.inserts.push(next);
      continue;
    }
    const same =
      current.name === row.name &&
      current.teamId === teamId &&
      current.role === row.role &&
      current.basePrice === row.basePrice &&
      current.overseas === row.overseas &&
      current.matchesTest === row.matchesTest &&
      current.matchesOdi === row.matchesOdi &&
      current.matchesT20 === row.matchesT20;
    if (same) {
      plan.unchanged++;
      continue;
    }
    plan.updates.push({ id: current.id, row: next });
    const owned = ctx.ownedPlayerIds.has(current.id);
    if (owned && current.teamId !== teamId) {
      plan.issues.push({
        ...error(row.row, `${row.name} is in a squad; moving them to ${row.teamCode} changes who gets the franchise boost`, "team"),
        overridable: true,
      });
    }
    if (owned && current.role !== row.role) {
      plan.issues.push(warning(row.row, `${row.name} is in a squad; their role changes from ${current.role} to ${row.role}`, "role"));
    }
    if (ctx.auctionStarted && !owned && current.basePrice !== row.basePrice) {
      plan.issues.push(warning(row.row, `${row.name}'s base price changes after an auction started`, "base_price"));
    }
  }
  for (const player of existing) {
    if (incomingCodes.has(player.code)) continue;
    if (ctx.ownedPlayerIds.has(player.id)) {
      plan.issues.push(error(0, `${player.name} (${player.code}) is missing from the file but is in a squad`));
    } else if (ctx.playersWithPoints.has(player.id)) {
      plan.issues.push(error(0, `${player.name} (${player.code}) is missing from the file but has points; clear those fixtures' points first`));
    } else {
      plan.deletes.push(player.id);
    }
  }
  return plan;
}
