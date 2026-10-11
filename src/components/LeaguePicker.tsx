"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NavIcon } from "./icons/NavIcon";
import { teamHref, useMyLeagues, type MyLeagues } from "@/lib/my-leagues-client";
import { groupBySport } from "@/lib/sports";

const ROW =
  "flex min-h-11 w-full items-center gap-3 rounded-full px-3 text-left text-sm text-gray-200 transition hover:bg-white/5 active:bg-white/15";

interface PickerRow {
  key: string;
  href: string;
  label: string;
  sub: string;
  slug: string;
  sport: string;
}

/**
 * Every league the person is part of, one row each: the ones they play in (their team's dashboard,
 * or setup until it's done; "· Admin" when they run it too), the ones they only run (admin
 * dashboard), and FPL Classic leagues one of their FPL teams is entered in (standings).
 */
function pickerRows(leagues: MyLeagues): PickerRow[] {
  const adminIds = new Set(leagues.adminOf.map((a) => a.leagueId));
  const seen = new Set<string>();
  const rows: PickerRow[] = [];
  for (const t of leagues.teams) {
    seen.add(t.leagueId);
    rows.push({ key: `t-${t.leagueId}`, href: teamHref(t), label: t.leagueName, sub: adminIds.has(t.leagueId) ? `${t.teamName} · Admin` : t.teamName, slug: t.slug, sport: t.sport });
  }
  for (const a of leagues.adminOf) {
    if (seen.has(a.leagueId)) continue;
    seen.add(a.leagueId);
    rows.push({ key: `a-${a.leagueId}`, href: `/admin/${a.leagueId}`, label: a.leagueName, sub: "Admin", slug: a.slug, sport: a.sport });
  }
  for (const c of leagues.classic ?? []) {
    if (seen.has(c.leagueId)) continue;
    rows.push({ key: `c-${c.leagueId}`, href: `/${c.slug}/standings`, label: c.leagueName, sub: c.entryName, slug: c.slug, sport: c.sport });
  }
  return rows;
}

/** The list both pickers render: "All my leagues" (home), then the person's leagues by sport. */
function PickerList({ leagues, onNavigate }: { leagues: MyLeagues; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const rows = pickerRows(leagues);
  const groups = groupBySport(rows);
  const showSports = groups.length > 1;

  return (
    <div className="space-y-0.5">
      <Link href="/" onClick={onNavigate} aria-current={pathname === "/" ? "page" : undefined} className={`${ROW} ${pathname === "/" ? "bg-white/10" : ""}`}>
        <NavIcon name="leagues" className="h-5 w-5 shrink-0 text-gray-300" />
        <span className="font-semibold text-white">All my leagues</span>
      </Link>
      {rows.length === 0 && !leagues.allLeagues && (
        <p className="px-3 py-2 text-xs text-gray-400">You&apos;re not in a league yet. Open an invite link from a league&apos;s admin to join.</p>
      )}
      {groups.map((group) => (
        <div key={group.sport}>
          {showSports && (
            <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold text-gray-500">
              <span aria-hidden="true">{group.icon} </span>
              {group.label}
            </p>
          )}
          {group.items.map((r) => {
            const current = pathname === `/${r.slug}` || pathname.startsWith(`/${r.slug}/`);
            return (
              <Link
                key={r.key}
                href={r.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                className={`${ROW} ${current ? "bg-white/10" : ""}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${current ? "bg-yellow-400" : "bg-white/20"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-white">{r.label}</span>
                  <span className="block truncate text-xs text-gray-400">{r.sub}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {leagues.allLeagues && (
        <Link href="/admin" onClick={onNavigate} className={`${ROW} text-orange-300`}>
          <NavIcon name="admin" className="h-5 w-5 shrink-0" />
          All leagues (platform admin)
        </Link>
      )}
    </div>
  );
}

/**
 * "Your leagues" at the top of the phone drawer, its own section rather than tucked under the
 * account card. The drawer mounts only while open, so the list is fetched only then.
 */
export function LeaguePickerSection({ onNavigate }: { onNavigate?: () => void }) {
  const leagues = useMyLeagues();
  if (!leagues) return null;
  return (
    <nav aria-label="Your leagues" className="mx-3 mb-1 rounded-3xl bg-white/5 p-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Your leagues</p>
      <PickerList leagues={leagues} onNavigate={onNavigate} />
    </nav>
  );
}

/**
 * The desktop app bar's league name, as a switcher: click it to jump to another of your leagues
 * or back to your home. The list is fetched the first time it opens.
 */
export function LeagueMenuButton({
  label,
  badge,
}: {
  label: string;
  badge?: { label: string; bgClass: string; textClass: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const leagues = useMyLeagues(everOpened);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setEverOpened(true);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        aria-label={`${label} — switch league`}
        className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 transition hover:bg-white/10"
      >
        <span className="truncate text-xl font-bold text-white">{label}</span>
        {badge && (
          <span
            className={`shrink-0 text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badge.bgClass} ${badge.textClass}`}
            title={`Format: ${badge.label}`}
          >
            {badge.label}
          </span>
        )}
        <NavIcon name="chevron-down" className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute left-0 top-full z-[60] mt-2 w-[min(22rem,calc(100vw-1rem))] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-2xl"
        >
          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Your leagues</p>
          {leagues ? (
            <PickerList leagues={leagues} onNavigate={() => setOpen(false)} />
          ) : leagues === null ? (
            <p className="px-3 py-3 text-sm text-gray-400">Loading…</p>
          ) : (
            <p className="px-3 py-3 text-sm text-gray-400">Couldn&apos;t load your leagues.</p>
          )}
        </div>
      )}
    </div>
  );
}
