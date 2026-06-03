import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegime } from "../scripts/lib/regime.mjs";

const q = (vsMa200, mom12, off, volRatio, aboveMa200, aboveMa20) => ({
  price: 1, pct_vs_ma200: vsMa200, mom_12m: mom12, pct_off_high: off,
  vol_3m: volRatio, vol_1y: 1, above_ma200: aboveMa200, above_ma20: aboveMa20,
});
const holds = (n) => Array.from({ length: n }, (_, i) => ({ ticker: "T" + i }));
const bull = { T0: q(0.15, 0.4, -0.03, 0.9, true, true), T1: q(0.12, 0.35, -0.04, 0.95, true, true) };

// Composite price series driving the F+C Thrust ladder:
const trendUp = () => { const a = []; let p = 100; for (let i = 0; i < 260; i++) { p *= 1.002; a.push(p); } return a; };       // TREND → risk-on
const thrustSeries = () => { const a = []; let p = 200; for (let i = 0; i < 220; i++) { p *= 0.992; a.push(p); } for (let i = 0; i < 25; i++) { p *= 1.01; a.push(p); } return a; }; // THRUST → neutral re-entry

describe("regime v2: exit-only composite-stress overlay", () => {
  it("forces DEFENSIVE in a TREND tape when macro stress is active (overlay wins)", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: trendUp(), macro: { stressed: true, reasons: ["x"] } });
    assert.equal(r.posture, "defensive");
    assert.ok(/composite-stress|macro/i.test(r.action));
  });
  it("does NOT change posture when macro stress is inactive (TREND → risk-on)", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: trendUp(), macro: { stressed: false, reasons: [] } });
    assert.equal(r.posture, "risk-on");
  });
});

describe("regime v2: THRUST fast re-entry (the canonical Faber-thrust leg)", () => {
  it("a THRUST (rising 20-DMA reclaimed below the 200-DMA) sets NEUTRAL + fast_reentry", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: thrustSeries() });
    assert.equal(r.posture, "neutral");
    assert.equal(r.fast_reentry, true);
    assert.equal(r.fc_thrust.thrust, true);
    assert.equal(r.fc_thrust.trend, false);
  });
  it("the composite-stress overlay beats the thrust re-entry (exit-only always wins)", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: thrustSeries(), macro: { stressed: true, reasons: ["x"] } });
    assert.equal(r.posture, "defensive");
    assert.equal(r.fast_reentry, false);
  });
});

describe("regime: surfaces a disabled macro overlay (red-team R1)", () => {
  it("flags macro_available=false and notes it when macro inputs are unavailable", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: trendUp(), macro: null });
    assert.equal(r.macro_available, false);
    assert.match(r.note, /macro.*unavailable/i);
  });
  it("macro_available=true when the overlay computed (even if not stressed)", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: trendUp(), macro: { stressed: false, reasons: [] } });
    assert.equal(r.macro_available, true);
  });
});

describe("regime: confidence reflects sample size", () => {
  it("low confidence on a thin sample", () => {
    const r = computeRegime(bull, holds(2), { compositeCloses: trendUp() }); // 2 names < 3
    assert.equal(r.confidence, "low");
  });
  it("high confidence with a deep cross-section", () => {
    const many = {}; for (let i = 0; i < 8; i++) many["T" + i] = q(0.1, 0.2, -0.05, 1, true, true);
    const r = computeRegime(many, holds(8), { compositeCloses: trendUp() });
    assert.equal(r.confidence, "high");
  });
});
