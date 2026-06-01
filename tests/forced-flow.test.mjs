import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dislocation, taxLossWindow, forcedFlowSignal, reconcileWithTiming } from "../scripts/lib/forced-flow.mjs";

// ALPHA.md Edge 3: the footprint of forced/neglect selling is MECHANICAL de-rating (off highs +
// below trend + negative short momentum). The discipline is separating that from a broken thesis.
describe("forced-flow: dislocation magnitude from the tape", () => {
  it("rises with drawdown depth, below-trend, and negative short momentum", () => {
    const mild = dislocation({ pct_off_high: -0.05, above_ma200: true, mom_1m: 0.01 });
    const deep = dislocation({ pct_off_high: -0.35, above_ma200: false, mom_1m: -0.15 });
    assert.ok(deep > mild); assert.ok(deep >= 0.7 && deep <= 1);
  });
  it("is null on missing/errored quotes", () => {
    assert.equal(dislocation({ error: "x" }), null);
    assert.equal(dislocation({}), null);
  });
});

describe("forced-flow: tax-loss-selling seasonal window", () => {
  it("flags Nov–Dec selling pressure and the January rebound", () => {
    assert.equal(taxLossWindow("2026-11-15"), "selling");
    assert.equal(taxLossWindow("2026-12-20"), "selling");
    assert.equal(taxLossWindow("2027-01-10"), "rebound");
    assert.equal(taxLossWindow("2026-06-01"), null);
  });
});

describe("forced-flow: thesis-intact dislocation vs broken thesis", () => {
  const quotes = { A: { pct_off_high: -0.4, above_ma200: false, mom_1m: -0.2 }, B: { pct_off_high: -0.4, above_ma200: false, mom_1m: -0.2 } };
  it("dislocated + HIGH opportunity → accumulate (buy what others must sell)", () => {
    const s = forcedFlowSignal({ quotes, tickers: ["A", "B"], opportunity: 80, today: "2026-11-20" });
    assert.equal(s.flag, "accumulate"); assert.equal(s.intact, true); assert.equal(s.window, "selling");
    assert.ok(s.dislocation >= 0.7);
  });
  it("dislocated + LOW opportunity → broken (not forced flow — real deterioration, avoid)", () => {
    const s = forcedFlowSignal({ quotes, tickers: ["A", "B"], opportunity: 20, today: "2026-06-01" });
    assert.equal(s.flag, "broken"); assert.equal(s.intact, false);
  });
  it("no meaningful dislocation → none", () => {
    const calm = { A: { pct_off_high: -0.02, above_ma200: true, mom_1m: 0.03 } };
    assert.equal(forcedFlowSignal({ quotes: calm, tickers: ["A"], opportunity: 80, today: "2026-06-01" }).flag, "none");
  });
  it("is safe when no quotes resolve", () => {
    assert.equal(forcedFlowSignal({ quotes: {}, tickers: ["Z"], opportunity: 80, today: "2026-06-01" }).flag, "none");
  });
});

// The v2.3-overlay concern: forced-flow (selection) must COMPOSE with the timing/regime overlay
// (pace), never contradict it. Scenario matrix — same "accumulate", different regimes.
describe("forced-flow × timing overlay: compose, don't contradict", () => {
  const acc = { flag: "accumulate", dislocation: 0.8, intact: true, window: "selling" };
  it("CRASH (macro-stress / defensive): accumulate becomes deploy-ON-TRIGGER, never 'buy now'", () => {
    for (const regime of [{ posture: "defensive" }, { posture: "caution" }, { posture: "risk-on", macro_stressed: true }]) {
      const out = reconcileWithTiming(acc, regime);
      assert.equal(out.subordinate_to_timing, true, JSON.stringify(regime));
      assert.match(out.guidance, /trigger/i);
      assert.match(out.guidance, /don't buy now/i); // explicitly NOT a buy-now instruction
    }
  });
  it("RISK-ON (no brakes): accumulate is actionable now", () => {
    const out = reconcileWithTiming(acc, { posture: "risk-on" });
    assert.equal(out.subordinate_to_timing, false);
    assert.match(out.guidance, /timing permits/i);
  });
  it("only touches accumulate signals (broken/none pass through untouched)", () => {
    const broken = { flag: "broken", dislocation: 0.8 };
    assert.deepEqual(reconcileWithTiming(broken, { posture: "defensive" }), broken);
    assert.equal(reconcileWithTiming(null, {}), null);
  });
});

// Audit P8: "accumulate"/"broken" must not fire off a SINGLE dislocated name (the others erroring out).
// A forced-flow read needs corroboration across the basket — require >=2 contributing tickers.
describe("forced-flow: requires >=2 contributing tickers (P8)", () => {
  const q = (off, vs200, mom) => ({ price: 10, pct_off_high: off, pct_vs_ma200: vs200, mom_1m: mom });
  it("does NOT flag accumulate when only ONE ticker has data", () => {
    // A=deeply dislocated, B/C error out → only 1 contributing → no flag despite high opportunity.
    const r = forcedFlowSignal({ quotes: { A: q(-0.5, -0.3, -0.1), B: { error: "x" }, C: { error: "x" } }, tickers: ["A", "B", "C"], opportunity: 70, today: "2026-06-01" });
    assert.equal(r.flag, "none");
  });
  it("DOES flag when >=2 tickers corroborate the dislocation", () => {
    const r = forcedFlowSignal({ quotes: { A: q(-0.5, -0.3, -0.1), B: q(-0.55, -0.35, -0.12) }, tickers: ["A", "B"], opportunity: 70, today: "2026-06-01" });
    assert.equal(r.flag, "accumulate");
  });
});
