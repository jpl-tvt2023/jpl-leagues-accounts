import { NextResponse, type NextRequest } from "next/server";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/**
 * The installed app's `start_url` (see `src/app/manifest.ts`).
 *
 * `/` is a signed-in person's home (every league they play in or run) and everyone else's league
 * list, so that's where the app opens — except for a superadmin, who goes to platform admin, as
 * after sign-in.
 */
export async function GET(request: NextRequest) {
  const viewer = await resolveViewer();
  const target = viewer.authenticated && viewer.type === "superadmin" ? viewer.dashboardHref : "/";
  return NextResponse.redirect(new URL(target, request.url), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
