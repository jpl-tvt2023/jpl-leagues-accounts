/** Reading cell values. Pure. */

import { cellText } from "./columns";

/** A number from a cell ("1,200", " 12.5 ", 7); null when blank or not a number. */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(/,/g, "");
  if (!text) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  return Number(text);
}

export function isBlank(value: unknown): boolean {
  return cellText(value) === "";
}

/** Whole number ≥ min; `undefined` when blank (caller picks the default), null when invalid. */
export function parseWhole(value: unknown, min = 0): number | null | undefined {
  if (isBlank(value)) return undefined;
  const n = parseNumber(value);
  if (n === null || !Number.isInteger(n) || n < min) return null;
  return n;
}

/** Y/N style flag; `undefined` when blank, null when unreadable. */
export function parseYesNo(value: unknown): boolean | null | undefined {
  if (typeof value === "boolean") return value;
  const text = cellText(value).toLowerCase();
  if (!text) return undefined;
  if (["y", "yes", "true", "1", "overseas"].includes(text)) return true;
  if (["n", "no", "false", "0"].includes(text)) return false;
  return null;
}
