import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroStress } from "../scripts/lib/macro.mjs";

// EXACT V2.3 composite-stress overlay (§23.D), exit-only + AND-gated:
//   VTS — VIX/VIX3M ≥ 1.0 for 3 consecutive days
//   HV  — 20-day −log(HYG) velocity in the top 5% of its trailing 252-day distribution
// Built from deep closes series (not spot prices), reusing v23.mjs's leg functions.

// VIX/VIX3M closes whose LAST 3 ratios are all `ratio` (backwardation when ≥ 1.0).
const vixPair = (ratio, n = 10) => ({
  vixCloses: Array.from({ length: n }, () => 20 * ratio),
  vix3mCloses: Array.from({ length: n }, () => 20),
});
// A genuine 1-day inversion: last bar inverted, the two before it in contango.
const vixSpike = () => ({ vixCloses: [16, 16, 16, 16, 30], vix3mCloses: [20, 20, 20, 20, 26] });

// HYG closes (length ≥ 273 so the HV leg is computable). An engineered EARLIER ~5% dip seeds a
// positive tail in the trailing 20-day-velocity distribution; the series then sits flat, so on a
// CALM run the recent velocity is ≈ 0 (mid-distribution, NOT top-5%). A `drop` adds a sharp final
// 20-day decline whose velocity exceeds that tail → lands in the top 5% (stressed).
function hyg({ drop = 0 } = {}) {
  const N = 290, c = new Array(N).fill(100);
  for (let i = 120; i < 130; i++) c[i] = 100 * (1 - 0.05 * (i - 119) / 10); // ~5% dip over 10 days
  for (let i = 130; i < N; i++) c[i] = c[129];                              // flat lower plateau thereafter
  if (drop > 0) { const base = c[N - 21]; for (let i = N - 20; i < N; i++) c[i] = base * (1 - drop * (i - (N - 21)) / 20); }
  return c;
}

describe("macro: EXACT V2.3 composite-stress, AND-gated", () => {
  it("stressed only when BOTH legs fire (VTS backwardation AND HV top-5%)", () => {
    const m = macroStress({ ...vixPair(1.15), hygCloses: hyg({ drop: 0.08 }) });
    assert.equal(m.stressed, true);
    assert.equal(m.term_inverted, true);
    assert.equal(m.hy_stressed, true);
    assert.equal(m.reasons.length, 2);
  });
  it("NOT stressed when only the VIX term-structure is inverted (HV calm)", () => {
    assert.equal(macroStress({ ...vixPair(1.15), hygCloses: hyg({ drop: 0 }) }).stressed, false);
  });
  it("NOT stressed when only HY credit velocity is elevated (VIX in contango)", () => {
    assert.equal(macroStress({ ...vixPair(0.8), hygCloses: hyg({ drop: 0.08 }) }).stressed, false);
  });
  it("NOT stressed in calm markets (contango + steady credit)", () => {
    assert.equal(macroStress({ ...vixPair(0.8), hygCloses: hyg({ drop: 0 }) }).stressed, false);
  });
  it("a lone 1-day VIX inversion does NOT fire the VTS leg (needs 3 consecutive days)", () => {
    const m = macroStress({ ...vixSpike(), hygCloses: hyg({ drop: 0.08 }) });
    assert.equal(m.term_inverted, false);
    assert.equal(m.stressed, false);
  });
});

// Staleness guard: any uncomputable leg ⇒ SUPPRESSED (available:false), never a silent "calm".
describe("macro: suppress on any missing/short input", () => {
  it("available:true only when both legs are computable", () => {
    assert.equal(macroStress({ ...vixPair(1.15), hygCloses: hyg({ drop: 0.08 }) }).available, true);
  });
  it("available:false + suppressed when an input is missing or too short", () => {
    const cases = [
      {},                                                            // nothing
      { ...vixPair(1.15) },                                          // no HYG
      { hygCloses: hyg({ drop: 0.08 }) },                           // no VIX/VIX3M
      { ...vixPair(1.15), hygCloses: hyg().slice(0, 100) },         // HYG too short (<273 bars)
    ];
    for (const args of cases) {
      const m = macroStress(args);
      assert.equal(m.available, false, `should be unavailable: ${Object.keys(args)}`);
      assert.equal(m.suppressed, true);
      assert.equal(m.stressed, false);
      assert.ok(m.missing.length > 0);
    }
  });
  it("treats a non-positive VIX3M bar in the window as missing (no bogus ratio)", () => {
    const p = vixPair(1.15); p.vix3mCloses[p.vix3mCloses.length - 1] = 0;
    assert.equal(macroStress({ ...p, hygCloses: hyg({ drop: 0.08 }) }).available, false);
  });
});

// Regression: the HV percentile must NOT fire on a degenerate/calm credit tape, and the VTS leg must
// not compare mismatched-length (unaligned) VIX/VIX3M series.
describe("macro: HV false-positive + VTS alignment fixes", () => {
  it("a DEAD-FLAT HYG tape is NOT elevated (no >= tie at threshold 0)", () => {
    const flat = new Array(300).fill(100);
    const m = macroStress({ ...vixPair(1.15), hygCloses: flat });
    assert.equal(m.available, true);   // both legs computable
    assert.equal(m.hy_stressed, false); // credit not widening → not elevated
    assert.equal(m.stressed, false);
  });
  it("a credit-RALLY-then-flat tape is NOT elevated (all-negative distribution, flat today)", () => {
    const c = []; for (let i = 0; i < 300; i++) c.push(i < 60 ? 95 : 100); // rallied early, flat since
    assert.equal(macroStress({ ...vixPair(1.15), hygCloses: c }).hy_stressed, false);
  });
  it("a REAL 20-day widening still fires the HV leg", () => {
    assert.equal(macroStress({ ...vixPair(1.15), hygCloses: hyg({ drop: 0.08 }) }).hy_stressed, true);
  });
  it("mismatched-length VIX vs VIX3M is SUPPRESSED, not compared on stale bars", () => {
    const m = macroStress({ vixCloses: [1.1, 1.1, 1.1, 1.1, 9.9], vix3mCloses: [1, 1, 1, 1], hygCloses: hyg({ drop: 0.08 }) });
    assert.equal(m.term_inverted, null);
    assert.equal(m.available, false);
    assert.equal(m.stressed, false);
  });
});
