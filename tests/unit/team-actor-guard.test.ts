/**
 * Guard: team-scoped routes must resolve their team through src/lib/team-actor.ts.
 *
 * In a legacy league the session id IS the team id, so reading `session.id` or the middleware's
 * `x-session-id` header "worked". For a person in a members league the session id is a users.id —
 * a route that kept reading it would act as no team at all, or, compared against a team id, could
 * silently skip its ownership check. Every team-scoped route goes through resolveTeamActor /
 * sessionActsAsTeam / sessionTeamIdInLeague instead, which check membership in the database.
 *
 * A line that genuinely wants the users.id (an admin-only branch) opts out with a
 * `team-actor-guard-ignore: <reason>` comment on the same line.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../src/app/api");
const TEAM_SCOPED_DIRS = ["team", "auction", "notifications", "feedback"];
const FORBIDDEN = [/["']x-session-id["']/, /\bsession\??\.id\b/];

function routeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test("team-scoped routes never read the session id as a team id", () => {
  const offenders: string[] = [];
  const files = TEAM_SCOPED_DIRS.flatMap((d) => routeFiles(path.join(ROOT, d)));
  assert.ok(files.length > 20, `expected to scan the team-scoped routes, found only ${files.length} files`);

  for (const file of files) {
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (line.includes("team-actor-guard-ignore")) return;
        if (FORBIDDEN.some((re) => re.test(line))) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
        }
      });
  }

  assert.deepEqual(
    offenders,
    [],
    "Resolve the team with resolveTeamActor / sessionActsAsTeam / sessionTeamIdInLeague " +
      "(src/lib/team-actor.ts) instead of reading the session id:\n" + offenders.join("\n"),
  );
});

test("every opt-out says why", () => {
  const files = TEAM_SCOPED_DIRS.flatMap((d) => routeFiles(path.join(ROOT, d)));
  const bare = files.flatMap((file) =>
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => /team-actor-guard-ignore(?!:\s*\S)/.test(line))
      .map((line) => `${path.relative(ROOT, file)}: ${line.trim()}`),
  );
  assert.deepEqual(bare, [], "team-actor-guard-ignore needs a reason after a colon");
});
