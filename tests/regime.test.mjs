import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegime } from "../scripts/lib/regime.mjs";

const q = (pct_vs_ma200, mom_12m, pct_off_high, volRatio, above_ma200) => ({
  price: 1, pct_vs_ma200, mom_12m, pct_off_high, vol_3m: volRatio, vol_1y: 1, above_ma200,
});
const holds = (n) => Array.from({ length: n }, (_, i) => ({ ticker: "T" + i }));

// Composite price series that drive the F+C Thrust ladder (the regime IS this ladder):
export const trendUp = () => { const a = []; let p = 100; for (let i = 0; i < 260; i++) { p *= 1.002; a.push(p); } return a; };       // above 200-DMA → TREND
export const crashSeries = () => { const a = []; let p = 100; for (let i = 0; i < 200; i++) { p *= 1.0005; a.push(p); } for (let i = 0; i < 60; i++) { p *= (i % 2 ? 0.94 : 1.01); a.push(p); } return a; }; // 252d ret<0 + hi vol → CRASH_OFF
export const steadyDown = () => { const a = []; let p = 200; for (let i = 0; i < 245; i++) { p *= 0.995; a.push(p); } return a; };   // below 200-DMA, falling 20-DMA → cash
export const thrustSeries = () => { const a = []; let p = 200; for (let i = 0; i < 220; i++) { p *= 0.992; a.push(p); } for (let i = 0; i < 25; i++) { p *= 1.01; a.push(p); } return a; }; // below 200-DMA but rising 20-DMA → THRUST

describe("regime: F+C Thrust timing posture", () => {
  it("is RISK-ON when the composite is in TREND (above its 200-DMA)", () => {
    const r = computeRegime({ T0: q(0.15, 0.4, -0.03, 0.9, true) }, holds(1), { compositeCloses: trendUp() });
    assert.equal(r.posture, "risk-on");
    assert.equal(r.fc_thrust.trend, true);
  });
  it("is DEFENSIVE on CRASH_OFF (252-day return negative AND 60-day vol > 25%)", () => {
    const r = computeRegime({ T0: q(-0.15, -0.3, -0.35, 1.5, false) }, holds(1), { compositeCloses: crashSeries() });
    assert.equal(r.posture, "defensive");
    assert.equal(r.fc_thrust.crash_off, true);
  });
  it("is NEUTRAL on a THRUST (rising 20-DMA reclaimed while below the 200-DMA) — the fast re-entry", () => {
    const r = computeRegime({ T0: q(-0.1, -0.2, -0.3, 1, false) }, holds(1), { compositeCloses: thrustSeries() });
    assert.equal(r.posture, "neutral");
    assert.equal(r.fast_reentry, true);
  });
  it("is DEFENSIVE below trend with no thrust and no crash (cash)", () => {
    const r = computeRegime({ T0: q(-0.1, -0.2, -0.3, 1, false) }, holds(1), { compositeCloses: steadyDown() });
    assert.equal(r.posture, "defensive");
    assert.equal(r.fast_reentry, false);
  });
  it("is UNKNOWN without a composite price series (can't run the ladder)", () => {
    assert.equal(computeRegime({ T0: q(0.1, 0.2, -0.05, 1, true) }, holds(1)).posture, "unknown");
    assert.equal(computeRegime({ T0: { error: "no quote" } }, holds(1)).posture, "unknown");
  });
});
