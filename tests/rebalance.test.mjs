import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rebalanceFlags } from "../scripts/lib/rebalance.mjs";

// Flag any holding whose actual weight is >±band from its target weight (v4).
describe("rebalance: ±band drift from target weight", () => {
  const targets = { A: 100, B: 100 }; // target $ (→ 50/50 target weights)
  it("flags a holding that has drifted well above target weight", () => {
    // A doubled, B flat → A ~67% vs 50% target = +33% drift → flagged
    const f = rebalanceFlags({ A: { shares: 2, price: 100 }, B: { shares: 1, price: 100 } }, targets, 0.25);
    const a = f.find((x) => x.ticker === "A");
    assert.ok(a && a.flagged);
    assert.equal(a.action, "trim");
  });
  it("does not flag holdings within band", () => {
    const f = rebalanceFlags({ A: { shares: 1, price: 100 }, B: { shares: 1, price: 100 } }, targets, 0.25);
    assert.equal(f.filter((x) => x.flagged).length, 0);
  });
  it("flags an underweight holding to add", () => {
    const f = rebalanceFlags({ A: { shares: 1, price: 100 }, B: { shares: 3, price: 100 } }, targets, 0.25);
    const a = f.find((x) => x.ticker === "A");
    assert.ok(a.flagged && a.action === "add");
  });
  it("ignores positions with no price or no target", () => {
    const f = rebalanceFlags({ A: { shares: 1, price: null }, Z: { shares: 1, price: 5 } }, targets, 0.25);
    assert.equal(f.length, 0);
  });
});
