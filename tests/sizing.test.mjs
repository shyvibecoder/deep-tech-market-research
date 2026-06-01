import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  targetDeltas, riskFactors, opportunityFactor, regimeFactor,
  targetWeights, rebalancePlan, rebalanceBoth, clamp,
} from "../scripts/lib/sizing.mjs";

const holds = [
  { ticker: "GEV", account: "ira" }, { ticker: "MP", account: "ira" },
  { ticker: "ASML", account: "taxable" },
];
const tilt = (m) => Object.entries(m).map(([ticker, t]) => ({ ticker, tilt: t }));

describe("sizing: target-weight deltas (analysis → action)", () => {
  it("risk-on + overweight (IRA) → add", () => {
    const d = targetDeltas(holds, tilt({ GEV: "overweight" }), { posture: "risk-on" });
    const gev = d.find((x) => x.ticker === "GEV");
    assert.equal(gev.action, "add"); assert.equal(gev.delta_pct, 25);
  });
  it("does NOT add overweights when not risk-on (no accelerating into weakness)", () => {
    const d = targetDeltas(holds, tilt({ GEV: "overweight" }), { posture: "caution" });
    assert.equal(d.find((x) => x.ticker === "GEV").action, "hold");
  });
  it("trims underweights in any posture", () => {
    const d = targetDeltas(holds, tilt({ MP: "underweight" }), { posture: "defensive" });
    const mp = d.find((x) => x.ticker === "MP");
    assert.equal(mp.action, "trim"); assert.equal(mp.delta_pct, -25);
  });
  it("taxable sleeve always holds (buy-and-hold anchors)", () => {
    const d = targetDeltas(holds, tilt({ ASML: "overweight" }), { posture: "risk-on" });
    assert.equal(d.find((x) => x.ticker === "ASML").action, "hold (taxable anchor)");
  });
});

// ── G3 factor primitives ──────────────────────────────────────────────────────────────────────
describe("sizing G3: factor primitives", () => {
  it("riskFactors down-weights high-vol, up-weights low-vol, bounded ±cap", () => {
    const f = riskFactors(["LO", "HI"], { LO: 0.2, HI: 0.8 }, { cap: 0.15 });
    assert.ok(f.HI < 1 && f.LO > 1, "high vol < 1 < low vol");
    assert.ok(f.HI >= 0.85 - 1e-9 && f.LO <= 1.15 + 1e-9, "bounded to ±15%");
  });
  it("riskFactors neutral (1.0) for missing vol and when <2 valid names", () => {
    const f = riskFactors(["A", "B"], { A: 0.3 }, { cap: 0.15 });
    assert.equal(f.A, 1); assert.equal(f.B, 1);
  });
  it("opportunityFactor: crowded→1-cap, top→1+cap, mid→1, missing→neutral", () => {
    assert.ok(Math.abs(opportunityFactor(0, { cap: 0.3 }) - 0.7) < 1e-9);
    assert.ok(Math.abs(opportunityFactor(100, { cap: 0.3 }) - 1.3) < 1e-9);
    assert.ok(Math.abs(opportunityFactor(50, { cap: 0.3 }) - 1.0) < 1e-9);
    assert.equal(opportunityFactor(undefined), 1);
  });
  it("regimeFactor: overweight bites only risk-on; underweight bites always", () => {
    assert.equal(regimeFactor("overweight", "risk-on", { cap: 0.15 }), 1.15);
    assert.equal(regimeFactor("overweight", "neutral", { cap: 0.15 }), 1);
    assert.equal(regimeFactor("underweight", "neutral", { cap: 0.15 }), 0.85);
    assert.equal(regimeFactor("n/a", "risk-on"), 1);
  });
  it("clamp bounds correctly", () => {
    assert.equal(clamp(2, 0, 1), 1); assert.equal(clamp(-1, 0, 1), 0); assert.equal(clamp(0.5, 0, 1), 0.5);
  });
});

