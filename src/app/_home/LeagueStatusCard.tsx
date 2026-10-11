import Link from "next/link";
import type { ReactNode } from "react";
import { getFormatPalette } from "@/lib/format-palette";
import { formatCurrency } from "@/lib/format/currency";
import { cardHref, type AuctionStatus, type ClassicStatus, type H2hStatus, type MyLeagueCard } from "@/lib/dashboard/overview";
import { formatCountdown, ordinal } from "./format";

/**
 * One of the person's leagues on their home page: where they stand, at a glance, in that league's
 * own terms. The whole card opens the league (dashboard, setup, admin or standings); secondary
 * links sit above that stretched link.
 */
export function LeagueStatusCard({ card, now }: { card: MyLeagueCard; now: number }) {
  const palette = getFormatPalette(card.format, card.teamSize);
  const href = cardHref(card);
  const cta =
    card.relation === "admin"
      ? "Admin dashboard"
      : card.relation === "classic"
        ? "Standings"
        : card.needsSetup
          ? "Finish team setup"
          : "Open dashboard";
  const subtitle = card.relation === "admin" ? "You run this league" : card.teamName;

  return (
    <article
      className={`relative flex h-full flex-col rounded-2xl border ${palette.borderTint} ${palette.surfaceTint} bg-slate-900/60 p-4 sm:p-5 shadow-lg transition hover:bg-white/[0.06] focus-within:ring-2 focus-within:ring-yellow-400/60`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-base sm:text-lg font-bold text-white">
            {/* Stretched link: the whole card opens the league. */}
            <Link href={href} className="after:absolute after:inset-0 after:rounded-2xl focus:outline-none">
              {card.name}
            </Link>
          </h4>
          {subtitle && <p className="truncate text-sm text-gray-300">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${palette.badgeBg} ${palette.badgeText}`}>
            {palette.label}
          </span>
          <span className="text-[11px] text-gray-500">{card.season}</span>
        </div>
      </header>

      <div className="flex-1 space-y-2 text-sm">
        {card.error ? (
          <p className="text-gray-400">Couldn&apos;t load this league&apos;s numbers just now.</p>
        ) : card.relation === "team" && card.needsSetup ? (
          <p className="text-gray-300">Your team isn&apos;t set up yet. It takes a minute.</p>
        ) : card.relation === "admin" ? (
          <AdminBody card={card} />
        ) : card.status?.kind === "h2h" ? (
          <H2hBody status={card.status} now={now} />
        ) : card.status?.kind === "auction" ? (
          <AuctionBody status={card.status} now={now} />
        ) : card.status?.kind === "classic" ? (
          <ClassicBody status={card.status} />
        ) : (
          <p className="text-gray-400">No numbers yet.</p>
        )}
        {card.relation === "team" && !card.needsSetup && card.hasPartnerSlot && !card.isProfileComplete && (
          <p className="text-amber-200">
            <span aria-hidden="true">● </span>Waiting for your partner to join
          </p>
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-yellow-400">{cta} →</span>
        {card.isAdmin && card.relation !== "admin" && (
          <Link
            href={`/admin/${card.leagueId}`}
            className="relative z-10 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-gray-200 transition hover:bg-white/10"
          >
            Admin{card.pendingRequests > 0 ? ` · ${card.pendingRequests} waiting` : ""}
          </Link>
        )}
        {card.relation === "admin" && (
          <Link
            href={`/${card.slug}/standings`}
            className="relative z-10 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-gray-200 transition hover:bg-white/10"
          >
            League pages
          </Link>
        )}
      </footer>
    </article>
  );
}

function Headline({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-2xl font-semibold text-white">{children}</p>
      {aside}
    </div>
  );
}

const ZONE: Record<NonNullable<H2hStatus["zone"]>, { label: string; done?: string; cls: string; icon: string }> = {
  playoffs: { label: "Playoff spot", cls: "bg-green-500/15 text-green-300", icon: "▲" },
  challenger: { label: "Challenger zone", cls: "bg-amber-500/15 text-amber-200", icon: "◆" },
  eliminated: { label: "Elimination zone", done: "Eliminated", cls: "bg-red-500/15 text-red-300", icon: "▼" },
};

function H2hBody({ status: s, now }: { status: H2hStatus; now: number }) {
  // Before a match is played every team is level, so no zone yet.
  const zone = s.zone && s.played > 0 ? ZONE[s.zone] : null;
  return (
    <>
      {s.rank > 0 ? (
        <Headline
          aside={
            zone && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${zone.cls}`}>
                <span aria-hidden="true">{zone.icon}</span>
                {s.stageComplete && zone.done ? zone.done : zone.label}
              </span>
            )
          }
        >
          {ordinal(s.rank)}
          <span className="ml-1.5 text-sm font-normal text-gray-400">
            of {s.of}
            {s.groupName ? ` · Group ${s.groupName}` : ""}
          </span>
        </Headline>
      ) : (
        <p className="text-gray-400">Not ranked yet.</p>
      )}
      <p className="text-gray-300">
        {s.leaguePoints} pts · {s.wins}W {s.draws}D {s.losses}L
      </p>
      {s.lastResult && (
        <p className="text-gray-300">
          <span className="text-gray-500">Last: </span>
          <span
            className={`mr-1 inline-block w-5 rounded text-center text-xs font-bold ${
              s.lastResult.outcome === "W" ? "bg-green-500/20 text-green-300" : s.lastResult.outcome === "D" ? "bg-white/10 text-gray-200" : "bg-red-500/20 text-red-300"
            }`}
          >
            {s.lastResult.outcome}
          </span>
          {s.lastResult.scored}–{s.lastResult.conceded} vs {s.lastResult.opponent}
          <span className="text-gray-500"> · GW{s.lastResult.gw}</span>
        </p>
      )}
      {s.nextFixture && (
        <p className="text-gray-300">
          <span className="text-gray-500">Next: </span>
          GW{s.nextFixture.gw} vs {s.nextFixture.opponent} ({s.nextFixture.home ? "H" : "A"})
        </p>
      )}
      {s.cup && (
        <p className="text-gray-300">
          <span className="text-gray-500">JPL Cup: </span>
          {ordinal(s.cup.rank)} of {s.cup.of} in group · {s.cup.zone === "jcl" ? "JCL" : "JEL"} spot
        </p>
      )}
      {s.captain &&
        (s.captain.set ? (
          <p className="text-green-300">
            <span aria-hidden="true">✓ </span>Captain picked for GW{s.captain.gw}
          </p>
        ) : (
          <p className="font-semibold text-amber-200">
            <span aria-hidden="true">! </span>Pick your GW{s.captain.gw} captain · {formatCountdown(Date.parse(s.captain.deadline) - now)} left
          </p>
        ))}
    </>
  );
}

