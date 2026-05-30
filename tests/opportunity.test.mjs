import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { opportunityScore, rankOpportunities } from "../scripts/lib/opportunity.mjs";

// The model encodes ALPHA.md Edge 1: alpha lives in what binds soon, is durable + defensible,
// and is NOT yet priced. priced_in is the multiplicative GATE — no edge in what's priced.
describe("opportunity: the not-yet-priced GATE dominates", () => {
  it("scores a crowded thesis ~0 no matter how good the business", () => {
    const s = { priced_in: "crowded", bind_window: "now", durability: "very-high", substitution_risk: "low", non_consensus: true };
    assert.equal(opportunityScore(s).score, 0);
  });
  it("scores the textbook opportunity (un-priced, binds now, durable, defensible, contrarian) very high", () => {
    const s = { priced_in: "low", bind_window: "now", durability: "very-high", substitution_risk: "low", non_consensus: true };
    const o = opportunityScore(s);
    assert.ok(o.score >= 95, `expected >=95, got ${o.score}`);
    assert.equal(o.gate, 1); assert.equal(o.contrarian, true);
  });
  it("a fully-priced great business beats nothing; an un-priced mediocre one still has edge", () => {
    const priced = opportunityScore({ priced_in: "high", bind_window: "now", durability: "very-high", substitution_risk: "low" });
    const unpriced = opportunityScore({ priced_in: "low", bind_window: "2030+", durability: "medium", substitution_risk: "medium" });
    assert.ok(unpriced.score > priced.score);
  });
});

describe("opportunity: quality blends bind-proximity, durability, defensibility", () => {
  it("rewards sooner binds over later ones, all else equal", () => {
    const soon = opportunityScore({ priced_in: "low", bind_window: "now", durability: "high", substitution_risk: "low" });
    const late = opportunityScore({ priced_in: "low", bind_window: "2030+", durability: "high", substitution_risk: "low" });
    assert.ok(soon.score > late.score);
  });
  it("penalizes high substitution risk", () => {
    const safe = opportunityScore({ priced_in: "low", bind_window: "now", durability: "high", substitution_risk: "low" });
    const subst = opportunityScore({ priced_in: "low", bind_window: "now", durability: "high", substitution_risk: "high" });
    assert.ok(safe.score > subst.score);
  });
  it("contrarian bonus lifts the score but is capped at 100", () => {
    const base = { priced_in: "low", bind_window: "now", durability: "very-high", substitution_risk: "low" };
    assert.ok(opportunityScore({ ...base, non_consensus: true }).score >= opportunityScore({ ...base, non_consensus: false }).score);
    assert.ok(opportunityScore({ ...base, non_consensus: true }).score <= 100);
  });
});

describe("opportunity: robustness + ranking", () => {
  it("falls back gracefully on unknown enum values (no crash, mid score)", () => {
    const o = opportunityScore({ priced_in: "???", bind_window: "???", durability: "???", substitution_risk: "???" });
    assert.ok(o.score > 0 && o.score < 100);
  });
  it("ranks a list highest-opportunity first and carries id/scarcity", () => {
    const list = [
      { id: "a", scarcity: "A", priced_in: "crowded", bind_window: "now", durability: "very-high", substitution_risk: "low" },
      { id: "b", scarcity: "B", priced_in: "low", bind_window: "now", durability: "very-high", substitution_risk: "low", non_consensus: true },
    ];
    const r = rankOpportunities(list);
    assert.equal(r[0].id, "b"); assert.equal(r[0].scarcity, "B");
    assert.ok(r[0].score > r[1].score);
  });
  it("is safe on empty", () => assert.deepEqual(rankOpportunities([]), []));
});
