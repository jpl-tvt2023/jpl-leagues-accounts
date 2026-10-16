"use client";

/**
 * Reading and writing the upload sheets in the browser (SheetJS). The file never leaves the
 * superadmin's machine as a file: only its rows are sent, as JSON, and validated on the server.
 * Parsing stays client-side on purpose — the xlsx package version in use has published advisories,
 * so it is never run on the server against uploaded files.
 */

import * as XLSX from "xlsx";
import { templateNotes, templateRows, SHEET_TITLES, type PlayoffTemplate, type PointsTemplate } from "./templates";
import type { RawRow, SheetKind } from "./types";

/** First sheet of an .xlsx / .xls / .csv file as rows keyed by header, each tagged with its row number. */
export async function readSheetFile(file: File): Promise<RawRow[]> {
  const data = await file.arrayBuffer();
  // raw: true keeps CSV cells as typed — "2026-04-12 19:30" stays text instead of being guessed
  // into a local-time date. Date-formatted .xlsx cells arrive as Excel serial numbers, which the
  // server reads as IST.
  const workbook = XLSX.read(data, { type: "array", raw: true });
  const first = workbook.SheetNames[0];
  if (!first) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first], { raw: true, defval: "" });
  return rows.map((r) => {
    // SheetJS records each row's 0-based sheet index on a non-enumerable __rowNum__.
    const rowNum = (r as { __rowNum__?: number }).__rowNum__;
    return { ...r, __row: typeof rowNum === "number" ? rowNum + 1 : undefined };
  });
}

/**
 * The template for a sheet; with `playoffs`, the Fixtures template for the playoffs (ids follow on);
 * with `points`, the Points grid for a tournament (its players, its fixture ids).
 */
export function downloadTemplate(kind: SheetKind, playoffs?: PlayoffTemplate, points?: PointsTemplate): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateRows(kind, playoffs, points)), SHEET_TITLES[kind]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(templateNotes(kind, playoffs)), "Notes");
  XLSX.writeFile(workbook, `cricket-${playoffs ? "playoff-" : ""}${kind}-template.xlsx`);
}
