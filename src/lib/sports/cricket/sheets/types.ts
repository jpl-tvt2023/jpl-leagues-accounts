/** Shared shapes for the tournament upload sheets. Pure: no DB, no react/next. */

export type SheetKind = "teams" | "players" | "fixtures" | "points";

export const SHEET_KINDS: readonly SheetKind[] = ["teams", "players", "fixtures", "points"];

/** A row as SheetJS's sheet_to_json produced it, plus the sheet row number the client copied in. */
export type RawRow = Record<string, unknown> & { __row?: number };

export interface SheetIssue {
  /** Spreadsheet row number (the header is row 1), or 0 for a whole-file problem. */
  row: number;
  column?: string;
  message: string;
  level: "error" | "warning";
  /**
   * An error the superadmin may push through with "override" — a change that alters results after
   * a league's auction has started. Committed overrides are recorded in the upload's summary.
   */
  overridable?: boolean;
}

/**
 * One saved row an upload would change or remove, shown to the superadmin before they confirm
 * (e.g. "Rohit Sharma (MI)" · "IPL 2026 fixture 3: 40 → 44", or "PBKS" · "removed").
 */
export interface SheetChange {
  /** Spreadsheet row of the new values, or 0 for a removal. */
  row: number;
  item: string;
  change: string;
}

export const REMOVED = "removed";

/** "name: A → B · base price: 20 → 25" — only the fields that differ. */
export function fieldChanges(fields: Array<[label: string, from: unknown, to: unknown]>): string {
  const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "(blank)" : String(v));
  return fields
    .filter(([, from, to]) => shown(from) !== shown(to))
    .map(([label, from, to]) => `${label}: ${shown(from)} → ${shown(to)}`)
    .join(" · ");
}

export function error(row: number, message: string, column?: string): SheetIssue {
  return { row, column, message, level: "error" };
}

export function warning(row: number, message: string, column?: string): SheetIssue {
  return { row, column, message, level: "warning" };
}

/** The sheet row number for the i-th parsed row: what the client sent, else header + index. */
export function rowNumber(raw: RawRow, index: number): number {
  return typeof raw.__row === "number" && Number.isFinite(raw.__row) ? raw.__row : index + 2;
}

/** Blocking errors: every error, minus overridable ones when the superadmin overrides. */
export function blockingIssues(issues: SheetIssue[], override: boolean): SheetIssue[] {
  return issues.filter((i) => i.level === "error" && !(override && i.overridable));
}
