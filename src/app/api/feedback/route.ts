import { NextRequest, NextResponse } from "next/server";
import { db, feedback, teams } from "@/lib/db";
import { eq } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { leagueFromRequest, resolveTeamActor, teamActorDenied } from "@/lib/team-actor";

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_SUBJECT_LENGTH = 200;

/**
 * POST /api/feedback
 * Submit user feedback. Scope is "site" (general) or "league" (this user's league).
 * A team session (legacy login, or a person acting in `?league=`) is required. leagueId is derived
 * from the team — never accepted from the body.
 */
export async function POST(request: NextRequest) {
  try {
    const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
    if (!actor) return teamActorDenied(denial);
    const teamId = actor.teamId;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { scope, subject, message } = body as { scope?: unknown; subject?: unknown; message?: unknown };

    if (scope !== "site" && scope !== "league") {
      return NextResponse.json({ error: "scope must be 'site' or 'league'" }, { status: 400 });
    }

    if (typeof message !== "string") {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < MIN_MESSAGE_LENGTH || trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `message must be between ${MIN_MESSAGE_LENGTH} and ${MAX_MESSAGE_LENGTH} characters` },
        { status: 400 }
      );
    }

    let trimmedSubject: string | null = null;
    if (subject !== undefined && subject !== null && subject !== "") {
      if (typeof subject !== "string") {
        return NextResponse.json({ error: "subject must be a string" }, { status: 400 });
      }
      const s = subject.trim();
      if (s.length > MAX_SUBJECT_LENGTH) {
        return NextResponse.json(
          { error: `subject must be ${MAX_SUBJECT_LENGTH} characters or fewer` },
          { status: 400 }
        );
      }
      trimmedSubject = s.length > 0 ? s : null;
    }

    const team = await db.select({ name: teams.name, leagueId: teams.leagueId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    if (team.length === 0) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const leagueId = scope === "league" ? team[0].leagueId : null;
    if (scope === "league" && !leagueId) {
      return NextResponse.json({ error: "Team has no associated league" }, { status: 400 });
    }

    const id = generateId();
    const now = new Date();
    await db.insert(feedback).values({
      id,
      scope,
      leagueId,
      submitterTeamId: teamId,
      submitterUserId: actor.userId,
      submitterName: team[0].name,
      subject: trimmedSubject,
      message: trimmedMessage,
      isImportant: false,
      resolvedAt: null,
      resolutionNote: null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (err) {
    console.error("Feedback POST error:", err);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}
