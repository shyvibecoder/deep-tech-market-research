import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeForecasts, resolveDue, updateScorecard, addDays, makeScarcityForecasts, meanPrice } from "../scripts/lib/forecast.mjs";

const signals = {
  regime: { per_name: [
    { ticker: "A", tilt: "overweight" }, { ticker: "B", tilt: "underweight" },
    { ticker: "C", tilt: "neutral" }, { ticker: "D", tilt: "overweight" },
  ] },
  quotes: { A: { price: 10 }, B: { price: 20 }, C: { price: 5 }, D: { error: "no quote" } },
};

describe("forecast: make dated, resolvable claims", () => {
  const f = makeForecasts(signals, "2026-01-01", 21);
  it("emits one claim per overweight/underweight with a price + resolve date", () => {
    assert.equal(f.length, 2); // C neutral skipped, D has no price
    const a = f.find((x) => x.subject === "A");
    assert.equal(a.claim, "up"); assert.equal(a.price_at, 10); assert.equal(a.resolve_on, "2026-01-22");
    assert.equal(f.find((x) => x.subject === "B").claim, "down");
  });
});

describe("forecast: resolve matured claims against realized price", () => {
  const open = [
    { id: "f1", subject: "A", claim: "up", price_at: 10, resolve_on: "2026-01-22", type: "tsmom_tilt" },
    { id: "f2", subject: "B", claim: "down", price_at: 20, resolve_on: "2026-01-22", type: "tsmom_tilt" },
    { id: "f3", subject: "A", claim: "up", price_at: 10, resolve_on: "2026-02-22", type: "tsmom_tilt" }, // not due
  ];
  const { resolved, stillOpen } = resolveDue(open, { A: { price: 12 }, B: { price: 22 } }, "2026-01-25");
  it("resolves only due claims and scores correctness", () => {
    assert.equal(resolved.length, 2);
    assert.equal(resolved.find((r) => r.id === "f1").correct, true);  // A up 20% → correct
    assert.equal(resolved.find((r) => r.id === "f2").correct, false); // B rose but claim was down → wrong
    assert.equal(stillOpen.length, 1);
  });
});

describe("forecast: scorecard accumulation", () => {
  it("tracks hit-rate by tilt", () => {
    let sc = updateScorecard(null, [{ claim: "up", correct: true }, { claim: "up", correct: false }, { claim: "down", correct: true }]);
    assert.equal(sc.total.n, 3); assert.equal(sc.total.hits, 2);
    assert.equal(sc.by_tilt.overweight.n, 2); assert.equal(sc.by_tilt.overweight.hits, 1);
    assert.equal(sc.hit_rate, +(2 / 3).toFixed(3));
  });
});

describe("forecast: addDays", () => {
  it("adds UTC days", () => assert.equal(addDays("2026-01-31", 1), "2026-02-01"));
});

// --- The proof-of-alpha layer: grade the de-rating/inflecting calls RELATIVE to the
// AI-capex complex, so the system judges its own thesis edge, not just direction. ---
describe("forecast: meanPrice", () => {
  it("averages valid prices, skipping errors/zeros, null when none", () => {
    const q = { A: { price: 10 }, B: { price: 30 }, C: { error: "x" }, D: { price: 0 } };
    assert.equal(meanPrice(q, ["A", "B", "C", "D"]), 20);
    assert.equal(meanPrice(q, ["C", "D"]), null);
    assert.equal(meanPrice(q, []), null);
  });
});

