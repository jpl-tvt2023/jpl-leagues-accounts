/**
 * Every top-level route must be a reserved league slug (src/lib/reserved-slugs.ts), or a league
 * created with that slug would be shadowed by the route and unreachable.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RESERVED_LEAGUE_SLUGS, isReservedLeagueSlug } from "../../src/lib/reserved-slugs";

test("every top-level route folder is a reserved league slug", () => {
  const appDir = path.resolve(__dirname, "../../src/app");
  const routes = fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("(") && !d.name.startsWith("_"))
    .map((d) => d.name);
  assert.ok(routes.length > 5, "expected to find the top-level routes");
  const missing = routes.filter((r) => !RESERVED_LEAGUE_SLUGS.has(r));
  assert.deepEqual(missing, [], `add these to RESERVED_LEAGUE_SLUGS: ${missing.join(", ")}`);
});

test("reserved check ignores case", () => {
  assert.equal(isReservedLeagueSlug("Help"), true);
  assert.equal(isReservedLeagueSlug("tvt-fpl"), false);
});
