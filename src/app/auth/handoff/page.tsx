import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { authHandoffs, db } from "@/lib/db";
import { HANDOFF_ID_RE, isHandoffEnabled } from "@/lib/auth-handoff";
import { HandoffConfirm } from "./HandoffConfirm";

export const dynamic = "force-dynamic";

/**
 * /auth/handoff?h=<id> — where Google sign-in lands when it was started from the iOS home-screen
 * app. Shows the handoff's code and asks the person to confirm it matches what their app shows.
 */
export default async function HandoffPage({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  if (!isHandoffEnabled()) notFound();
  const { h } = await searchParams;
  const handoff = h && HANDOFF_ID_RE.test(h)
    ? (await db.select().from(authHandoffs).where(eq(authHandoffs.id, h)).limit(1))[0]
    : undefined;
  const usable = !!handoff && handoff.status === "pending" && handoff.expiresAt > new Date();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-purple-900 to-slate-900 px-4 py-16">
      <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
        {usable ? (
          <HandoffConfirm handoffId={handoff.id} matchCode={handoff.matchCode} />
        ) : (
          <>
            <h1 className="text-xl font-bold text-white">This sign-in link has expired</h1>
            <p className="mt-2 text-sm text-gray-400">Go back to the JPL app and tap “Continue with Google” again.</p>
          </>
        )}
      </div>
    </div>
  );
}