// ── G3 target weights ───────────────────────────────────────────────────────────────────────
describe("sizing G3: targetWeights", () => {
  const g3holds = [
    { ticker: "PAVE", account: "taxable", target_usd: 200000 },
    { ticker: "ASML", account: "taxable", target_usd: 100000 },
    { ticker: "SMH", account: "ira", target_usd: 150000 },
    { ticker: "LEU", account: "ira", target_usd: 50000 },
  ];
  it("research mode conserves each sleeve's total $", () => {
    const w = targetWeights(g3holds, { mode: "research", vols: { PAVE: 0.25, ASML: 0.3, SMH: 0.35, LEU: 0.7 } });
    const tax = w.filter((r) => r.account === "taxable").reduce((a, r) => a + r.target_usd, 0);
    const ira = w.filter((r) => r.account === "ira").reduce((a, r) => a + r.target_usd, 0);
    assert.ok(Math.abs(tax - 300000) <= 2 && Math.abs(ira - 200000) <= 2);
  });
  it("signal mode shrinks a CROWDED name and grows a high-opportunity one vs research", () => {
    const vols = { PAVE: 0.3, ASML: 0.3, SMH: 0.3, LEU: 0.3 };
    const res = targetWeights(g3holds, { mode: "research", vols });
    const sig = targetWeights(g3holds, { mode: "signal", vols, oppByTicker: { SMH: 0, LEU: 100 } });
    const get = (a, t) => a.find((r) => r.ticker === t).target_usd;
    assert.ok(get(sig, "SMH") < get(res, "SMH") && get(sig, "LEU") > get(res, "LEU"));
  });
  it("regime tilt affects ONLY the IRA sleeve (taxable weights track base)", () => {
    const vols = { PAVE: 0.3, ASML: 0.3, SMH: 0.3, LEU: 0.3 };
    const sig = targetWeights(g3holds, {
      mode: "signal", vols, posture: "risk-on",
      perName: [{ ticker: "PAVE", tilt: "overweight" }],
    });
    const pave = sig.find((r) => r.ticker === "PAVE"), asml = sig.find((r) => r.ticker === "ASML");
    assert.ok(Math.abs(pave.target_weight - asml.target_weight * 2) < 0.2, "taxable 200k:100k preserved");
  });
});

// ── G3 rebalance plan + funding rules ─────────────────────────────────────────────────────────
describe("sizing G3: rebalancePlan funding rules", () => {
  const targets = [
    { ticker: "SMH", account: "ira", base_usd: 150000, target_weight: 60, target_usd: 130000 },
    { ticker: "LEU", account: "ira", base_usd: 50000, target_weight: 40, target_usd: 70000 },
    { ticker: "PAVE", account: "taxable", base_usd: 200000, target_weight: 67, target_usd: 180000 },
    { ticker: "ASML", account: "taxable", base_usd: 100000, target_weight: 33, target_usd: 120000 },
  ];
  it("IRA trims fund IRA buys (self-funding within the sleeve)", () => {
    const { rows } = rebalancePlan(targets);
    assert.equal(rows.find((r) => r.ticker === "SMH").action, "trim (funds buys)");
    assert.equal(rows.find((r) => r.ticker === "SMH").delta_usd, -20000);
    assert.equal(rows.find((r) => r.ticker === "LEU").action, "buy");
  });
  it("a taxable trim is BLOCKED unless the higher bar (taxableTrimOk) is met", () => {
    const blocked = rebalancePlan(targets);
    const pave = blocked.rows.find((r) => r.ticker === "PAVE");
    assert.match(pave.action, /anchor — trim bar not met/);
    assert.equal(pave.actioned_usd, 0);
    assert.equal(blocked.summary.blocked_trim_usd, 20000);

    const allowed = rebalancePlan(targets, { taxableTrimOk: ["PAVE"] });
    const pave2 = allowed.rows.find((r) => r.ticker === "PAVE");
    assert.equal(pave2.action, "trim (high-conviction)");
    assert.equal(pave2.actioned_usd, -20000);
  });
  it("uses live marketValue when provided, else base target", () => {
    const { rows } = rebalancePlan(targets, { currentUsd: { LEU: 60000 } });
    const leu = rows.find((r) => r.ticker === "LEU");
    assert.equal(leu.current_usd, 60000);
    assert.equal(leu.delta_usd, 10000);
  });
});

