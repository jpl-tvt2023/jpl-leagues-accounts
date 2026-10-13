"use client";

/**
 * Click-to-sort table headers. Shared by any table that wants them (first: the superadmin's cricket
 * tournament tables). Clicking a header sorts by it ascending; clicking again flips the direction.
 * Numbers sort as numbers, text naturally ("Match 2" before "Match 10", case ignored), and blanks
 * sort last either way.
 */

export type SortDir = "asc" | "desc";
export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

const isBlank = (v: unknown) => v === null || v === undefined || v === "";

/** Compare two cell values for sorting. Blanks always go last. */
export function compareCells(a: unknown, b: unknown, dir: SortDir): number {
  if (isBlank(a) || isBlank(b)) return isBlank(a) === isBlank(b) ? 0 : isBlank(a) ? 1 : -1;
  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return sign * (a - b);
  if (typeof a === "boolean" && typeof b === "boolean") return sign * (Number(a) - Number(b));
  return sign * String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** A sorted copy of `rows`; ties keep their original order. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => unknown, dir: SortDir): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => compareCells(value(x.row), value(y.row), dir) || x.i - y.i)
    .map((x) => x.row);
}

/** The next sort state after clicking `key`. */
export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
}

export function SortableTh<K extends string>({
  sortKey,
  label,
  sort,
  onSort,
  className = "px-3 py-2",
}: {
  sortKey: K;
  label: string;
  sort: SortState<K>;
  onSort: (key: K) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-white">
        {label}
        <span aria-hidden="true" className={`text-[9px] ${active ? "text-green-300" : "text-gray-600"}`}>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
