import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maxDrawdown, cagr, downsideDeviation, sortino, calmar, portfolioMetrics } from "../scripts/lib/metrics.mjs";

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≈ ${b}`);

describe("metrics: max drawdown (the <35% constraint)", () => {
  it("finds the worst peak-to-trough", () => near(maxDrawdown([100, 120, 90, 150, 75]), 0.5));
  it("is 0 for a monotonic rise", () => near(maxDrawdown([1, 2, 3, 4]), 0));
  it("handles a single/empty series", () => { near(maxDrawdown([100]), 0); near(maxDrawdown([]), 0); });
});

describe("metrics: CAGR", () => {
  it("doubles over 1 year → 100%", () => near(cagr([100, 200], 1), 1, 1e-9));
  it("flat → 0%", () => near(cagr([100, 100], 252), 0));
});

describe("metrics: downside deviation & Sortino", () => {
  it("downside deviation uses min(0,r) over all periods", () => {
    // returns [0.01,-0.02,0.03,-0.04]; mean of min(0,r)^2 = (0+0.0004+0+0.0016)/4 = 0.0005
    near(downsideDeviation([0.01, -0.02, 0.03, -0.04], 1, 0), Math.sqrt(0.0005), 1e-9);
  });
  it("Sortino is null when there is no downside", () => assert.equal(sortino([0.01, 0.02, 0.03], 1, 0), null));
  it("Sortino is finite and positive for a net-positive series with some downside", () => {
    const s = sortino([0.02, -0.01, 0.03, -0.01], 252, 0);
    assert.ok(Number.isFinite(s) && s > 0);
  });
});

describe("metrics: Calmar + combined", () => {
  it("Calmar = CAGR / maxDD", () => {
    const v = [100, 200, 100, 220]; // ends 2.2x; maxDD 50%
    near(calmar(v, 1), cagr(v, 1) / maxDrawdown(v), 1e-9);
  });
  it("portfolioMetrics returns the objective tuple, with breaches35 flag", () => {
    const m = portfolioMetrics([100, 120, 60, 150], { periodsPerYear: 252 }); // 50% DD
    assert.ok("cagr" in m && "max_drawdown" in m && "calmar" in m && "sortino" in m && "sharpe" in m);
    assert.equal(m.breaches_35, true);
  });
});

import { basketIndex } from "../scripts/lib/metrics.mjs";
describe("metrics: basket index", () => {
  it("builds a weight-normalized index on common dates", () => {
    const s = {
      A: { dates: ["d1", "d2", "d3"], closes: [10, 11, 12] },
      B: { dates: ["d1", "d2", "d3"], closes: [100, 90, 99] },
    };
    const idx = basketIndex(s, { A: 1, B: 1 });
    assert.deepEqual(idx.values.map((v) => +v.toFixed(2)), [100, 100, 109.5]);
  });
  it("returns empty when there's no common history", () => {
    assert.deepEqual(basketIndex({ A: { dates: ["d1"], closes: [1] } }, { A: 1 }).values, []);
  });
});
