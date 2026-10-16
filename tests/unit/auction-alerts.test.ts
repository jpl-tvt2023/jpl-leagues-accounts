/**
 * Auction-room alerts (FPL and cricket): when "your turn" and "outbid" fire, what the tab title
 * says, and when an alert stops applying.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { alertStillApplies, alertTitle, detectAlerts, titleFrame, type AlertSignal } from "../../src/lib/auction/alerts";

const sig = (s: Partial<AlertSignal>): AlertSignal => ({ myTurn: false, lotKey: null, leaderIsMe: false, ...s });

test("alerts: opening the room never alerts, whatever it shows", () => {
  assert.deepEqual(detectAlerts(null, sig({ myTurn: true })), []);
  assert.deepEqual(detectAlerts(null, sig({ lotKey: "L1", leaderIsMe: false })), []);
});

test("alerts: your turn fires once, when it becomes yours", () => {
  assert.deepEqual(detectAlerts(sig({ myTurn: false }), sig({ myTurn: true })), ["turn"]);
  assert.deepEqual(detectAlerts(sig({ myTurn: true }), sig({ myTurn: true })), []);
  assert.deepEqual(detectAlerts(sig({ myTurn: true }), sig({ myTurn: false })), []);
});

test("alerts: outbid fires when you led this lot and no longer do — not on a new lot", () => {
  assert.deepEqual(detectAlerts(sig({ lotKey: "L1", leaderIsMe: true }), sig({ lotKey: "L1", leaderIsMe: false })), ["outbid"]);
  // A new lot you don't lead isn't being outbid; nor is a lot you never led.
  assert.deepEqual(detectAlerts(sig({ lotKey: "L1", leaderIsMe: true }), sig({ lotKey: "L2", leaderIsMe: false })), []);
  assert.deepEqual(detectAlerts(sig({ lotKey: "L1", leaderIsMe: false }), sig({ lotKey: "L1", leaderIsMe: false })), []);
  // The lot closing (sold to you) isn't an outbid either.
  assert.deepEqual(detectAlerts(sig({ lotKey: "L1", leaderIsMe: true }), sig({ lotKey: null, leaderIsMe: false })), []);
});

test("alerts: tab titles, flashing, and when an alert stops applying", () => {
  assert.equal(alertTitle("turn"), "(!) Your turn to nominate");
  assert.equal(alertTitle("outbid", "Virat Kohli"), "(!) Outbid on Virat Kohli");
  assert.equal(alertTitle("outbid"), "(!) Outbid");
  assert.equal(titleFrame("Room", "(!) Outbid", 0), "(!) Outbid");
  assert.equal(titleFrame("Room", "(!) Outbid", 1), "Room");
  assert.equal(alertStillApplies("turn", null, sig({ myTurn: true })), true);
  assert.equal(alertStillApplies("turn", null, sig({ myTurn: false })), false);
  assert.equal(alertStillApplies("outbid", "L1", sig({ lotKey: "L1", leaderIsMe: false })), true);
  assert.equal(alertStillApplies("outbid", "L1", sig({ lotKey: "L1", leaderIsMe: true })), false); // bid back
  assert.equal(alertStillApplies("outbid", "L1", sig({ lotKey: null })), false); // lot over
});
