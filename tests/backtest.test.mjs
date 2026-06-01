import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backtestRegime } from "../scripts/lib/backtest.mjs";

// Build a series: smooth uptrend, then a sharp crash. A trend brake (exit below the
// moving average) should avoid most of the crash → smaller max drawdown.
function upThenCrash() {
  const v = [];
  for (let i = 0; i < 50; i++) v.push(100 * (1 + 0.005 * i)); // ~100 → 124.5
  const top = v[v.length - 1];
  for (let i = 1; i <= 21; i++) v.push(top * (1 - 0.03 * i)); // crash ~ -60%
  return v;
}

describe("backtest: trend brake reduces drawdown (evidence for the dial)", () => {
  const r = backtestRegime(upThenCrash(), { maPeriod: 20, periodsPerYear: 252 });
  it("returns braked vs unbraked metrics", () => {
    assert.ok(r && r.braked && r.unbraked);
  });
  it("braked max drawdown is smaller than buy-and-hold", () => {
    assert.ok(r.braked.max_drawdown < r.unbraked.max_drawdown, `${r.braked.max_drawdown} < ${r.unbraked.max_drawdown}`);
    assert.ok(r.dd_reduction > 0);
  });
  it("switches to cash at least once and reports time-in-market", () => {
    assert.ok(r.whipsaws >= 1);
    assert.ok(r.time_in_market > 0 && r.time_in_market <= 1);
  });
  it("returns null for too-short series", () => {
    assert.equal(backtestRegime([1, 2, 3], { maPeriod: 20 }), null);
  });
});

// Helm #5: NO LOOK-AHEAD regression. Each position is decided on the PRIOR close (ma[i-1], values[i-1]).
// Changing ONLY the final bar's value must not change any position decision (only that bar's return) →
// time_in_market + whipsaws are invariant. A look-ahead bug (deciding on values[i]) would break this.
describe("backtest: no look-ahead (positions use only prior bars, Helm #5)", () => {
  const base = Array.from({ length: 12 }, (_, i) => 100 + Math.sin(i) * 5 + i);
  it("changing only the final bar leaves all position decisions unchanged", () => {
    const r1 = backtestRegime(base, { maPeriod: 3 });
    const r2 = backtestRegime([...base.slice(0, -1), base[base.length - 1] * 1.5], { maPeriod: 3 });
    assert.ok(r1 && r2);
    assert.equal(r1.time_in_market, r2.time_in_market);
    assert.equal(r1.whipsaws, r2.whipsaws);
    assert.equal(r1.n, r2.n);
  });
});
