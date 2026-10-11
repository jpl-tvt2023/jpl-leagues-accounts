import Link from "next/link";
import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";

export const metadata: Metadata = { title: "Privacy · JPL India" };

const H2 = "mt-8 mb-2 text-lg font-semibold text-white";

/**
 * What this site stores about people and why. Google's OAuth consent screen links here (a
 * privacy policy URL is required before the app can be published). Keep it in step with what
 * the code actually stores — see users / user_identities / team_members in src/lib/db/schema.ts.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900">
      <AppNav context={{ surface: "public", page: "flow" }} activeKey="" brandHref="/" brandLabel="JPL India" title="Privacy" />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10 sm:py-14 text-sm sm:text-base leading-relaxed text-gray-300">
        <h1 className="text-2xl sm:text-4xl font-bold text-white">What we store, and why</h1>
        <p className="mt-2 text-xs text-gray-500">Last updated 10 October 2026</p>

        <h2 className={H2}>When you sign in with Google</h2>
        <p>
          We ask Google only for your <strong className="text-white">name, email address, profile picture</strong> and the
          account ID Google uses for you. We don&apos;t get access to your Gmail, contacts, Drive or anything else, and we
          never see your Google password.
        </p>

        <h2 className={H2}>What you add</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your username and display name.</li>
          <li>Your FPL team ID, if you give it — to fill in team setup.</li>
          <li>Your teams: team names, the FPL IDs of a team&apos;s players, and which leagues you&apos;re in.</li>
          <li>What you do in a league: captain picks and chips (including which teammate made them), bids and trades in auction leagues, and any feedback you send.</li>
        </ul>

        <h2 className={H2}>Who can see it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your <strong className="text-white">username and display name</strong> are visible to people in the leagues you play in.</li>
          <li>Your <strong className="text-white">email</strong> is visible only to the admins of your leagues and the platform admins.</li>
          <li>Team names, scores, standings and fixtures are public league pages, as they always have been.</li>
        </ul>

        <h2 className={H2}>Why</h2>
        <p>
          To sign you in, put you on the right team, run the leagues you joined, and let admins contact the people in
          their league. We don&apos;t sell or share your information, and there are no ads or tracking.
        </p>

        <h2 className={H2}>Cookies</h2>
        <p>
          Only the ones that keep you signed in: a session cookie, a list of the accounts signed in on this device, and
          short-lived cookies used for ten minutes during Google sign-in. No analytics or advertising cookies.
        </p>

        <h2 className={H2}>Where it lives</h2>
        <p>
          The site runs on Vercel and stores data in a Turso database. Results and FPL data are cached briefly to keep
          pages fast.
        </p>

        <h2 className={H2}>Deleting your account</h2>
        <p>
          You can delete your account at any time from <Link href="/account" className="underline">your account</Link> page.
          That removes your account, your Google link and your team memberships. Your teams themselves stay in their
          leagues so the season isn&apos;t disrupted — a team you shared passes to your teammate. League results stay as
          part of the league&apos;s history.
        </p>

        <h2 className={H2}>Questions</h2>
        <p>Ask your league admin, who can pass anything they can&apos;t answer to the platform admins.</p>

        <p className="mt-10 text-center text-sm text-gray-500">
          <Link href="/help" className="underline hover:text-gray-300">Help</Link> ·{" "}
          <Link href="/signin" className="underline hover:text-gray-300">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
