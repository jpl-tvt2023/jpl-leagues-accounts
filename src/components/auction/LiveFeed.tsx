"use client";

import { useState, type ReactNode } from "react";

export interface FeedEntry {
  id: string;
  /** When it happened (ISO time). */
  at: string;
  kind: "sold" | "unsold" | "bid" | "info" | "penalty" | "live";
  text: ReactNode;
  /** A sold or unsold line's history (nomination and bids), shown when the line is opened. */
  children?: FeedEntry[];
}

const KIND_CLASS: Record<FeedEntry["kind"], string> = {
  sold: "text-green-300 font-semibold bg-green-500/5",
  unsold: "text-yellow-300 bg-yellow-500/5",
  bid: "text-white",
  live: "text-white",
  info: "text-gray-400",
  penalty: "text-red-300 bg-red-500/5",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Line({ entry, nested, open, onToggle }: { entry: FeedEntry; nested?: boolean; open?: boolean; onToggle?: () => void }) {
  return (
    <div
      onClick={onToggle}
      className={`flex items-start gap-1.5 px-1.5 py-1 rounded ${KIND_CLASS[entry.kind]} ${onToggle ? "cursor-pointer hover:bg-white/5" : ""} ${nested ? "ml-4 border-l border-white/10 pl-2" : ""}`}
    >
      <span className="text-[9px] text-gray-500 font-mono whitespace-nowrap mt-0.5">{time(entry.at)}</span>
      <span className="flex-1">{entry.text}</span>
      {onToggle && <span className="text-[9px] text-gray-500 ml-1">{open ? "▾" : "▸"}</span>}
    </div>
  );
}

/** The room's feed: newest first; a sold line opens to show how that lot went. */
export function LiveFeed({ title, entries, emptyText = "No activity yet", className = "", maxHeightClass = "max-h-52" }: { title: string; entries: FeedEntry[]; emptyText?: string; className?: string; maxHeightClass?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur ${className}`}>
      <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">{title}</h3>
      <div className={`space-y-0.5 ${maxHeightClass} overflow-y-auto text-[11px]`}>
        {entries.length === 0 ? (
          <div className="text-gray-500 py-2 text-center text-[10px]">{emptyText}</div>
        ) : (
          entries.map((entry) => {
            const hasChildren = !!entry.children?.length;
            const open = openId === entry.id;
            return (
              <div key={entry.id}>
                <Line entry={entry} open={open} onToggle={hasChildren ? () => setOpenId(open ? null : entry.id) : undefined} />
                {open && entry.children!.map((child) => <Line key={child.id} entry={child} nested />)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
