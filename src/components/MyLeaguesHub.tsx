"use client";

import Link from "next/link";
import { teamHref, useMyLeagues } from "@/lib/my-leagues-client";

/**
 * "Your leagues" on the home page for a signed-in person — the hub for one identity in many
 * leagues. Renders nothing for signed-out visitors and legacy team logins.
 */
export function MyLeaguesHub() {
  const leagues = useMyLeagues();
  if (!leagues) return null;
  const empty = leagues.teams.length === 0 && leagues.adminOf.length === 0 && !leagues.allLeagues;

  return (
    <section aria-labelledby="your-leagues" className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="your-leagues" className="text-lg sm:text-xl font-bold text-white">Your leagues</h2>
        <Link href="/account" className="text-sm text-yellow-400 hover:text-yellow-300">Account</Link>
      </div>

      {empty ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-gray-300">
          You&apos;re not in a league yet. Ask your league admin for an invite link and open it to join.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {leagues.teams.map((t) => (
            <Link key={t.leagueId} href={teamHref(t)} className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10">
              <span className="block truncate text-base font-bold text-white">{t.leagueName}</span>
              <span className="block truncate text-sm text-gray-300">{t.teamName}</span>
              <span className="mt-2 block text-xs text-gray-400">
                {t.isProfileComplete ? "Open your dashboard →" : "Finish setting up your team →"}
              </span>
            </Link>
          ))}
          {leagues.adminOf.map((a) => (
            <Link key={`admin-${a.leagueId}`} href={`/admin/${a.leagueId}`} className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10">
              <span className="block truncate text-base font-bold text-white">{a.leagueName}</span>
              <span className="block text-sm text-gray-300">You run this league</span>
              <span className="mt-2 block text-xs text-gray-400">Admin dashboard →</span>
            </Link>
          ))}
          {leagues.allLeagues && (
            <Link href="/admin" className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10">
              <span className="block text-base font-bold text-white">All leagues</span>
              <span className="mt-2 block text-xs text-gray-400">Platform admin →</span>
            </Link>
          )}
        </div>
      )}

      {leagues.pending.length > 0 && (
        <p className="mt-3 text-sm text-gray-400">
          Waiting for approval: {leagues.pending.map((p) => p.leagueName).join(", ")}
        </p>
      )}
    </section>
  );
}
