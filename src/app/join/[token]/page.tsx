import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, teams, users } from "@/lib/db";
import { INVITE_PROBLEM_MESSAGES, loadInvite, pendingRequestFor, teamOfUserInLeague } from "@/lib/membership";
import { resolveViewer } from "@/lib/viewer";
import { detectInAppBrowser } from "@/lib/in-app-browser";
import { getFormatPalette } from "@/lib/format-palette";
import { JoinClient, type JoinState } from "./JoinClient";

export const dynamic = "force-dynamic";

const FORMAT_LABEL: Record<string, string> = {
  tvt: "Team vs Team",
  "continental-championship": "Continental Championship",
  auction: "Auction",
};

/**
 * /join/<token> — where an invite link lands. Works out the one thing this visitor needs to do
 * next (open in a real browser, sign in, pick a username, join, wait for approval) and shows that.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const selfPath = `/join/${encodeURIComponent(token)}`;

  const loaded = await loadInvite(token);
  const viewer = await resolveViewer();
  const inApp = detectInAppBrowser(h.get("user-agent"));

  let state: JoinState;
  if (!loaded) {
    state = { kind: "invalid", message: INVITE_PROBLEM_MESSAGES["not-found"] };
  } else {
    const { league, invite, team } = loaded;
    const palette = getFormatPalette(league.format, league.teamSize);
    const card = {
      leagueName: league.name,
      leagueSlug: league.slug,
      leagueId: league.id,
      season: league.season,
      formatLabel: FORMAT_LABEL[league.format] ?? league.format,
      badgeClass: `${palette.badgeBg} ${palette.badgeText}`,
      teamName: team?.name ?? null,
      openSlots: loaded.openSlots,
      requiresApproval: invite.requiresApproval,
    };

    if (!viewer.authenticated) {
      state = inApp.inApp ? { kind: "in-app", card, inApp } : { kind: "signed-out", card };
    } else if (viewer.type === "team") {
      state = { kind: "team-login", card };
    } else {
      const [me] = await db.select({ username: users.username }).from(users).where(eq(users.id, viewer.userId!)).limit(1);
      const mine = await teamOfUserInLeague(viewer.userId!, league.id);
      if (mine) {
        const [t] = await db.select({ done: teams.isProfileComplete }).from(teams).where(eq(teams.id, mine.teamId)).limit(1);
        state = { kind: "member", card, href: t?.done ? `/${league.slug}/dashboard` : `/${league.slug}/setup` };
      } else if (loaded.problem) {
        state = { kind: "invalid", message: INVITE_PROBLEM_MESSAGES[loaded.problem], card };
      } else if (!me?.username) {
        state = { kind: "needs-username", card };
      } else if (await pendingRequestFor(league.id, viewer.userId!)) {
        state = { kind: "pending", card };
      } else {
        state = { kind: "ready", card };
      }
    }
    // Problems with the link itself trump sign-in steps — no point signing in to a dead link.
    if (loaded.problem && (state.kind === "signed-out" || state.kind === "in-app" || state.kind === "team-login")) {
      state = { kind: "invalid", message: INVITE_PROBLEM_MESSAGES[loaded.problem], card: state.card };
    }
  }

  return <JoinClient token={token} state={state} selfPath={selfPath} selfUrl={`${proto}://${host}${selfPath}`} />;
}
