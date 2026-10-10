import Link from "next/link";
import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";

export const metadata: Metadata = { title: "Help · JPL Leagues" };

interface Entry {
  id: string;
  q: string;
  a: React.ReactNode;
}

const STRONG = "font-semibold text-white";

/**
 * Account and sign-in help, as plain sections. Kept apart from each league's own help — which
 * needs you signed in — because sign-in problems happen before you can sign in. Each entry has
 * an anchor so other pages can link straight to it (the open-in-browser screen links to
 * #in-app-browser).
 */
const SECTIONS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: "Signing in",
    entries: [
      {
        id: "sign-in",
        q: "How do I sign in?",
        a: (
          <p>
            Tap <span className={STRONG}>Continue with Google</span> on the sign-in page. Any Google account works — it
            doesn&apos;t have to be Gmail. The first time, you&apos;ll pick a username.
          </p>
        ),
      },
      {
        id: "in-app-browser",
        q: "I opened the link in WhatsApp or Instagram and can't sign in",
        a: (
          <>
            <p>
              Google doesn&apos;t allow signing in from an app&apos;s built-in browser, so the page shows an
              <span className={STRONG}> Open in Chrome</span> (Android) or <span className={STRONG}>Open in Safari</span> (iPhone)
              button instead. Tap it — your invite link comes with you.
            </p>
            <p className="mt-2">
              If the button doesn&apos;t work, tap <span className={STRONG}>Copy link</span> and paste it into your browser, or use
              the app&apos;s menu (⋮ or ⋯) and choose “Open in browser”.
            </p>
          </>
        ),
      },
      {
        id: "iphone-code",
        q: "Signing in from the app on my iPhone home screen asks me to confirm a code",
        a: (
          <p>
            The home-screen app and Safari keep separate sign-ins, so after Google the browser shows a short code and asks
            whether your app shows the same one. If it matches, tap <span className={STRONG}>Yes, it matches</span> and go back
            to the app. <span className={STRONG}>Only confirm a code your own app is showing</span> — never one someone sends you.
          </p>
        ),
      },
      {
        id: "old-team-id",
        q: "I have a team ID and password from my league admin",
        a: (
          <p>
            Those still work for leagues created before Google sign-in, until the end of the 2026-27 season. Use the
            team-ID form under the Google button on the sign-in page.
          </p>
        ),
      },
    ],
  },
  {
    title: "Your username",
    entries: [
      {
        id: "username",
        q: "What is my username for, and can I change it?",
        a: (
          <p>
            It&apos;s how teammates and league admins find you — admins can add you to a team by username. It&apos;s one
            username for every league you play in: 3–20 characters, lowercase letters, numbers and underscores. Change it
            any time from <Link href="/account" className="underline">your account</Link>.
          </p>
        ),
      },
    ],
  },
  {
    title: "Leagues and teams",
    entries: [
      {
        id: "join",
        q: "How do I join a league?",
        a: (
          <p>
            Open the invite link your league admin shared, sign in, and you&apos;ll be given an open team in that league.
            Then set up your team — its name and, for two-player formats, both FPL IDs.
          </p>
        ),
      },
      {
        id: "approval",
        q: "My join says it's waiting for approval",
        a: (
          <p>
            That league&apos;s admin approves each new player. You&apos;ll see the league on your account page once
            they do. You can cancel the request from the join page.
          </p>
        ),
      },
      {
        id: "invite-expired",
        q: "The invite link says it has expired or the league is full",
        a: <p>Invite links expire and can be turned off by the admin. Ask your league admin for a new one.</p>,
      },
      {
        id: "teammate",
        q: "How do I add my teammate? (two-player formats)",
        a: (
          <p>
            From your team&apos;s page, create a teammate invite and send it to them. It works once and lasts seven days.
            You can enter their FPL ID yourself straight away — the team can play before they ever sign in.
          </p>
        ),
      },
      {
        id: "switch",
        q: "How do I switch between my leagues?",
        a: (
          <p>
            Use the league switcher in the menu, or open any of your leagues from the home page. You stay signed in as
            yourself — there&apos;s nothing extra to sign in to.
          </p>
        ),
      },
    ],
  },
  {
    title: "Your account",
    entries: [
      {
        id: "sign-out-everywhere",
        q: "I signed in on someone else's phone, or lost mine",
        a: (
          <p>
            On <Link href="/account" className="underline">your account</Link> page, tap{" "}
            <span className={STRONG}>Sign out of all other devices</span>. Every other sign-in stops working straight away.
          </p>
        ),
      },
      {
        id: "lost-google",
        q: "I lost access to my Google account",
        a: (
          <p>
            Sign in with a new Google account, then ask your league admin to move your team to your new username. If
            you&apos;re in several leagues, the platform admin can move all of them at once.
          </p>
        ),
      },
      {
        id: "delete",
        q: "How do I delete my account?",
        a: (
          <p>
            At the bottom of <Link href="/account" className="underline">your account</Link> page. Your teams stay in their
            leagues: a team you share passes to your teammate, and otherwise your league admin can give it to someone
            else. See <Link href="/privacy" className="underline">what we store</Link>.
          </p>
        ),
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "flow" }} activeKey="" brandHref="/" brandLabel="JPL Sports" title="Help" />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-2xl sm:text-4xl font-bold text-white">Help with signing in and accounts</h1>
        <p className="mt-2 text-sm sm:text-base text-gray-400">
          Questions about a league&apos;s rules, scoring or chips are in that league&apos;s own Help page once you&apos;re signed in.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`h-${section.title}`} className="mt-8">
            <h2 id={`h-${section.title}`} className="mb-3 text-lg font-semibold text-white">{section.title}</h2>
            <div className="space-y-2">
              {section.entries.map((e) => (
                <details key={e.id} id={e.id} className="group scroll-mt-24 rounded-xl border border-white/10 bg-white/5 p-4 open:bg-white/10">
                  <summary className="cursor-pointer list-none font-medium text-white marker:hidden">
                    <span className="mr-2 inline-block text-yellow-400 transition group-open:rotate-90">›</span>
                    {e.q}
                  </summary>
                  <div className="mt-3 text-sm leading-relaxed text-gray-300">{e.a}</div>
                </details>
              ))}
            </div>
          </section>
        ))}

        <p className="mt-10 text-center text-sm text-gray-500">
          Still stuck? Ask your league admin. · <Link href="/signin" className="underline hover:text-gray-300">Sign in</Link> ·{" "}
          <Link href="/privacy" className="underline hover:text-gray-300">Privacy</Link>
        </p>
      </main>
    </div>
  );
}