describe("sizing G3: rebalanceBoth", () => {
  it("returns research + signal plans and the risk cap pct", () => {
    const holds2 = [
      { ticker: "SMH", account: "ira", target_usd: 150000 },
      { ticker: "LEU", account: "ira", target_usd: 50000 },
    ];
    const both = rebalanceBoth(holds2, { vols: { SMH: 0.3, LEU: 0.3 }, oppByTicker: { SMH: 0, LEU: 100 }, riskCap: 0.15 });
    assert.equal(both.research.rows.length, 2);
    assert.equal(both.risk_cap_pct, 15);
    const sLeu = both.signal.rows.find((r) => r.ticker === "LEU").target_usd;
    const rLeu = both.research.rows.find((r) => r.ticker === "LEU").target_usd;
    assert.ok(sLeu > rLeu, "signal boosts high-opportunity LEU above research");
  });

  // CRITICAL regression (adversarial review): a missing live quote must NOT manufacture phantom trims.
  // Unpriced names are EXCLUDED and the sleeve total follows only the priced names → buy === sell.
  it("partial live coverage: excludes unpriced names; IRA buy === sell (no 'sell everything' leak)", () => {
    const holds = [
      { ticker: "A", account: "ira", target_usd: 100000 },
      { ticker: "B", account: "ira", target_usd: 100000 },
      { ticker: "C", account: "ira", target_usd: 100000 }, // no live quote
    ];
    const both = rebalanceBoth(holds, { currentUsd: { A: 120000, B: 80000 }, vols: { A: 0.3, B: 0.3 } });
    const tickers = both.research.rows.map((r) => r.ticker);
    assert.ok(!tickers.includes("C"), "unpriced C is excluded, not defaulted to its base target");
    assert.equal(both.research.rows.length, 2);
    // sleeve total = 120k+80k = 200k; equal vol → 100k each; A trims 20k, B buys 20k → nets to zero
    assert.equal(both.research.summary.buy_usd, both.research.summary.sell_usd);
    assert.equal(both.research.summary.net_usd, 0);
  });

  it("sleeve conserves EXACTLY after largest-remainder rounding (Σ target === sleeve)", () => {
    const holds = [
      { ticker: "X", account: "ira", target_usd: 33333 },
      { ticker: "Y", account: "ira", target_usd: 33333 },
      { ticker: "Z", account: "ira", target_usd: 33334 },
    ];
    const w = targetWeights(holds, { mode: "research", vols: { X: 0.21, Y: 0.37, Z: 0.58 } });
    const sum = w.reduce((a, r) => a + r.target_usd, 0);
    assert.equal(sum, 100000, "no rounding drift");
  });
});

// HIGH-5 (adversarial review): taxable buys must surface a funding source, not imply free money.
describe("sizing G3: funding (needs_new_cash)", () => {
  it("a taxable buy with no dry powder surfaces needs_new_cash; cash reduces it", () => {
    const targets = [{ ticker: "P", account: "taxable", base_usd: 100000, target_weight: 100, target_usd: 120000 }];
    assert.equal(rebalancePlan(targets).summary.needs_new_cash_usd, 20000);
    assert.equal(rebalancePlan(targets, { cashBySleeve: { taxable: 15000 } }).summary.needs_new_cash_usd, 5000);
  });
  it("the IRA self-funds (trims cover buys) → needs_new_cash ~0 even with no cash", () => {
    const targets = [
      { ticker: "A", account: "ira", base_usd: 100000, target_weight: 50, target_usd: 80000 },
      { ticker: "B", account: "ira", base_usd: 100000, target_weight: 50, target_usd: 120000 },
    ];
    assert.equal(rebalancePlan(targets).summary.needs_new_cash_usd, 0);
  });
});

// LOW-10: degenerate sleeves shouldn't crash or misweight.
describe("sizing G3: single-name sleeve", () => {
  it("a lone name gets 100% of its sleeve", () => {
    const w = targetWeights([{ ticker: "ONLY", account: "ira", target_usd: 50000 }], { mode: "research", vols: { ONLY: 0.4 } });
    assert.equal(w.length, 1); assert.equal(w[0].target_weight, 100); assert.equal(w[0].target_usd, 50000);
  });
});

// MEDIUM-8 coherence: the legacy "Suggested IRA tilts" and the G3 signal plan must not give OPPOSITE
// directional advice for the same IRA name when the non-regime factors (opportunity, vol) are neutral.
describe("sizing G3: coherence with legacy targetDeltas", () => {
  it("never opposes targetDeltas on direction for an IRA name (neutral opp/vol)", () => {
    const holds = [{ ticker: "G", account: "ira", target_usd: 100000 }, { ticker: "H", account: "ira", target_usd: 100000 }];
    const perName = [{ ticker: "G", tilt: "underweight" }, { ticker: "H", tilt: "overweight" }];
    const td = targetDeltas(holds, perName, { posture: "risk-on", per_name: perName });
    const both = rebalanceBoth(holds, { vols: { G: 0.3, H: 0.3 }, perName, posture: "risk-on", oppByTicker: { G: 50, H: 50 } });
    const dir = (a) => /trim/.test(a) ? -1 : /add|buy/.test(a) ? 1 : 0; // check trim first ("funds buys" contains "buy")
    for (const t of ["G", "H"]) {
      const a = dir(td.find((x) => x.ticker === t).action);
      const b = dir(both.signal.rows.find((x) => x.ticker === t).action);
      if (a && b) assert.notEqual(a + b, 0, `${t}: legacy and G3 views must not give opposite advice`);
    }
  });
});
