import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeForecasts, resolveDue, updateScorecard, addDays, makeScarcityForecasts, meanPrice, makeSizingForecast, weightedReturn, makeKillForecasts } from "../scripts/lib/forecast.mjs";

describe("forecast: kill-criterion deadline accountability", () => {
  const scs = [
    { id: "rare-earth", kill_criterion: { condition: "China lifts export controls", by_date: "2027" } },
    { id: "no-kill", priced_in: "low" },
    { id: "bad-date", kill_criterion: { condition: "x", by_date: "someday" } },
  ];
  it("registers only valid kill-criteria; year by-date → year-end resolve", () => {
    const f = makeKillForecasts(scs, "2026-06-03");
    assert.equal(f.length, 1);
    assert.equal(f[0].type, "kill_criterion");
    assert.equal(f[0].subject, "rare-earth");
    assert.equal(f[0].resolve_on, "2027-12-31");
  });
  it("month/day by-dates resolve to month-end / that day", () => {
    assert.equal(makeKillForecasts([{ id: "a", kill_criterion: { condition: "c", by_date: "2027-03" } }], "2026-01-01")[0].resolve_on, "2027-03-31");
    assert.equal(makeKillForecasts([{ id: "b", kill_criterion: { condition: "c", by_date: "2027-03-15" } }], "2026-01-01")[0].resolve_on, "2027-03-15");
  });
  it("keeps unmatured open; matured resolves survived/killed (needs_review, correct=null)", () => {
    const open = makeKillForecasts(scs, "2026-06-03"); // resolve_on 2027-12-31
    const r1 = resolveDue(open, {}, "2027-01-01", { scarcityIds: new Set(["rare-earth"]) });
    assert.equal(r1.resolved.length, 0);
    assert.equal(r1.stillOpen.length, 1);
    const r2 = resolveDue(open, {}, "2028-01-01", { scarcityIds: new Set(["rare-earth"]) });
    assert.equal(r2.resolved.length, 1);
    assert.equal(r2.resolved[0].outcome, "survived");
    assert.equal(r2.resolved[0].correct, null);
    assert.equal(r2.resolved[0].needs_review, true);
    const r3 = resolveDue(open, {}, "2028-01-01", { scarcityIds: new Set(["other"]) });
    assert.equal(r3.resolved[0].outcome, "killed");
  });
  it("scorecard tracks kill SEPARATELY and never pollutes the price-based hit-rate", () => {
    const sc = updateScorecard(null, [
      { type: "kill_criterion", outcome: "survived", correct: null, needs_review: true },
      { type: "kill_criterion", outcome: "killed", correct: null, needs_review: true },
      { claim: "up", correct: true }, // a normal tsmom resolution
    ]);
    assert.equal(sc.total.n, 1, "only the price-based call counts toward hit-rate");
    assert.equal(sc.total.hits, 1);
    assert.deepEqual(sc.kill, { matured: 2, survived: 1, killed: 1, needs_review: 2 });
  });
});

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
// deep-tech build-out complex, so the system judges its own thesis edge, not just direction. ---
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

import { basketReturn, priceMap } from "../scripts/lib/forecast.mjs";
// Audit P4/F2: the basket "return" was the ratio of price-WEIGHTED mean prices, and recomputed over
// CHANGED membership at resolution. Fix: equal-weight mean of per-ticker returns over the FIXED
// intersection of anchor & current membership.
describe("forecast: basketReturn (equal-weight, fixed membership)", () => {
  it("equal-weights per-ticker returns (a high-priced name doesn't dominate)", () => {
    const anchor = { A: 10, B: 1000 };           // a $10 and a $1000 name
    const now = { A: { price: 12 }, B: { price: 1050 } };  // +20% and +5%
    assert.equal(basketReturn(anchor, now), +(((0.2) + (0.05)) / 2).toFixed(10)); // 0.125 equal-weight
  });
  it("uses the FIXED anchor membership — a dropped ticker at resolution doesn't corrupt the return", () => {
    const anchor = { A: 100, B: 100 };
    const now = { A: { price: 110 }, B: { error: "no quote" } };  // B errors → use only A
    assert.ok(Math.abs(basketReturn(anchor, now) - 0.1) < 1e-9);   // not polluted by B's absence
  });
  it("null when no anchored ticker resolves", () => {
    assert.equal(basketReturn({ A: 100 }, { A: { error: "x" } }), null);
    assert.equal(basketReturn({}, {}), null);
  });
  it("priceMap captures per-ticker anchor prices for valid quotes only", () => {
    assert.deepEqual(priceMap({ A: { price: 10 }, B: { error: "x" }, C: { price: 0 } }, ["A", "B", "C"]), { A: 10 });
  });
});

