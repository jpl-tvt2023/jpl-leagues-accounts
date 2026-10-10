"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { teamHref, useMyLeagues } from "@/lib/my-leagues-client";

const ROW =
  "flex min-h-11 w-full items-center gap-3 rounded-full px-3 text-left text-sm text-gray-200 transition hover:bg-white/5 active:bg-white/15";
const MAX_ROWS = 8;

/**
 * Jump between your leagues — the point of one identity for many leagues. Switching is just a
 * link: the league is part of the URL, so nothing about the session changes. Lists the leagues you
 * play in (your team's dashboard, or setup until it's done), then the ones you run.
 */
export function LeagueSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const leagues = useMyLeagues();
  const pathname = usePathname() ?? "";
  if (!leagues) return null;

  const rows = [
    ...leagues.teams.map((t) => ({ key: `t-${t.leagueId}`, href: teamHref(t), label: t.leagueName, sub: t.teamName, slug: t.slug })),
    ...leagues.adminOf.map((a) => ({ key: `a-${a.leagueId}`, href: `/admin/${a.leagueId}`, label: a.leagueName, sub: "Admin", slug: a.slug })),
  ];
  if (rows.length === 0 && !leagues.allLeagues) return null;

  return (
    <nav aria-label="Your leagues" className="space-y-0.5">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Your leagues</p>
      {rows.slice(0, MAX_ROWS).map((r) => {
        const current = pathname === `/${r.slug}` || pathname.startsWith(`/${r.slug}/`);
        return (
          <Link key={r.key} href={r.href} onClick={onNavigate} aria-current={current ? "page" : undefined} className={`${ROW} ${current ? "bg-white/10" : ""}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${current ? "bg-yellow-400" : "bg-white/20"}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-white">{r.label}</span>
              <span className="block truncate text-xs text-gray-400">{r.sub}</span>
            </span>
          </Link>
        );
      })}
      <Link href={leagues.allLeagues ? "/admin" : "/account"} onClick={onNavigate} className={`${ROW} text-gray-300`}>
        <span className="w-2" aria-hidden="true" />
        {leagues.allLeagues ? "All leagues" : rows.length > MAX_ROWS ? `All ${rows.length} leagues` : "All your leagues"}
      </Link>
    </nav>
  );
}
