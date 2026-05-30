import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeForecasts, resolveDue, updateScorecard, addDays } from "../scripts/lib/forecast.mjs";

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
