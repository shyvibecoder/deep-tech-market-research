import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { returns, alignByDate, ols, factorAttribution, benchmarkRelative, alphaEdgeLabel } from "../scripts/lib/factor.mjs";

describe("factor: returns", () => {
  it("computes daily simple returns, skipping bad points", () => {
    const r = returns([100, 110, 99]);
    assert.equal(r.length, 2);
    assert.ok(Math.abs(r[0] - 0.1) < 1e-9 && Math.abs(r[1] - (-0.1)) < 1e-9);
    assert.deepEqual(returns([100]), []);
  });
});

describe("factor: alignByDate", () => {
  it("intersects dates and aligns columns in date order", () => {
    const { dates, cols } = alignByDate({
      A: { dates: ["d1", "d2", "d3"], values: [1, 2, 3] },
      B: { dates: ["d2", "d3", "d4"], values: [20, 30, 40] },
    });
    assert.deepEqual(dates, ["d2", "d3"]);
    assert.deepEqual(cols.A, [2, 3]);
    assert.deepEqual(cols.B, [20, 30]);
  });
});

describe("factor: OLS recovers known coefficients", () => {
  it("fits y = 2 + 3*x exactly (zero noise)", () => {
    const x = Array.from({ length: 40 }, (_, i) => i / 10);
    const y = x.map((v) => 2 + 3 * v);
    const fit = ols(y, [x]);
    assert.ok(Math.abs(fit.coef[0] - 2) < 1e-9, "intercept");
    assert.ok(Math.abs(fit.coef[1] - 3) < 1e-9, "slope");
    assert.ok(fit.r2 > 0.999, "R² ~ 1");
  });
  it("returns null when singular (two identical factors) or under-determined", () => {
    const x = Array.from({ length: 30 }, (_, i) => i);
    assert.equal(ols(x.map((v) => v + 1), [x, x]), null); // collinear → singular
    assert.equal(ols([1, 2, 3], [[1, 2, 3]]), null);      // too few points
  });
});

describe("factor: attribution verdict (the honesty gate's teeth)", () => {
  // Build a market factor + a theme factor; an asset that is PURE beta (no intercept) must read "factor/beta".
  const n = 252;
  const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  const mkt = Array.from({ length: n }, rng(1)).map((v) => v * 0.02);
  const theme = Array.from({ length: n }, rng(2)).map((v) => v * 0.02);

  it("a pure-beta book (return = 0.5*mkt + 1.2*theme + noise) shows NO significant alpha", () => {
    const noise = Array.from({ length: n }, rng(3)).map((v) => v * 0.002);
    const asset = mkt.map((m, i) => 0.5 * m + 1.2 * theme[i] + noise[i]);
    const a = factorAttribution(asset, { MKT: mkt, THEME: theme });
    assert.equal(a.verdict, "factor/beta");
    assert.ok(Math.abs(a.alpha_t) < 2, `|t|=${a.alpha_t} should be < 2`);
    assert.ok(Math.abs(a.betas.THEME - 1.2) < 0.1 && Math.abs(a.betas.MKT - 0.5) < 0.1, "recovers betas");
  });

  it("a book with a real constant edge (same betas + daily drift) reads 'alpha' with t≥2", () => {
    const noise = Array.from({ length: n }, rng(4)).map((v) => v * 0.001);
    const drift = 0.0008; // ~20%/yr persistent edge on top of the factor exposure
    const asset = mkt.map((m, i) => drift + 0.5 * m + 1.2 * theme[i] + noise[i]);
    const a = factorAttribution(asset, { MKT: mkt, THEME: theme });
    assert.equal(a.verdict, "alpha");
    assert.ok(a.alpha_t >= 2, `t=${a.alpha_t} should be ≥ 2`);
    assert.ok(a.alpha_annual > 0.1, `annual alpha ${a.alpha_annual}`);
  });

  it("a book that's worse than its factors reads negative alpha (not 'alpha')", () => {
    const noise = Array.from({ length: n }, rng(5)).map((v) => v * 0.001);
    const asset = mkt.map((m, i) => -0.0008 + 0.5 * m + 1.2 * theme[i] + noise[i]);
    const a = factorAttribution(asset, { MKT: mkt, THEME: theme });
    assert.notEqual(a.verdict, "alpha");
    assert.ok(a.alpha_annual < 0);
  });
});

describe("factor: alphaEdgeLabel (auto-relabel the scorecard from the attribution verdict)", () => {
  it("stamps 'factor/beta' on the alpha edge when attribution finds no significant alpha", () => {
    const l = alphaEdgeLabel({ verdict: "factor/beta", alpha_t: 0.4 }, { underperform: { n: 3, hits: 2 }, outperform: { n: 1, hits: 1 } });
    assert.equal(l.verdict, "factor/beta");
    assert.equal(l.basis, "factor-adjusted");
    assert.equal(l.resolved, 4);
    assert.match(l.note, /NOT alpha/);
  });
  it("stamps 'alpha' only when attribution confirms a significant positive residual", () => {
    const l = alphaEdgeLabel({ verdict: "alpha", alpha_t: 2.6 }, {});
    assert.equal(l.verdict, "alpha");
    assert.match(l.note, /genuine edge/);
  });
  it("a strong forward hit-rate alone does NOT earn 'alpha' without attribution (no skill masquerade)", () => {
    const l = alphaEdgeLabel(null, { underperform: { n: 10, hits: 9 }, outperform: { n: 10, hits: 8 } });
    assert.equal(l.verdict, "unproven");
    assert.equal(l.basis, "forward-only");
    assert.equal(l.resolved, 20);
  });
  it("reports 'building' when there's neither attribution nor resolved calls", () => {
    const l = alphaEdgeLabel(null, {});
    assert.equal(l.verdict, "unproven");
    assert.equal(l.basis, "building");
  });
});

describe("factor: benchmarkRelative", () => {
  it("computes excess vs an external benchmark", () => {
    const r = benchmarkRelative([100, 150], [100, 120]); // +50% vs +20%
    assert.equal(r.asset_return, 0.5); assert.equal(r.benchmark_return, 0.2);
    assert.ok(Math.abs(r.excess - 0.3) < 1e-9);
  });
  it("null when a series is too short", () => assert.equal(benchmarkRelative([100], [100, 120]), null));
});
