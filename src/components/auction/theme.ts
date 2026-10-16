/**
 * Class strings for the shared auction-room components, one set per sport: the FPL room's
 * yellow/orange on purple, and cricket's lime/green. Written out in full so Tailwind finds them.
 */

export interface RoomTheme {
  /** Accent text: "(YOU)", the lot number, links. */
  accentText: string;
  /** The primary call to action (the first bid button, Nominate). */
  primaryButton: string;
  /** The current bid's amount on the lot card. */
  amountText: string;
  /** The lot card's background. */
  lotCard: string;
  /** The current nominator's row in the order table, and its name. */
  currentRow: string;
  currentText: string;
  /** Your own row in the order table, and its name. */
  meRow: string;
  meText: string;
  /** An active tab's underline and text. */
  tabActive: string;
  /** The post-sale pause card, and its SOLD stamp. */
  soldCard: string;
  soldStamp: string;
}

export const FPL_ROOM_THEME: RoomTheme = {
  accentText: "text-yellow-400",
  primaryButton: "bg-gradient-to-r from-yellow-400 to-orange-500 text-slate-900 hover:from-yellow-300 hover:to-orange-400",
  amountText: "text-[#00ff85]",
  lotCard: "bg-gradient-to-br from-purple-900/40 to-slate-900/40",
  currentRow: "bg-yellow-400/10",
  currentText: "text-yellow-300",
  meRow: "bg-purple-500/10",
  meText: "text-purple-300",
  tabActive: "border-yellow-400 text-yellow-400",
  soldCard: "border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 to-slate-900/40",
  soldStamp: "border-green-400 text-green-300",
};

export const CRICKET_ROOM_THEME: RoomTheme = {
  accentText: "text-lime-300",
  primaryButton: "bg-gradient-to-r from-lime-300 to-green-400 text-slate-900 hover:from-lime-200 hover:to-green-300",
  amountText: "text-lime-300",
  lotCard: "bg-gradient-to-br from-green-900/40 to-slate-900/40",
  currentRow: "bg-lime-400/10",
  currentText: "text-lime-300",
  meRow: "bg-emerald-500/10",
  meText: "text-emerald-300",
  tabActive: "border-lime-300 text-lime-300",
  soldCard: "border-lime-400/30 bg-gradient-to-br from-lime-400/10 to-slate-900/40",
  soldStamp: "border-lime-300 text-lime-300",
};
