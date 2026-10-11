/**
 * Database target guard (src/lib/db/target-guard.ts).
 *
 * This repo carries schema changes production must not receive, so the app, drizzle-kit and the
 * 0025 apply script all refuse every database except a local file: one or the jpl-india
 * Turso database. These tests pin that production's `jpl-leagues` — and look-alikes — are refused.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_TURSO_DB, assertSafeDbTarget } from "../../src/lib/db/target-guard";

test("allows local file: databases", () => {
  assert.doesNotThrow(() => assertSafeDbTarget("file:./test.db"));
  assert.doesNotThrow(() => assertSafeDbTarget("file:./dev.db"));
});

test("allows this repo's own Turso database, libsql or https, any region", () => {
  assert.equal(ALLOWED_TURSO_DB, "jpl-india");
  assert.doesNotThrow(() => assertSafeDbTarget("libsql://jpl-india-jpltvt2023.aws-ap-south-1.turso.io"));
  assert.doesNotThrow(() => assertSafeDbTarget("https://jpl-india-jpltvt2023.turso.io"));
});

test("refuses production's jpl-leagues database", () => {
  assert.throws(() => assertSafeDbTarget("libsql://jpl-leagues-jpltvt2023.aws-ap-south-1.turso.io"), /Refusing/);
  assert.throws(() => assertSafeDbTarget("https://jpl-leagues-jpltvt2023.turso.io"), /Refusing/);
});

test("refuses other databases, including staging and look-alikes", () => {
  assert.throws(() => assertSafeDbTarget("libsql://jpl-leagues-staging-jpltvt2023.turso.io"), /Refusing/);
  assert.throws(() => assertSafeDbTarget("libsql://jpl-indiax.turso.io"), /Refusing/);
  assert.throws(() => assertSafeDbTarget("libsql://evil.example.com/jpl-india-x"), /Refusing/);
});

test("refuses empty and unparseable URLs", () => {
  assert.throws(() => assertSafeDbTarget(""), /Refusing/);
  assert.throws(() => assertSafeDbTarget("not a url"), /Refusing/);
});
