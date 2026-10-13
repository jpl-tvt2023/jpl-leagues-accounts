/**
 * Cricket money formatting (formatLakhs in src/lib/format/currency.ts): amounts are stored in
 * lakhs and shown as ₹ L below a crore, ₹ Cr from one crore up.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatLakhs } from "../../src/lib/format/currency";

test("lakhs below a crore, crores from 100 lakhs, trailing zeros dropped", () => {
  assert.equal(formatLakhs(0), "₹0 L");
  assert.equal(formatLakhs(50), "₹50 L");
  assert.equal(formatLakhs(99), "₹99 L");
  assert.equal(formatLakhs(100), "₹1 Cr");
  assert.equal(formatLakhs(200), "₹2 Cr");
  assert.equal(formatLakhs(1625), "₹16.25 Cr");
  assert.equal(formatLakhs(1650), "₹16.5 Cr");
  assert.equal(formatLakhs(-30), "-₹30 L");
});
