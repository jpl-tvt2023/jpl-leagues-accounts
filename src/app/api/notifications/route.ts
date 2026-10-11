import { NextRequest, NextResponse } from "next/server";
import { db, notifications } from "@/lib/db";
import { and, eq, desc, isNull, inArray, count } from "drizzle-orm";
import { getRequestSession, listSessionTeamIds } from "@/lib/team-actor";

/**
 * GET /api/notifications?leagueId=xxx&page=N&pageSize=50
 * Returns notifications for the signed-in team, paginated. A person (members leagues) sees every
 * team they are on in one feed — one bell across all their leagues; `leagueId` narrows it.
 *
 * - `page` defaults to 1, `pageSize` defaults to 30 (bell uses default).
 * - `pageSize` is capped at 100 to prevent unbounded responses; clients that
 *   need more should paginate.
 * - Response includes `totalCount` and `totalPages` so paginated UIs can
 *   render controls. `unreadCount` is the total across all pages (not just
 *   the current page).
 *
 * Legacy `limit=N` is still honoured: if provided it overrides `pageSize`
 * and forces `page=1` (preserves behaviour of older callers).
 */
export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);

  // Match PATCH's auth shape so the /notifications page's `status===401`
  // redirect-to-signin branch fires symmetrically. Returning 200 with an empty
  // payload here would mask the unauthenticated state and leave the page in a
  // confusing logged-out-but-rendered limbo.
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // A person sees all of their memberships (possibly none).
  const teamIds = await listSessionTeamIds(session);
  if (session.type !== "user" && teamIds.length === 0) {
    // Admins with no team of their own: unchanged from before people could join teams.
    return NextResponse.json({ error: "Team access required" }, { status: 403 });
  }
  const mine = inArray(notifications.teamId, teamIds.length > 0 ? teamIds : ["__none__"]);

  const leagueId = request.nextUrl.searchParams.get("leagueId");
  const legacyLimitParam = request.nextUrl.searchParams.get("limit");
  const pageParam = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
  const pageSizeParam = parseInt(request.nextUrl.searchParams.get("pageSize") ?? "30", 10);

  let page = Math.max(1, Number.isFinite(pageParam) ? pageParam : 1);
  let pageSize: number;
  if (legacyLimitParam != null) {
    const legacy = parseInt(legacyLimitParam, 10);
    pageSize = Math.min(100, Math.max(1, Number.isFinite(legacy) ? legacy : 30));
    page = 1;
  } else {
    pageSize = Math.min(100, Math.max(1, Number.isFinite(pageSizeParam) ? pageSizeParam : 30));
  }

  const where = leagueId ? and(mine, eq(notifications.leagueId, leagueId)) : mine;

  const [totalRow] = await db.select({ value: count() }).from(notifications).where(where);
  const totalCount = totalRow?.value ?? 0;

  const unreadWhere = and(where, isNull(notifications.readAt));
  const [unreadRow] = await db.select({ value: count() }).from(notifications).where(unreadWhere);
  const unreadCount = unreadRow?.value ?? 0;

  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
  const effectivePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const offset = (effectivePage - 1) * pageSize;

  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset(offset);

  return NextResponse.json({
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      link: r.link,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    unreadCount,
    totalCount,
    page: effectivePage,
    pageSize,
    totalPages,
  });
}

/**
 * PATCH /api/notifications
 * Body: { ids?: string[], all?: boolean }
 * Marks the specified notifications (or all unread ones for the session's teams) as read.
 */
export async function PATCH(request: NextRequest) {
  const session = await getRequestSession(request);
  const teamIds = await listSessionTeamIds(session);

  if (!session || teamIds.length === 0) {
    return NextResponse.json({ error: "Team authentication required" }, { status: 401 });
  }
  const mine = inArray(notifications.teamId, teamIds);

  const body = await request.json().catch(() => ({}));
  const { ids, all } = body as { ids?: string[]; all?: boolean };

  const now = new Date();

  if (all) {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(mine, isNull(notifications.readAt)));
  } else if (Array.isArray(ids) && ids.length > 0) {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(mine, inArray(notifications.id, ids)));
  } else {
    return NextResponse.json({ error: "Provide ids[] or all:true" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