describe("forecast: scarcity relative-performance claims (alpha grading)", () => {
  const scarcities = [
    { id: "crowded", tickers: ["X1", "X2"], priced_in: "high" },
    { id: "cheap", tickers: ["Y1"], priced_in: "low" },
    { id: "quiet", tickers: ["Z1"], priced_in: "med" },
  ];
  const sig = {
    quotes: { X1: { price: 100 }, X2: { price: 100 }, Y1: { price: 50 }, Z1: { price: 10 }, E1: { price: 200 }, E2: { price: 200 } },
    scarcity_signals: { crowded: { flag: "de-rating" }, cheap: { flag: "inflecting" }, quiet: { flag: "none" } },
  };
  const fc = makeScarcityForecasts(scarcities, sig, "2026-01-01", 42, ["E1", "E2"]);

  it("emits a relative claim only for de-rating/inflecting scarcities", () => {
    assert.equal(fc.length, 2); // quiet (none) skipped
    const c = fc.find((f) => f.subject === "crowded");
    assert.equal(c.type, "scarcity_rel"); assert.equal(c.claim, "underperform");
    assert.equal(c.basket_at, 100); assert.equal(c.complex_at, 200);
    assert.deepEqual(c.complex_tickers, ["E1", "E2"]);
    assert.equal(c.resolve_on, "2026-02-12");
    assert.equal(fc.find((f) => f.subject === "cheap").claim, "outperform");
  });

  it("returns nothing when the complex has no price anchor", () => {
    assert.equal(makeScarcityForecasts(scarcities, sig, "2026-01-01", 42, ["NOPE"]).length, 0);
  });

  it("grades a high Opportunity Score even when the tape is quiet (flag=none)", () => {
    const scs = [{ id: "structural", tickers: ["S1"], priced_in: "low" }];
    const s2 = {
      quotes: { S1: { price: 40 }, E1: { price: 200 } },
      scarcity_signals: { structural: { flag: "none", score: 88 } }, // not de-rating/inflecting, but high opportunity
    };
    const fc = makeScarcityForecasts(scs, s2, "2026-01-01", 42, ["E1"]);
    assert.equal(fc.length, 1);
    assert.equal(fc[0].claim, "outperform"); assert.equal(fc[0].source, "opportunity"); assert.equal(fc[0].opportunity, 88);
    assert.ok(fc[0].id.includes(":opp:"));
  });
  it("does NOT double-forecast: a flagged scarcity is graded by the tape, not the opportunity branch", () => {
    const scs = [{ id: "both", tickers: ["B1"], priced_in: "low" }];
    const s3 = { quotes: { B1: { price: 10 }, E1: { price: 100 } }, scarcity_signals: { both: { flag: "inflecting", score: 90 } } };
    const fc = makeScarcityForecasts(scs, s3, "2026-01-01", 42, ["E1"]);
    assert.equal(fc.length, 1); assert.equal(fc[0].source, "de-rating");
  });

  it("resolves underperform correctly: basket lags the complex → correct", () => {
    const open = makeScarcityForecasts(scarcities, sig, "2026-01-01", 42, ["E1", "E2"]);
    // basket flat, complex +20% → de-rating basket underperformed → claim correct
    const now = { X1: { price: 100 }, X2: { price: 100 }, Y1: { price: 50 }, E1: { price: 240 }, E2: { price: 240 } };
    const { resolved } = resolveDue(open, now, "2026-03-01");
    const c = resolved.find((r) => r.subject === "crowded");
    assert.equal(c.correct, true); assert.ok(c.rel < 0);
    const ch = resolved.find((r) => r.subject === "cheap"); // inflecting but also flat → underperformed → wrong
    assert.equal(ch.correct, false);
  });

  it("scorecard buckets relative calls under by_signal, leaving by_tilt intact", () => {
    let sc = updateScorecard(null, [{ type: "scarcity_rel", claim: "underperform", correct: true }, { type: "scarcity_rel", claim: "underperform", correct: false }, { claim: "up", correct: true }]);
    assert.equal(sc.total.n, 3); assert.equal(sc.total.hits, 2);
    assert.equal(sc.by_signal.underperform.n, 2); assert.equal(sc.by_signal.underperform.hits, 1);
    assert.equal(sc.by_tilt.overweight.n, 1); assert.equal(sc.by_tilt.overweight.hits, 1);
  });
});
