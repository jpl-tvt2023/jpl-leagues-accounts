/** Players sheet. Pure. */

import type { CricketRole } from "@/lib/db/schema-cricket";
import { cellText, mapSheet, normalizeTeamCode } from "./columns";
import { error, rowNumber, warning, type RawRow, type SheetIssue } from "./types";
import { parseWhole, parseYesNo } from "./values";

export interface PlayerRow {
  row: number;
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

export function parsePlayersSheet(raws: RawRow[], ctx: { teamCodes: Set<string> }): { rows: PlayerRow[]; issues: SheetIssue[] } {
  const { rows: mapped, missing } = mapSheet("players", raws);
  const issues: SheetIssue[] = missing.map((h) => error(0, `Missing column "${h}"`, h));
  if (missing.length) return { rows: [], issues };
  if (ctx.teamCodes.size === 0) issues.push(error(0, "Upload the Teams sheet first — players need a team"));

  const rows: PlayerRow[] = [];
  const seenCode = new Map<string, number>();
  const seenName = new Map<string, number>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const code = cellText(values.code);
    const name = cellText(values.name);
    const teamCode = normalizeTeamCode(values.team);
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
    if (!code) fail("player_id is blank", "player_id");
    if (!name) fail("name is blank", "name");
    if (!teamCode) fail("team is blank", "team");
    else if (ctx.teamCodes.size > 0 && !ctx.teamCodes.has(teamCode)) fail(`Team ${teamCode} isn't in the Teams sheet`, "team");
    if (!role) fail(`Role "${cellText(values.role)}" isn't WK, BAT, AR or BOWL`, "role");
    if (basePrice === undefined) fail("base_price is blank", "base_price");
    else if (basePrice === null) fail("base_price must be a whole number of lakhs, at least 1", "base_price");
    if (overseas === null) fail(`overseas "${cellText(values.overseas)}" should be Y or N`, "overseas");
    if (test === null) fail("Test must be a whole number", "Test");
    if (odi === null) fail("ODI must be a whole number", "ODI");
    if (t20 === null) fail("T20 must be a whole number", "T20");
    if (code && seenCode.has(code)) fail(`player_id ${code} is already on row ${seenCode.get(code)}`, "player_id");
    if (code && !seenCode.has(code)) seenCode.set(code, row);
    const nameKey = name.toLowerCase();
    if (name && seenName.has(nameKey)) {
      issues.push(warning(row, `Another player on row ${seenName.get(nameKey)} has the same name — check they're different people`, "name"));
    } else if (name) seenName.set(nameKey, row);
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