function AuctionBody({ status: s, now }: { status: AuctionStatus; now: number }) {
  return (
    <>
      {s.rank > 0 ? (
        <Headline>
          {ordinal(s.rank)}
          <span className="ml-1.5 text-sm font-normal text-gray-400">of {s.of} · {s.totalPoints} pts</span>
        </Headline>
      ) : (
        <p className="text-gray-400">Not ranked yet.</p>
      )}
      <p className="text-gray-300">
        Purse {formatCurrency(s.purse)} · Squad {s.squadSize}
      </p>
      {s.lastGw && (
        <p className="text-gray-300">
          <span className="text-gray-500">GW{s.lastGw.gw}: </span>
          {s.lastGw.points} pts{s.lastGw.rank ? ` · ${ordinal(s.lastGw.rank)} that week` : ""}
        </p>
      )}
      {s.auction?.state === "live" && (
        <p className="inline-flex items-center gap-1.5 font-semibold text-green-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" aria-hidden="true" />
          Auction live now
        </p>
      )}
      {s.auction?.state === "scheduled" && s.auction.at && (
        <p className="text-gray-300">
          <span className="text-gray-500">Next auction: </span>
          {new Date(s.auction.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          <span className="text-gray-500"> · in {formatCountdown(Date.parse(s.auction.at) - now)}</span>
        </p>
      )}
    </>
  );
}

function ClassicBody({ status: s }: { status: ClassicStatus }) {
  return (
    <>
      {s.rank > 0 ? (
        <Headline>
          {ordinal(s.rank)}
          <span className="ml-1.5 text-sm font-normal text-gray-400">of {s.of} · {s.totalPoints} pts</span>
        </Headline>
      ) : (
        <p className="text-gray-400">Not ranked yet.</p>
      )}
      <p className="text-xs text-gray-500">As of the last sync with FPL</p>
    </>
  );
}

function AdminBody({ card }: { card: MyLeagueCard }) {
  return card.pendingRequests > 0 ? (
    <p className="font-semibold text-amber-200">
      <span aria-hidden="true">! </span>
      {card.pendingRequests} join request{card.pendingRequests === 1 ? "" : "s"} waiting
    </p>
  ) : (
    <p className="text-gray-300">Nothing waiting for you.</p>
  );
}
