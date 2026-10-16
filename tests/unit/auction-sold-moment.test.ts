/**
 * Matching a sale to the room's post-sale pause (the FPL room's SOLD moment).
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { belongsToPause } from "../../src/lib/auction/sold-moment";

const until = Date.UTC(2026, 9, 17, 12, 0, 10); // a 5 s pause ends here, so it began at :05

test("sold moment: a sale at the start of the pause, or a little before it (clocks, polling), belongs to it", () => {
  assert.equal(belongsToPause(Date.UTC(2026, 9, 17, 12, 0, 5), until, 5), true);
  assert.equal(belongsToPause(Date.UTC(2026, 9, 17, 12, 0, 0), until, 5), true); // 5 s early: within the tolerance
  assert.equal(belongsToPause(until, until, 5), true);
});

test("sold moment: an older sale, or one after the pause, doesn't", () => {
  assert.equal(belongsToPause(Date.UTC(2026, 9, 17, 11, 59, 0), until, 5), false);
  assert.equal(belongsToPause(until + 1000, until, 5), false);
  assert.equal(belongsToPause(Date.UTC(2026, 9, 17, 12, 0, 0), until, 5, 1000), false); // tight tolerance
});
