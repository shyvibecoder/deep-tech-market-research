import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyShock, SCENARIOS } from "../scripts/lib/stress.mjs";

const pos = { A: { shares: 10 }, B: { shares: 10 } };
const px = { A: { price: 100 }, B: { price: 50 } }; // sleeve 1500

describe("stress: apply shock to the sleeve", () => {
  it("a −35% market shock at beta 1.0 breaches the −35% limit", () => {
    const r = applyShock(pos, px, { id: "x", name: "x", market: -0.35, beta: 1.0 });
    assert.equal(r.before, 1500); assert.equal(r.after, 975);
    assert.equal(r.drawdown, -0.35); assert.equal(r.breaches_35, true);
  });
  it("applies per-name beta", () => {
    const r = applyShock(pos, px, { id: "x", name: "x", market: -0.2, beta: 1.0, betas: {} }, { betaDefault: 1.0 });
    // A,B both -20% → 1200; drawdown -0.2; no breach
    assert.equal(r.drawdown, -0.2); assert.equal(r.breaches_35, false);
  });
  it("honors targeted shocks (RE-peace hits MP/LYC only)", () => {
    const r = applyShock({ MP: { shares: 10 }, GEV: { shares: 10 } }, { MP: { price: 100 }, GEV: { price: 100 } },
      { id: "re", name: "re", market: 0, beta: 1.0, targeted: { MP: -0.5 } });
    // MP -50% → 500, GEV 0% → 1000; before 2000 → after 1500; dd -0.25
    assert.equal(r.drawdown, -0.25);
  });
  it("ignores positions with no price/shares", () => {
    const r = applyShock({ A: { shares: 0 }, Z: { shares: 5, price: null } }, px, SCENARIOS[0]);
    assert.equal(r.before, 0);
  });
  it("honors per-name betas when supplied (high-beta name hit harder than the uniform default)", () => {
    const pos = { A: { shares: 10 }, B: { shares: 10 } }; // A=1000, B=500
    const r = applyShock(pos, px, { id: "x", name: "x", market: -0.1, beta: 1.0 }, { betas: { A: 2.0, B: 0.0 } });
    const a = r.per_name.find((x) => x.ticker === "A"), b = r.per_name.find((x) => x.ticker === "B");
    assert.equal(a.change, -0.2); // 2.0 beta × −10%
    assert.equal(b.change, 0);    // 0.0 beta → unaffected
  });
});
