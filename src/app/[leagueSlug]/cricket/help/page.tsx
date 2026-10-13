"use client";

import { useState } from "react";
import { CricketShell } from "../_components/CricketShell";

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "How do I build my squad?",
    a: "In the auction. When it's your turn, nominate a player (or, in the franchise auction, a franchise); everyone can then bid. The highest bid when the timer runs out wins. Open the Auction page when the auction is live.",
  },
  {
    q: "What happens if I miss my turn?",
    a: "Add players to your wishlist before the auction: if your nomination timer runs out, your first affordable wishlist player is nominated for you. With nothing suitable on it you get a penalty slot, which you can clear straight away for the redeem price shown in the rules.",
  },
  {
    q: "Why was my bid refused?",
    a: "Either it would leave too little purse to complete your minimum squad, your squad is full, or the player would break a squad rule (role limits, players from one team, overseas players).",
  },
  {
    q: "When do points update?",
    a: "After each match, once its fantasy points are uploaded. The table and every squad update straight away.",
  },
  {
    q: "What does the franchise do?",
    a: "Your team takes the franchise's name, and players from that franchise score extra points (the boost %). It's paid from the same purse as players.",
  },
  {
    q: "Can I change my squad after the auction?",
    a: "No. Once the player auction ends, squads are final for the whole tournament.",
  },
];

export default function CricketHelpPage() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <CricketShell currentPage="help" title="Help">
      <div className="space-y-2">
        {FAQS.map((f, i) => (
          <div key={f.q} className="overflow-hidden rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between px-5 py-4 text-left font-medium text-white hover:bg-white/5"
            >
              <span>{f.q}</span>
              <span className="ml-4 shrink-0 text-gray-400">{open === i ? "▲" : "▼"}</span>
            </button>
            {open === i && <div className="border-t border-white/10 px-5 pb-4 pt-3 text-sm leading-relaxed text-gray-300">{f.a}</div>}
          </div>
        ))}
      </div>
    </CricketShell>
  );
}
