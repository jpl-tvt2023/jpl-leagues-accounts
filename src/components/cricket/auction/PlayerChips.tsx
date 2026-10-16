import { ROLE_STYLE } from "@/components/cricket/view-helpers";

/** A player's role, real team and overseas mark as small chips (lot card, lists, results). */
export function PlayerChips({ role, teamCode, overseas }: { role?: string | null; teamCode?: string | null; overseas?: boolean }) {
  return (
    <>
      {role && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ROLE_STYLE[role] ?? "bg-white/10 text-gray-300"}`}>{role}</span>}
      {teamCode && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-gray-300">{teamCode}</span>}
      {overseas && (
        <span title="Overseas player" className="text-[11px] text-sky-300">
          ✈
        </span>
      )}
    </>
  );
}
