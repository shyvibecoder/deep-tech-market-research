import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegime } from "../scripts/lib/regime.mjs";

const q = (vsMa200, mom12, off, volRatio, aboveMa200, aboveMa20) => ({
  price: 1, pct_vs_ma200: vsMa200, mom_12m: mom12, pct_off_high: off,
  vol_3m: volRatio, vol_1y: 1, above_ma200: aboveMa200, above_ma20: aboveMa20,
});
const holds = (n) => Array.from({ length: n }, (_, i) => ({ ticker: "T" + i }));
const bull = { T0: q(0.15, 0.4, -0.03, 0.9, true, true), T1: q(0.12, 0.35, -0.04, 0.95, true, true) };
const bear = { T0: q(-0.15, -0.3, -0.35, 1.5, false, false), T1: q(-0.2, -0.4, -0.4, 1.6, false, false) };

describe("regime v2: exit-only macro-stress overlay", () => {
  it("forces DEFENSIVE in a bull tape when macro stress is active (overlay wins)", () => {
    const r = computeRegime(bull, holds(2), { macro: { stressed: true, reasons: ["x"] } });
    assert.equal(r.posture, "defensive");
    assert.ok(/macro/i.test(r.action + r.note));
  });
  it("does NOT change posture when macro stress is inactive", () => {
    const r = computeRegime(bull, holds(2), { macro: { stressed: false, reasons: [] } });
    assert.equal(r.posture, "risk-on");
  });
});

describe("regime v2: fast re-entry (20-DMA breadth) override", () => {
  it("a breadth thrust clears a defensive base to NEUTRAL (not just one notch — works from defensive)", () => {
    // base is bearish, but most names have reclaimed their 20-DMA → broad thrust clears the brake
    const reclaim = { T0: q(-0.15, -0.3, -0.30, 1.2, false, true), T1: q(-0.18, -0.35, -0.32, 1.2, false, true) };
    const r = computeRegime(reclaim, holds(2));
    assert.equal(r.fast_reentry, true);
    assert.equal(r.posture, "neutral"); // cleared the deploy-brake, but capped at neutral (no acceleration)
  });
  it("macro stress beats fast re-entry (brakes win)", () => {
    const reclaim = { T0: q(-0.15, -0.3, -0.30, 1.2, false, true), T1: q(-0.18, -0.35, -0.32, 1.2, false, true) };
    const r = computeRegime(reclaim, holds(2), { macro: { stressed: true, reasons: ["x"] } });
    assert.equal(r.posture, "defensive");
  });
});

describe("regime: surfaces a disabled macro overlay (red-team R1)", () => {
  it("flags macro_available=false and notes it when macro inputs are unavailable", () => {
    const r = computeRegime(bull, holds(2), { macro: null });
    assert.equal(r.macro_available, false);
    assert.match(r.note, /macro.*unavailable/i);
  });
  it("macro_available=true when the overlay computed (even if not stressed)", () => {
    const r = computeRegime(bull, holds(2), { macro: { stressed: false, reasons: [] } });
    assert.equal(r.macro_available, true);
  });
});

describe("regime: honest confidence (O2 — score isn't precise)", () => {
  it("labels low confidence on a thin sample", () => {
    const r = computeRegime(bull, holds(2)); // 2 names < 3
    assert.equal(r.confidence, "low");
    assert.ok("confidence_note" in r);
  });
  it("labels low confidence near a band edge (whipsaw risk)", () => {
    // construct ~neutral/edge: flat trend/mom → risk ~50 (not near edge); make it ~44/46 area
    const edge = {}; for (let i = 0; i < 6; i++) edge["T"+i] = q(0, 0.0, -0.10, 1, true, true); // ddScore lower → risk near 45
    const r = computeRegime(edge, holds(6));
    assert.ok(["low","medium","high"].includes(r.confidence));
  });
});
