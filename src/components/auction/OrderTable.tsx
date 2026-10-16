"use client";

import { Fragment, type ReactNode } from "react";
import type { RoomTheme } from "./theme";

export interface OrderCategory {
  count: number;
  /** Below this the count shows red. */
  min: number;
  /** Above this (when set) it shows red too. */
  max?: number | null;
}

export interface OrderRow {
  id: string;
  name: string;
  isCurrent: boolean;
  isMe: boolean;
  /** Already formatted. */
  purse: string;
  categories: OrderCategory[];
  total: { count: number; cap: number };
  /** Beside the name: a franchise or club chip, penalty slots, an owed make-up turn. */
  badges?: ReactNode;
  /** Shown when the row is expanded: the team's squad. */
  detail?: ReactNode;
}

const categoryClass = (c: OrderCategory) => (c.count < c.min || (c.max != null && c.count > c.max) ? "text-red-400" : "text-green-400");

/**
 * The nomination order, which doubles as the purse and squad board: ► marks whose turn it is,
 * category counts (positions or roles) are green once their minimum is met, and a row expands to
 * show that team's squad. On phones the purse and counts fold under the team name.
 */
export function OrderTable({
  theme,
  title = "Nomination Order",
  categoryLabels,
  rows,
  expandedId,
  onToggle,
  maxHeightClass = "max-h-80",
}: {
  theme: RoomTheme;
  title?: string;
  categoryLabels: string[];
  rows: OrderRow[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  maxHeightClass?: string;
}) {
  const columns = 4 + categoryLabels.length;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">{title}</h3>
      <div className={`overflow-x-auto ${maxHeightClass} overflow-y-auto`}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900/95 z-10">
            <tr className="text-gray-400 uppercase tracking-wider border-b border-white/10">
              <th className="text-left py-2 px-2 w-8">#</th>
              <th className="text-left py-2 px-2">Team</th>
              <th className="hidden sm:table-cell text-right py-2 px-2">Purse</th>
              {categoryLabels.map((label) => (
                <th key={label} className="hidden sm:table-cell text-center py-2 px-1">
                  {label}
                </th>
              ))}
              <th className="text-center py-2 px-1">Tot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const expanded = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => onToggle(row.id)}
                    aria-expanded={row.detail ? expanded : undefined}
                    className={`cursor-pointer border-b border-white/5 transition hover:bg-white/5 ${row.isCurrent ? theme.currentRow : ""} ${row.isMe ? theme.meRow : ""}`}
                  >
                    <td className="py-1.5 px-2 text-gray-500">{row.isCurrent ? <span className={`${theme.accentText} font-bold`}>►</span> : <span>{idx + 1}</span>}</td>
                    <td className={`py-1.5 px-2 font-semibold ${row.isCurrent ? theme.currentText : row.isMe ? theme.meText : "text-white"}`}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span>{row.name}</span>
                        {row.isMe && <span className={`text-[10px] ${theme.meText}`}>(you)</span>}
                        {row.badges}
                      </span>
                      {/* Phones: purse and category counts fold under the name. */}
                      <div className="sm:hidden mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] font-normal">
                        <span className="text-green-300">{row.purse}</span>
                        {row.categories.map((c, i) => (
                          <span key={categoryLabels[i]} className={categoryClass(c)}>
                            {categoryLabels[i]} {c.count}
                            <span className="text-gray-500">/{c.min}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell py-1.5 px-2 text-right font-mono text-green-300">{row.purse}</td>
                    {row.categories.map((c, i) => (
                      <td key={categoryLabels[i]} className={`hidden sm:table-cell py-1.5 px-1 text-center font-mono ${categoryClass(c)}`}>
                        {c.count}
                        <span className="text-gray-500">/{c.min}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-1 text-center text-white font-semibold" title="Players filled / squad cap">
                      {row.total.count}
                      <span className="text-gray-500">/{row.total.cap}</span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={columns} className="px-2 py-2 bg-white/[0.02]">
                        {row.detail ?? <div className="px-2 text-[10px] text-gray-500">Nothing bought yet</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
