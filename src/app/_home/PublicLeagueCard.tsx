import Link from "next/link";
import { sportInfo } from "@/lib/sports";

export interface PublicLeague {
  id: string;
  slug: string;
  name: string;
  sport: string;
  format: string;
  season: string;
  isActive: boolean;
}

const SPORT_GRADIENTS: Record<string, string> = {
  fpl: "from-purple-900/60 via-blue-900/40 to-slate-900/60",
  cricket: "from-emerald-900/40 via-teal-900/30 to-slate-900/60",
};

const SPORT_GLOW: Record<string, string> = {
  fpl: "bg-purple-600/10",
  cricket: "bg-emerald-600/10",
};

const STANDINGS_BTN: Record<string, string> = {
  fpl: "bg-purple-600 hover:bg-purple-500 text-white",
  cricket: "bg-emerald-700/40 text-emerald-300",
};

// Format-specific overrides (applied on top of sport defaults)
const FORMAT_GRADIENT: Record<string, string> = {
  "continental-championship": "from-[#0d1a33]/90 via-[#061426]/80 to-slate-900/70",
  "fpl-classic": "from-sky-950/80 via-slate-900/80 to-slate-900/70",
};

const FORMAT_GLOW: Record<string, string> = {
  "continental-championship": "bg-[#0066cc]/15",
  "fpl-classic": "bg-sky-500/15",
};

const FORMAT_PRIMARY_BTN: Record<string, string> = {
  "continental-championship": "bg-[#00cc44] hover:bg-[#00ff55] text-slate-900 font-bold",
  "fpl-classic": "bg-sky-400 hover:bg-sky-300 text-slate-900 font-bold",
};

const SECONDARY_BTN =
  "rounded-full border border-white/20 bg-white/5 px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-white transition hover:bg-white/10";

/**
 * A league's public card: name, live state, and links to its public pages. Used on the signed-out
 * landing page and, for leagues the person isn't in, on their home page (`compact`).
 */
export function PublicLeagueCard({ league, compact = false }: { league: PublicLeague; compact?: boolean }) {
  const icon = sportInfo(league.sport).icon;
  const gradient = FORMAT_GRADIENT[league.format] ?? SPORT_GRADIENTS[league.sport] ?? "from-slate-800/60 to-slate-900/60";
  const glow = FORMAT_GLOW[league.format] ?? SPORT_GLOW[league.sport] ?? "bg-white/5";
  const standingsBtn = FORMAT_PRIMARY_BTN[league.format] ?? STANDINGS_BTN[league.sport] ?? "bg-white/10 text-white";
  const primary = `rounded-full px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition ${standingsBtn}`;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${gradient} ${
        compact ? "p-4 sm:p-5" : "p-5 sm:p-8"
      } shadow-xl h-full flex flex-col`}
    >
      <div className={`absolute -right-8 -top-8 h-32 w-32 sm:h-40 sm:w-40 rounded-full ${glow} blur-2xl`} />
      <div className="relative flex flex-col flex-1">
        <div className={`${compact ? "mb-3" : "mb-4 sm:mb-5"} flex items-center gap-3`}>
          <span className={compact ? "text-2xl" : "text-3xl sm:text-4xl"} aria-hidden="true">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`${compact ? "text-base sm:text-lg" : "text-lg sm:text-2xl"} font-extrabold text-white truncate`}>{league.name}</h3>
              {league.isActive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2.5 py-0.5 text-xs font-semibold text-green-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                  </span>
                  Live
                </span>
              ) : (
                <span className="rounded-full bg-yellow-500/20 px-2.5 py-0.5 text-xs font-semibold text-yellow-400">
                  Coming Soon
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-gray-400">
              {league.sport.toUpperCase()} · {league.format.toUpperCase()} · {league.season}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-auto">
          {league.format === "continental-championship" ? (
            <>
              <Link href={`/${league.slug}/standings`} className={primary}>JPL Standings</Link>
              <Link href={`/${league.slug}/fixtures`} className={SECONDARY_BTN}>JPL Fixtures</Link>
              <Link href={`/${league.slug}/jpl-cup-standings`} className={SECONDARY_BTN}>JPL Cup Standings</Link>
              <Link href={`/${league.slug}/jpl-cup-fixtures`} className={SECONDARY_BTN}>JPL Cup Fixtures</Link>
              <Link href={`/${league.slug}/playoffs`} className={SECONDARY_BTN}>Playoffs</Link>
            </>
          ) : league.format === "fpl-classic" ? (
            /* Only the two pages this format actually has. Linking Fixtures or
               Playoffs here would send a reader to a page that 404s by design. */
            <>
              <Link href={`/${league.slug}/standings`} className={primary}>Standings</Link>
              <Link href={`/${league.slug}/rules`} className={SECONDARY_BTN}>Rules</Link>
            </>
          ) : (
            <>
              <Link href={`/${league.slug}/standings`} className={primary}>Standings</Link>
              <Link href={`/${league.slug}/fixtures`} className={SECONDARY_BTN}>Fixtures</Link>
              {league.format !== "auction" && (
                <Link href={`/${league.slug}/playoffs`} className={SECONDARY_BTN}>Playoffs</Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
