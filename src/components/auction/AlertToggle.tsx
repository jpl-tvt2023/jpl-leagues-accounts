"use client";

/** The room header's alerts switch (sound and tab-title alerts for your turn and being outbid). */
export function AlertToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      title={muted ? "Alerts are off — turn on sound and tab alerts for your turn and when you're outbid" : "Alerts are on for your turn and when you're outbid — click to mute"}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
        muted ? "border-white/15 text-gray-400 hover:bg-white/10" : "border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20"
      }`}
    >
      {muted ? "🔕 Alerts off" : "🔔 Alerts on"}
    </button>
  );
}
