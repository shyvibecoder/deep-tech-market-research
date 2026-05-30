import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegime } from "../scripts/lib/regime.mjs";

const q = (pct_vs_ma200, mom_12m, pct_off_high, volRatio, above_ma200) => ({
  price: 1, pct_vs_ma200, mom_12m, pct_off_high, vol_3m: volRatio, vol_1y: 1, above_ma200,
});
const holds = (n) => Array.from({ length: n }, (_, i) => ({ ticker: "T" + i }));

describe("regime: timing posture", () => {
  it("is RISK-ON in a broad uptrend with positive momentum and calm vol", () => {
    const quotes = { T0: q(0.15, 0.4, -0.03, 0.9, true), T1: q(0.1, 0.3, -0.05, 1.0, true), T2: q(0.2, 0.5, -0.02, 0.95, true) };
    const r = computeRegime(quotes, holds(3));
    assert.equal(r.posture, "risk-on");
    assert.ok(r.risk_score >= 70);
  });
  it("is DEFENSIVE in a downtrend with deep drawdown and rising vol", () => {
    const quotes = { T0: q(-0.15, -0.3, -0.35, 1.5, false), T1: q(-0.2, -0.4, -0.4, 1.6, false) };
    const r = computeRegime(quotes, holds(2));
    assert.equal(r.posture, "defensive");
    assert.ok(r.risk_score < 25);
  });
  it("returns UNKNOWN when there is no usable price history", () => {
    const quotes = { T0: { error: "no quote" } };
    assert.equal(computeRegime(quotes, holds(1)).posture, "unknown");
  });
});
