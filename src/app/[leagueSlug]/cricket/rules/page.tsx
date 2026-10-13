"use client";

import type { ReactNode } from "react";
import { useLeague } from "@/lib/league-context";
import { formatLakhs } from "@/lib/format/currency";
import { ROLES, ROLE_LABELS } from "@/lib/sports/cricket/squad-rules";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-2 font-semibold text-white">
        {n}. {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-gray-300">{children}</div>
    </Card>
  );
}

/** The league's rules, filled in from its own settings so they can never disagree with the code. */
export default function CricketRulesPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const c = data?.config;
  const r = c?.squadRules;

  return (
    <CricketShell currentPage="rules" title="Rules" subtitle={data && `Classic Cricket Auction · ${data.tournament.name}`} loading={!data} error={error}>
      {data && c && r && (
        <div className="space-y-4">
          <Section n="A" title="The league">
            <p>
              Each manager builds a squad of real {data.tournament.name} players in a live auction. Every player in your squad
              scores their fantasy points from every match of the tournament; your total is the sum. The highest total at the
              end wins. There are no captains, no transfers and no weekly line-ups — once the auction ends, your squad is final.
            </p>
          </Section>

          <Section n="B" title="Money">
            <p>
              Every team starts with a purse of <strong className="text-white">{formatLakhs(c.purse)}</strong>.
              {c.franchiseAuctionEnabled && " Franchises and players are paid for from the same purse."} You must always keep
              enough to complete your minimum squad at the cheapest base price, so a bid that would leave too little is refused.
            </p>
            <p>
              Bids go up in steps: +₹5 L below ₹1 Cr, +₹10 L up to ₹2 Cr, +₹20 L up to ₹5 Cr, and +₹25 L above that.
            </p>
          </Section>

          {c.franchiseAuctionEnabled && (
            <Section n="C" title="Franchise auction">
              <p>Before the player auction, each manager buys one franchise. Each franchise has one owner.</p>
              <p>
                Managers take turns to nominate a franchise, and the nominator opens the bidding. A franchise opens at its base
                price or at the average price paid for franchises so far, whichever is higher — so waiting until the end is no
                bargain. If your nomination timer runs out, a franchise you can afford is nominated for you and you open the bidding.
              </p>
              <p>
                Your team takes your franchise&apos;s name, and players from your franchise score{" "}
                <strong className="text-white">{c.franchiseBoostPercent}% extra</strong> (on all their points, minus points
                included).
              </p>
            </Section>
          )}

          <Section n={c.franchiseAuctionEnabled ? "D" : "C"} title="Player auction">
            <p>
              Managers take turns to nominate a player, who opens at their base price with the nominator as first bidder. Each bid
              resets a short timer; when it runs out, the highest bidder buys the player.
            </p>
            <p>
              If your nomination timer runs out, the first affordable player on your wishlist is nominated for you. If there
              isn&apos;t one, you get a penalty slot — one fewer player your squad can hold — which you can clear straight away for{" "}
              <strong className="text-white">{formatLakhs(c.penaltyRedeemPrice)}</strong>.
            </p>
          </Section>

          <Section n={c.franchiseAuctionEnabled ? "E" : "D"} title="Squad">
            <p>
              Squads have <strong className="text-white">{r.minSize === r.maxSize ? r.minSize : `${r.minSize} to ${r.maxSize}`}</strong> players:
            </p>
            <ul className="list-inside list-disc">
              {ROLES.map((role) => (
                <li key={role}>
                  {ROLE_LABELS[role]}s: at least {r.roleMin[role]}
                  {r.roleMax[role] !== null && `, at most ${r.roleMax[role]}`}
                </li>
              ))}
              {r.maxPerRealTeam !== null && <li>At most {r.maxPerRealTeam} players from one team</li>}
              {r.maxOverseas !== null && <li>At most {r.maxOverseas} overseas players</li>}
            </ul>
          </Section>

          <Section n={c.franchiseAuctionEnabled ? "F" : "E"} title="Scoring and the table">
            <p>
              Points come from each match&apos;s official fantasy scores, uploaded after the match. The table updates as soon as a
              match is uploaded. Abandoned matches don&apos;t count.
            </p>
            <p>
              Teams level on points are separated by{c.franchiseAuctionEnabled ? " synergy (franchise boost) points, then by" : ""} the
              team&apos;s highest-scoring player, then by the purse left. The league ends when every match has been scored.
            </p>
          </Section>
        </div>
      )}
    </CricketShell>
  );
}
