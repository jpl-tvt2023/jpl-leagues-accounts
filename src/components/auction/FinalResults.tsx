import type { ReactNode } from "react";
import type { RoomTheme } from "./theme";

export interface ResultItem {
  id: string;
  name: string;
  /** Role or position, team, overseas. */
  chip?: ReactNode;
  price: number;
}

export interface ResultTeam {
  id: string;
  name: string;
  isMe?: boolean;
  purseLeft: number;
  /** "16 players", "Franchise". */
  countLabel: string;
  /** A line under the name, e.g. the franchise owned. */
  note?: string;
  items: ResultItem[];
}

/**
 * The finished auction: totals across the league, then a card per team — what it bought and for
 * how much, most expensive first, and the purse it has left. Your team comes first.
 */
export function FinalResults({ theme, title = "Final results", teams, formatMoney }: { theme: RoomTheme; title?: string; teams: ResultTeam[]; formatMoney: (amount: number) => string }) {
  const ordered = [...teams].sort((a, b) => Number(!!b.isMe) - Number(!!a.isMe));
  const all = teams.flatMap((t) => t.items.map((i) => ({ ...i, team: t.name })));
  const spent = all.reduce((s, i) => s + i.price, 0);
  const top = all.reduce<(typeof all)[number] | null>((best, i) => (!best || i.price > best.price ? i : best), null);
  return (
    <section aria-label={title} className="mb-4">
      <div className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
          <span>
            {all.length} bought · <span className="font-mono text-white">{formatMoney(spent)}</span> spent
          </span>
          {top && (
            <span>
              Top buy: <span className="text-white">{top.name}</span> to {top.team} for <span className={`font-mono ${theme.amountText}`}>{formatMoney(top.price)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((team) => {
          const items = [...team.items].sort((a, b) => b.price - a.price);
          const teamSpent = items.reduce((s, i) => s + i.price, 0);
          return (
            <div key={team.id} className={`rounded-2xl border p-4 backdrop-blur ${team.isMe ? `border-white/25 ${theme.meRow}` : "border-white/10 bg-white/5"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className={`font-semibold ${team.isMe ? theme.meText : "text-white"}`}>
                  {team.name}
                  {team.isMe && <span className="ml-1 text-[10px]">(you)</span>}
                </h3>
                <span className="text-[11px] text-gray-400">{team.countLabel}</span>
              </div>
              {team.note && <div className="text-[11px] text-gray-400">{team.note}</div>}
              <ul className="mt-2 space-y-1">
                {items.length === 0 ? (
                  <li className="text-[11px] text-gray-500">Nothing bought</li>
                ) : (
                  items.map((item) => (
                    <li key={item.id} className="flex items-center gap-1.5 rounded bg-white/5 px-2 py-1 text-[11px]">
                      <span className="flex-1 truncate text-white">{item.name}</span>
                      {item.chip}
                      <span className="font-mono text-green-400">{formatMoney(item.price)}</span>
                    </li>
                  ))
                )}
              </ul>
              <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-[11px]">
                <span className="text-gray-400">
                  Spent <span className="font-mono text-white">{formatMoney(teamSpent)}</span>
                </span>
                <span className="text-gray-400">
                  <span className="font-mono text-green-300">{formatMoney(team.purseLeft)}</span> left
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
