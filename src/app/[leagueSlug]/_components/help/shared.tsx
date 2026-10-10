"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type UserRole = "public" | "team" | "admin";
export type ActiveTab = "faqs" | "scenarios";

export interface FaqEntry {
  question: string;
  answer: ReactNode;
}

export interface ScenarioEntry {
  number: number;
  title: string;
  steps: string[];
}

export function AccordionItem({
  index,
  question,
  answer,
  openIndex,
  setOpenIndex,
}: {
  index: number;
  question: string;
  answer: ReactNode;
  openIndex: number | null;
  setOpenIndex: (i: number | null) => void;
}) {
  const isOpen = openIndex === index;
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpenIndex(isOpen ? null : index)}
        className="w-full flex items-center justify-between px-5 py-4 text-left text-white font-medium hover:bg-white/5 transition"
      >
        <span>{question}</span>
        <span className="ml-4 text-gray-400 shrink-0 text-xs">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 text-gray-300 text-sm leading-relaxed border-t border-white/10 pt-4">
          {answer}
        </div>
      )}
    </div>
  );
}

export function ScenarioCard({ number, title, steps }: ScenarioEntry) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <h3 className="font-semibold text-white mb-3">
        <span className="text-yellow-400 mr-2">{number}.</span>
        {title}
      </h3>
      <ol className="list-decimal list-inside space-y-2 text-gray-300 text-sm">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

export function PublicSignInPrompt({ message }: { message: string }) {
  // Come back to this page after signing in.
  const pathname = usePathname();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
      <p className="text-gray-400 text-sm">
        <strong className="text-white">Team member?</strong> {message}
      </p>
      <Link
        href={`/signin?next=${encodeURIComponent(pathname ?? "/")}`}
        className="inline-block mt-3 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 px-6 py-2 font-semibold text-slate-900 text-sm hover:from-yellow-300 hover:to-orange-400 transition"
      >
        Sign in with Google
      </Link>
      <p className="mt-2 text-xs text-gray-500">
        <Link href="/help" className="underline hover:text-gray-300">Help with signing in</Link>
      </p>
    </div>
  );
}

export function HelpTabBar({
  activeTab,
  onChange,
}: {
  activeTab: ActiveTab;
  onChange: (t: ActiveTab) => void;
}) {
  return (
    <div className="flex gap-2 mb-8">
      {(["faqs", "scenarios"] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition ${
            activeTab === tab ? "bg-yellow-500 text-slate-900" : "bg-white/5 text-gray-300 hover:bg-white/10"
          }`}
        >
          {tab === "faqs" ? "FAQs" : "Scenarios"}
        </button>
      ))}
    </div>
  );
}

export function SectionDivider({ title, color }: { title: string; color: "yellow" | "purple" | "orange" }) {
  const text = color === "yellow" ? "text-yellow-400" : color === "orange" ? "text-orange-400" : "text-purple-400";
  const line = color === "yellow" ? "bg-yellow-400/20" : color === "orange" ? "bg-orange-400/20" : "bg-purple-400/20";
  return (
    <h2 className={`text-lg font-bold ${text} mb-3 flex items-center gap-2`}>
      <span className={`h-px flex-1 ${line}`} />
      {title}
      <span className={`h-px flex-1 ${line}`} />
    </h2>
  );
}

const STRONG = "text-white";

/**
 * Sign-in and account questions, shared by every format's help — one copy instead of one per
 * format. Picks the wording by how the league's teams sign in: members-mode leagues (Google +
 * invite links) or legacy leagues (a team ID and password from the admin). Fuller answers, which
 * need no sign-in to read, live on the public /help page.
 */
export function accountFaqs(authMode: "legacy" | "members", opts: { twoPlayer: boolean }): FaqEntry[] {
  if (authMode === "legacy") {
    return [
      {
        question: "How do I sign in? (team ID)",
        answer: (
          <div className="space-y-2">
            <p>This league was created before Google sign-in, so your team signs in with the <strong className={STRONG}>team ID and password</strong> your league admin gave you — until the end of the 2026-27 season.</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Click <strong className={STRONG}>Sign In</strong> and use the team-ID form under the Google button.</li>
              <li>The first time, you&apos;ll be asked to set your own password.</li>
              <li>You&apos;re then taken to your team dashboard.</li>
            </ol>
            <p>Lost your team ID or password? Ask your league admin.</p>
          </div>
        ),
      },
    ];
  }

  return [
    {
      question: "How do I join this league?",
      answer: (
        <p>
          Open the <strong className={STRONG}>invite link</strong> your league admin shared and sign in with Google. You&apos;ll be
          given an open team, then set it up — its name{opts.twoPlayer ? " and both players' FPL IDs" : ""}. Some leagues ask the
          admin to approve each new player first.
        </p>
      ),
    },
    {
      question: "How do I sign in?",
      answer: (
        <p>
          Tap <strong className={STRONG}>Continue with Google</strong> — any Google account works. You&apos;re one person with one
          username across every league you play in. If a link opened inside WhatsApp or Instagram, use the
          <strong className={STRONG}> Open in Chrome / Safari</strong> button first: Google doesn&apos;t allow signing in there.
        </p>
      ),
    },
    ...(opts.twoPlayer
      ? [
          {
            question: "How do I add my teammate?",
            answer: (
              <p>
                From <strong className={STRONG}>Settings → Your team</strong>, the team owner creates a teammate invite (one use, valid
                7 days) and sends it to them. You can enter their FPL ID in team setup straight away — the team plays either way;
                the invite just gives them their own sign-in.
              </p>
            ),
          },
        ]
      : []),
    {
      question: "How do I switch to another league I'm in?",
      answer: (
        <p>
          Open the menu: <strong className={STRONG}>Your leagues</strong> lists every league you play in or run. Switching is just
          opening another league — you stay signed in as yourself.
        </p>
      ),
    },
    {
      question: "I lost access to my Google account",
      answer: (
        <p>
          Sign in with a new Google account, then ask your league admin to move your team to your new username. More on the{" "}
          <Link href="/help" className="underline">help page</Link>.
        </p>
      ),
    },
  ];
}

/** The "first time" walkthrough, by how the league's teams sign in. */
export function accountScenario(authMode: "legacy" | "members", number: number, opts: { twoPlayer: boolean }): ScenarioEntry {
  return authMode === "legacy"
    ? {
        number,
        title: "Signing in for the first time with a team ID",
        steps: [
          `Click "Sign In" and use the team-ID form under the Google button.`,
          "Enter the team ID and temporary password from your admin.",
          "You're redirected to the Change Password page — set your own password.",
          "You're signed in and taken to your team dashboard.",
        ],
      }
    : {
        number,
        title: "Joining with an invite link for the first time",
        steps: [
          "Open the invite link from your league admin. If it opened inside WhatsApp or Instagram, tap “Open in Chrome / Safari”.",
          "Tap “Continue with Google” and choose your Google account.",
          "Pick your username (and optionally your FPL ID, to fill in setup for you).",
          "Tap Join — you're given an open team in the league.",
          opts.twoPlayer
            ? "Set up your team: its name, your FPL ID and your teammate's. Then invite your teammate from Settings → Your team."
            : "Set up your team: its name. Then you're on your dashboard.",
        ],
      };
}
