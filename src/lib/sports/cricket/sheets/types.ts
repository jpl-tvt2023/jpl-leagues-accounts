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
