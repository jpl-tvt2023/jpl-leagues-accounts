import type { ReactNode } from "react";
import type { RoomTheme } from "./theme";

const STATUS_PILL: Record<string, string> = {
  active: "bg-green-500/20 text-green-300 border-green-500/40",
  paused: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  pending: "bg-blue-500/20 text-blue-300 border-blue-500/40",
};

/**
 * The auction room's header bar: status, session title, the live-connection dot, whose turn it is
 * and your purse. `right` takes extra controls (the alerts toggle).
 */
export function RoomHeader({
  theme,
  status,
  title,
  titleAs: Title = "span",
  subtitle,
  live,
  nominator,
  purse,
  right,
}: {
  theme: RoomTheme;
  status: string;
  title: ReactNode;
  /** "h1" when the header is the page's heading (the cricket room). */
  titleAs?: "span" | "h1";
  subtitle?: ReactNode;
  /** Connection state while a session runs; null hides the dot. */
  live: boolean | null;
  nominator: { name: string; isMe: boolean } | null;
  purse?: { label: string; value: string } | null;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${STATUS_PILL[status] ?? "bg-white/10 text-gray-300 border-white/20"}`}>{status}</span>
        <Title className="text-white font-semibold">{title}</Title>
        {subtitle && <span className="text-gray-400 text-sm">{subtitle}</span>}
        {live !== null &&
          (live ? (
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"></span>LIVE
            </span>
          ) : (
            <span className="text-[10px] text-gray-500">Connecting...</span>
          ))}
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <div className="text-xs text-gray-400 uppercase">Nominator</div>
          <div className={`font-semibold ${nominator?.isMe ? theme.accentText : "text-white"}`}>
            {nominator?.name ?? "—"}
            {nominator?.isMe && " (YOU)"}
          </div>
        </div>
        {purse && (
          <div>
            <div className="text-xs text-gray-400 uppercase">{purse.label}</div>
            <div className="font-mono font-bold text-green-300">{purse.value}</div>
          </div>
        )}
        {right}
      </div>
    </div>
  );
}
