import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bsPrice, impliedVol, evaluateOption, normCdf } from "../scripts/lib/options.mjs";

describe("options: Black-Scholes", () => {
  it("gives N(0)=0.5 and N(1.96)≈0.975", () => {
    assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  });
  it("prices an ATM 1y call (S=K=100, r=0, σ=0.2) at ≈7.97", () => {
    assert.ok(Math.abs(bsPrice({ type: "call", S: 100, K: 100, T: 1, r: 0, sigma: 0.2 }) - 7.97) < 0.02);
  });
  it("respects put-call parity C - P = S - K·e^(-rT)", () => {
    const a = { S: 100, K: 105, T: 0.5, r: 0.04, sigma: 0.3 };
    const C = bsPrice({ type: "call", ...a }), P = bsPrice({ type: "put", ...a });
    assert.ok(Math.abs((C - P) - (100 - 105 * Math.exp(-0.04 * 0.5))) < 1e-4);
  });
});

describe("options: implied vol", () => {
  it("round-trips a known sigma back out of the price", () => {
    const px = bsPrice({ type: "call", S: 50, K: 55, T: 0.75, r: 0.04, sigma: 0.35 });
    assert.ok(Math.abs(impliedVol({ type: "call", S: 50, K: 55, T: 0.75, r: 0.04, price: px }) - 0.35) < 1e-3);
  });
  it("returns null when the price is below intrinsic", () => {
    assert.equal(impliedVol({ type: "call", S: 100, K: 50, T: 1, r: 0.04, price: 1 }), null);
  });
});

describe("options: fairness verdict (IV vs realized)", () => {
  const mk = (sigma, refVol) => evaluateOption({ type: "call", S: 100, K: 110, daysToExpiry: 90, r: 0.04, marketPrice: bsPrice({ type: "call", S: 100, K: 110, T: 90 / 365, r: 0.04, sigma }), refVol });
  it("flags RICH when IV ≫ realized", () => assert.equal(mk(0.6, 0.3).verdict, "rich"));
  it("flags CHEAP when IV < realized", () => assert.equal(mk(0.22, 0.4).verdict, "cheap"));
  it("calls it FAIR within a normal variance premium", () => assert.equal(mk(0.33, 0.3).verdict, "fair"));
});

import { bsGreeks } from "../scripts/lib/options.mjs";
// Audit F1: the theta dividend-yield (q) term had the wrong sign (latent — masked by q=0). Lock it
// against a central finite-difference of bsPrice in T, which is sign-agnostic ground truth.
describe("options: bsGreeks theta with dividend yield (F1 sign fix)", () => {
  const fdTheta = (type, p) => {
    const h = 1e-4;
    const up = bsPrice({ ...p, T: p.T + h }), dn = bsPrice({ ...p, T: p.T - h });
    return -((up - dn) / (2 * h)) / 365;   // per-day, matching bsGreeks convention
  };
  for (const type of ["call", "put"]) {
    it(`${type} theta matches finite-difference with q>0`, () => {
      const p = { type, S: 100, K: 100, T: 0.5, r: 0.04, sigma: 0.3, q: 0.02 };
      const g = bsGreeks(p);
      assert.ok(Math.abs(g.theta - fdTheta(type, p)) < 1e-4, `theta ${g.theta} vs FD ${fdTheta(type, p)}`);
    });
  }
  it("q=0 still correct (the previously-masked path)", () => {
    const p = { type: "call", S: 100, K: 105, T: 0.25, r: 0.03, sigma: 0.25, q: 0 };
    const fd = (() => { const h = 1e-4; return -((bsPrice({ ...p, T: p.T + h }) - bsPrice({ ...p, T: p.T - h })) / (2 * h)) / 365; })();
    assert.ok(Math.abs(bsGreeks(p).theta - fd) < 1e-4);
  });
});