describe("forecast: resolveDue uses equal-weight basket returns (new) + legacy fallback", () => {
  it("NEW forecast with basket_prices resolves on equal-weight per-ticker returns", () => {
    const f = { id: "x", type: "scarcity_rel", claim: "outperform", resolve_on: "2026-02-01",
      basket_prices: { A: 100 }, complex_prices: { Q: 100 }, basket_at: 100, complex_at: 100, proxies: ["A"], complex_tickers: ["Q"] };
    const now = { A: { price: 120 }, Q: { price: 105 } };  // basket +20%, complex +5% → rel +15% → outperform correct
    const { resolved } = resolveDue([f], now, "2026-02-02");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].correct, true);
    assert.equal(resolved[0].rel, 0.15);
  });
  it("LEGACY forecast (no basket_prices) still resolves via the old mean-ratio path", () => {
    const f = { id: "y", type: "scarcity_rel", claim: "outperform", resolve_on: "2026-02-01",
      basket_at: 100, complex_at: 100, proxies: ["A"], complex_tickers: ["Q"] };
    const { resolved } = resolveDue([f], { A: { price: 120 }, Q: { price: 105 } }, "2026-02-02");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].correct, true);
  });
});

// CRITICAL-2 (adversarial review): the G3 sizing tilt must be RECORDED and GRADED, not asserted.
describe("forecast: G3 sizing-tilt grading", () => {
  const rebalance = {
    signal: { rows: [{ ticker: "HI", target_usd: 60000 }, { ticker: "LO", target_usd: 40000 }] },
    research: { rows: [{ ticker: "HI", target_usd: 50000 }, { ticker: "LO", target_usd: 50000 }] },
  };
  const quotes = { HI: { price: 100 }, LO: { price: 100 } };

  it("records one falsifiable 'signal_beats_research' claim with weights + anchor prices", () => {
    const f = makeSizingForecast(rebalance, quotes, "2026-01-01", 42);
    assert.equal(f.length, 1);
    assert.equal(f[0].type, "sizing_tilt");
    assert.equal(f[0].resolve_on, "2026-02-12");
    assert.ok(Math.abs(f[0].signal_weights.HI - 0.6) < 1e-9 && Math.abs(f[0].research_weights.HI - 0.5) < 1e-9);
  });

  it("resolves CORRECT when the signal's overweighted name outperforms (tilt beat the baseline)", () => {
    const [f] = makeSizingForecast(rebalance, quotes, "2026-01-01", 42);
    const { resolved } = resolveDue([f], { HI: { price: 130 }, LO: { price: 100 } }, "2026-03-01");
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].correct, true);       // signal overweighted HI which ran +30% → beats research
    assert.ok(resolved[0].rel > 0);
  });

  it("resolves INCORRECT when the tilt hurt (overweighted name lagged)", () => {
    const [f] = makeSizingForecast(rebalance, quotes, "2026-01-01", 42);
    const { resolved } = resolveDue([f], { HI: { price: 90 }, LO: { price: 120 } }, "2026-03-01");
    assert.equal(resolved[0].correct, false);
  });

  it("scorecard accumulates sizing_tilt under by_signal", () => {
    const [f] = makeSizingForecast(rebalance, quotes, "2026-01-01", 42);
    const { resolved } = resolveDue([f], { HI: { price: 130 }, LO: { price: 100 } }, "2026-03-01");
    const sc = updateScorecard(null, resolved);
    assert.equal(sc.by_signal.sizing_tilt.n, 1);
    assert.equal(sc.by_signal.sizing_tilt.hits, 1);
  });

  it("weightedReturn renormalizes over resolvable names (a missing quote doesn't poison it)", () => {
    const r = weightedReturn({ A: 0.5, B: 0.5 }, { A: 100, B: 100 }, { A: { price: 110 }, B: { error: "x" } });
    assert.ok(Math.abs(r - 0.1) < 1e-9); // only A resolves → +10%, weight renormalized to 1
  });
});
