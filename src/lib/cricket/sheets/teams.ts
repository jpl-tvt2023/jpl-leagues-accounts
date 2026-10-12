/** Teams sheet: real teams (IPL franchises, or countries). Pure. */

import { cellText, mapSheet, normalizeTeamCode } from "./columns";
import { error, rowNumber, warning, type RawRow, type SheetIssue } from "./types";
import { parseWhole } from "./values";

export interface TeamRow {
  row: number;
  code: string;
  name: string;
  basePrice: number;
}

export function parseTeamsSheet(raws: RawRow[]): { rows: TeamRow[]; issues: SheetIssue[] } {
  const { rows: mapped, missing } = mapSheet("teams", raws);
  const issues: SheetIssue[] = missing.map((h) => error(0, `Missing column "${h}"`, h));
  if (missing.length) return { rows: [], issues };

  const rows: TeamRow[] = [];
  const seen = new Map<string, number>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const code = normalizeTeamCode(values.code);
    const name = cellText(values.name);
    const price = parseWhole(values.basePrice);
    let ok = true;
    const fail = (message: string, column: string) => {
      ok = false;
      issues.push(error(row, message, column));
    };
    if (!code) fail("team_code is blank", "team_code");
    if (!name) fail("name is blank", "name");
    if (price === null) fail("base_price must be a whole number of lakhs", "base_price");
    if (code && seen.has(code)) fail(`Team ${code} is already on row ${seen.get(code)}`, "team_code");
    if (code && !seen.has(code)) seen.set(code, row);
    if (ok) rows.push({ row, code, name, basePrice: price ?? 0 });
  });
  if (mapped.length === 0) issues.push(error(0, "The sheet has no rows"));
  return { rows, issues };
}

export interface ExistingTeam {
  id: number;
  code: string;
  name: string;
  basePrice: number;
}

export interface TeamsPlan {
  inserts: TeamRow[];
  updates: Array<{ id: number; row: TeamRow }>;
  deletes: number[];
  unchanged: number;
  issues: SheetIssue[];
}

/**
 * The sheet replaces the whole team list. A team missing from the file is deleted, unless players,
 * fixtures or a franchise owner still use it.
 */
export function planTeams(
  existing: ExistingTeam[],
  incoming: TeamRow[],
  ctx: { referencedTeamIds: Set<number>; franchiseAuctionStarted: boolean },
): TeamsPlan {
  const plan: TeamsPlan = { inserts: [], updates: [], deletes: [], unchanged: 0, issues: [] };
  const byCode = new Map(existing.map((t) => [t.code, t]));
  const incomingCodes = new Set(incoming.map((t) => t.code));

  for (const row of incoming) {
    const current = byCode.get(row.code);
    if (!current) {
      plan.inserts.push(row);
      continue;
    }
    if (current.name === row.name && current.basePrice === row.basePrice) {
      plan.unchanged++;
      continue;
    }
    plan.updates.push({ id: current.id, row });
    if (current.basePrice !== row.basePrice && ctx.franchiseAuctionStarted) {
      plan.issues.push(
        warning(row.row, `${row.code}'s base price changes after a franchise auction started; only franchises not yet sold open at the new price`, "base_price"),
      );
    }
  }
  for (const team of existing) {
    if (incomingCodes.has(team.code)) continue;
    if (ctx.referencedTeamIds.has(team.id)) {
      plan.issues.push(error(0, `Team ${team.code} is missing from the file, but players, fixtures or a franchise owner still use it`));
    } else {
      plan.deletes.push(team.id);
    }
  }
  return plan;
}
