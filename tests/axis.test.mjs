import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { basketReturns, axisCorrelation, basketStats } from "../scripts/lib/axis.mjs";

const DATES = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10));

// Build a complex factor and three candidate baskets: one that tracks the complex (high corr), one
// independent (low corr), one independent + low amplitude (low beta). Verify the gate's verdicts.
function world() {
  const n = 300, dates = DATES(n), s = {};
  const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  const fComplex = Array.from({ length: n }, rng(1)).map((v) => v * 0.02);
  const fOther = Array.from({ length: n }, rng(2)).map((v) => v * 0.02);
  const px = (rets) => { const p = [100]; for (const r of rets) p.push(p[p.length - 1] * (1 + r)); return p; };
  // complex members ~ fComplex; tracker ~ fComplex; independent ~ fOther; defensive ~ 0.2*fOther
  s.CX1 = { dates, closes: px(fComplex.map((r, i) => r + 0.001 * (rng(3)() ))) };
  s.CX2 = { dates, closes: px(fComplex.map((r) => r * 1.1)) };
  s.TRK = { dates, closes: px(fComplex.map((r) => 1.0 * r)) };            // tracks the complex
  s.IND = { dates, closes: px(fOther.map((r) => 1.0 * r)) };             // independent driver
  s.DEF = { dates, closes: px(fOther.map((r) => 0.2 * r)) };             // independent + low beta
  return s;
}

describe("axis: basketReturns", () => {
  it("equal-weights member daily returns over common dates", () => {
    const dates = DATES(40);
    const aCloses = [100, 110, ...Array(38).fill(110)]; // +10% on day 1, flat after
    const bCloses = Array(40).fill(100);                 // flat
    const s = { A: { dates, closes: aCloses }, B: { dates, closes: bCloses } };
    const { rets } = basketReturns(s, ["A", "B"]);
    assert.equal(rets.length, 39);
    assert.ok(Math.abs(rets[0] - 0.05) < 1e-9); // (+10% + 0%)/2
    assert.ok(Math.abs(rets[1]) < 1e-9);        // both flat after
  });
});

describe("axis: basketStats (returns + risk + explicit window)", () => {
  it("reports CAGR, maxDD and the window for a steadily-growing basket", () => {
    const dates = DATES(253);
    const grow = [100]; for (let i = 1; i < 253; i++) grow.push(grow[i - 1] * Math.pow(2, 1 / 252)); // doubles in 1yr
    const s = { A: { dates, closes: grow } };
    const r = basketStats(s, ["A"]);
    assert.ok(r && r.years >= 0.9 && r.years <= 1.1, `years ${r?.years}`);
    assert.ok(Math.abs(r.cagr - 1.0) < 0.05, `cagr ${r.cagr} ~ 100%`);
    assert.ok(r.maxDD <= 0.001, `monotone series has ~no drawdown, got ${r.maxDD}`);
    assert.equal(r.start, dates[0]);
  });
  it("returns null on thin history", () => {
    const dates = DATES(20);
    assert.equal(basketStats({ A: { dates, closes: dates.map(() => 100) } }, ["A"]), null);
  });
});

describe("axis: correlation gate (the G2 / scout-gate verdict)", () => {
  const s = world();
  it("REJECTS a basket that tracks the AI-capex complex (high corr → not breadth)", () => {
    const r = axisCorrelation(s, ["TRK"], ["CX1", "CX2"], { corrMax: 0.5, betaMax: 0.7 });
    assert.ok(r && Math.abs(r.corr) > 0.7, `corr ${r.corr} should be high`);
    assert.equal(r.qualifies, false);
    assert.ok(/REJECT/.test(r.note));
  });
  it("QUALIFIES an independently-driven basket (low corr → real breadth)", () => {
    const r = axisCorrelation(s, ["IND"], ["CX1", "CX2"], { corrMax: 0.5, betaMax: 0.7 });
    assert.ok(Math.abs(r.corr) < 0.5, `corr ${r.corr} should be low`);
    assert.equal(r.qualifies, true);
  });
  it("QUALIFIES a defensive low-beta independent basket (best objective fit)", () => {
    const r = axisCorrelation(s, ["DEF"], ["CX1", "CX2"], { corrMax: 0.5, betaMax: 0.7 });
    assert.ok(Math.abs(r.beta) < 0.7 && r.qualifies);
  });
  it("returns null on thin overlap", () => {
    const dates = DATES(20);
    assert.equal(axisCorrelation({ A: { dates, closes: dates.map(() => 100) }, B: { dates, closes: dates.map(() => 100) } }, ["A"], ["B"]), null);
  });
});
