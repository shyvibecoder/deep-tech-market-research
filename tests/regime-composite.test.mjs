import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegime, perNameTilt, compositeHoldings, REGIME_VERSION } from "../scripts/lib/regime.mjs";

const q = (vsMa200, mom12, off, volRatio, a200, a20) => ({
  price: 1, pct_vs_ma200: vsMa200, mom_12m: mom12, pct_off_high: off, vol_3m: volRatio, vol_1y: 1, above_ma200: a200, above_ma20: a20,
});

describe("regime v2: engine version", () => {
  it("stamps the regime version", () => {
    const r = computeRegime({ A: q(0.1, 0.2, -0.05, 1, true, true) }, [{ ticker: "A" }]);
    assert.equal(r.version, REGIME_VERSION);
    assert.ok(REGIME_VERSION >= 2);
  });
});

const trendUp = () => { const a = []; let p = 100; for (let i = 0; i < 260; i++) { p *= 1.002; a.push(p); } return a; };

describe("regime v2: composite basis is the ETFs (the F+C Thrust ladder runs on the composite)", () => {
  const securities = { PAVE: { type: "etf" }, GRID: { type: "etf" }, SMH: { type: "etf" }, GEV: { type: "stock" }, MP: { type: "stock" } };
  const holdings = [{ ticker: "PAVE" }, { ticker: "GRID" }, { ticker: "SMH" }, { ticker: "GEV" }, { ticker: "MP" }];
  it("uses the ETF composite as the basis and follows the composite price series for posture", () => {
    const quotes = {
      PAVE: q(0.15, 0.4, -0.03, 0.9, true, true), GRID: q(0.12, 0.35, -0.04, 0.95, true, true), SMH: q(0.18, 0.45, -0.02, 0.9, true, true),
      GEV: q(-0.4, -0.6, -0.6, 2, false, false), MP: q(-0.5, -0.7, -0.7, 2, false, false), // noisy single names — they don't drive posture
    };
    const r = computeRegime(quotes, holdings, { securities, compositeCloses: trendUp() });
    assert.deepEqual(r.composite_basis.sort(), ["GRID", "PAVE", "SMH"]);
    assert.equal(r.posture, "risk-on"); // driven by the composite price series (TREND), not the noisy singles
  });
  it("compositeHoldings picks ETFs, falls back to all when <3 ETFs", () => {
    assert.equal(compositeHoldings(holdings, securities).length, 3);
    assert.equal(compositeHoldings([{ ticker: "GEV" }], securities).length, 1); // fallback
  });
});

describe("regime v2: per-name signed TSMOM tilt", () => {
  it("overweight on positive momentum + above 200-DMA; underweight on the opposite", () => {
    const quotes = { A: q(0.1, 0.3, -0.05, 1, true, true), B: q(-0.1, -0.3, -0.2, 1, false, false) };
    const tilt = perNameTilt(quotes, [{ ticker: "A", account: "ira" }, { ticker: "B", account: "ira" }]);
    assert.equal(tilt.find((x) => x.ticker === "A").tilt, "overweight");
    assert.equal(tilt.find((x) => x.ticker === "B").tilt, "underweight");
  });
});

describe("regime v2: account-aware policy", () => {
  it("emits IRA (tactical) vs taxable (hold) guidance", () => {
    const r = computeRegime({ A: q(0.1, 0.2, -0.05, 1, true, true) }, [{ ticker: "A", account: "ira" }]);
    assert.ok(r.account_policy && r.account_policy.ira && r.account_policy.taxable);
  });
});
