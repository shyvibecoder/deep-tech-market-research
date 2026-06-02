import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { screenCandidate, screenDiversifiers, DIVERSIFIER_UNIVERSE, parseConviction, convictionCommittee, fundSleeve, applyFunding } from "../scripts/lib/diversifier.mjs";

// Synthetic factor world (deterministic — no RNG): a market factor and an independent "deep-tech build-out" factor.
// The complex (QQQ) loads on BOTH; a HEDGE basket loads low on market and NEGATIVE on the AI factor (so
// it passes the gate); a PROXY basket loads POSITIVE on the AI factor (so it fails — it amplifies the
// build-out). This lets us assert the screen's gate + ranking + book-awareness without network.
const N = 300;
const dates = (() => { const out = []; let d = Date.UTC(2015, 0, 2); for (let i = 0; i < N; i++) { out.push(new Date(d).toISOString().slice(0, 10)); d += 86400000; } return out; })();
const closesFrom = (retFn) => { const c = [100]; for (let i = 1; i < N; i++) c.push(c[i - 1] * (1 + retFn(i))); return c; };
const mkt = (i) => 0.0005 + 0.02 * Math.sin(i / 5);
const ai = (i) => 0.018 * Math.sin(i / 7 + 1);
const S = {
  SPY: { dates, closes: closesFrom(mkt) },
  QQQ: { dates, closes: closesFrom((i) => mkt(i) + ai(i)) },
  H1: { dates, closes: closesFrom((i) => 0.4 * mkt(i) - 0.3 * ai(i) + 0.0008) },
  H2: { dates, closes: closesFrom((i) => 0.4 * mkt(i) - 0.3 * ai(i) + 0.0006) },
  P1: { dates, closes: closesFrom((i) => 1.0 * mkt(i) + 0.6 * ai(i)) },
};
const cand = (id, tickers) => ({ id, sector: "X", scarcity: id, tickers });

describe("diversifier: the gate decides admission (negative deep-tech build-out loading = a real hedge)", () => {
  it("ADMITS a hedge basket (low market beta, negative build-out β)", () => {
    const r = screenCandidate(S, cand("hedge", ["H1", "H2"]), ["SPY"], ["QQQ"]);
    assert.equal(r.gate.pass, true);
    assert.ok(r.buildoutBeta < 0.3, `build-out β ${r.buildoutBeta} should be < 0.3`);
    assert.ok(r.marketBeta <= 0.95);
    assert.equal(r.qualifies, true);
  });
  it("REJECTS a secret AI proxy (positive build-out β amplifies the build-out it should hedge)", () => {
    const r = screenCandidate(S, cand("proxy", ["P1"]), ["SPY"], ["QQQ"]);
    assert.equal(r.gate.pass, false);
    assert.equal(r.qualifies, false);
    assert.match(r.reason, /amplifies/);
  });
  it("exposes marketBeta as canonical with mktBeta as an equal display alias", () => {
    const r = screenCandidate(S, cand("hedge", ["H1", "H2"]), ["SPY"], ["QQQ"]);
    assert.equal(r.marketBeta, r.mktBeta);
  });
});

describe("diversifier: ranking puts qualifiers first", () => {
  it("a gate-passing hedge ranks above a gate-failing proxy", () => {
    const ranked = screenDiversifiers(S, [cand("proxy", ["P1"]), cand("hedge", ["H1", "H2"])], ["SPY"], ["QQQ"]);
    assert.equal(ranked[0].id, "hedge");
    assert.equal(ranked[ranked.length - 1].id, "proxy");
  });
});

describe("diversifier: BOOK-AWARENESS (incremental drawdown vs the plan)", () => {
  it("ddReduction is null with no plan, finite with a plan", () => {
    assert.equal(screenCandidate(S, cand("hedge", ["H1", "H2"]), ["SPY"], ["QQQ"]).ddReduction, null);
    const wp = screenCandidate(S, cand("hedge", ["H1", "H2"]), ["SPY"], ["QQQ"], { planTickers: ["P1"] });
    assert.equal(typeof wp.ddReduction, "number");
  });
  it("flags exact-ticker overlap with the plan and yields zero incremental drawdown reduction", () => {
    const dup = screenCandidate(S, cand("dup", ["H1"]), ["SPY"], ["QQQ"], { planTickers: ["H1"] });
    assert.deepEqual(dup.heldOverlap, ["H1"]);
    assert.equal(dup.ddReduction, 0);                 // blending a holding with itself can't lower drawdown
    assert.match(dup.reason, /overlaps planned holdings/);
  });
});

describe("diversifier: universe", () => {
  it("ships a non-empty candidate universe with tickers", () => {
    assert.ok(DIVERSIFIER_UNIVERSE.length >= 2);
    assert.ok(DIVERSIFIER_UNIVERSE.every((c) => c.id && Array.isArray(c.tickers) && c.tickers.length));
  });
});

describe("diversifier Stage 2: conviction parsing + committee fallback", () => {
  it("parses a JSON conviction and clamps to [0,1]", () => {
    assert.equal(parseConviction('{"conviction": 0.82, "why": "durable"}'), 0.82);
    assert.equal(parseConviction('{"conviction": 1.5}'), 1);
    assert.equal(parseConviction('{"conviction": -0.2}'), 0);
    assert.equal(parseConviction("no number here at all"), null);
  });
  it("averages votes across callers", async () => {
    const a = async () => '{"conviction": 0.8}';
    const b = async () => '{"conviction": 0.6}';
    const out = await convictionCommittee(["JNJ"], {}, [a, b]);
    assert.equal(out.JNJ, 0.7);
  });
  it("falls back to the default when no caller yields a conviction (offline / no key)", async () => {
    const dead = async () => { throw new Error("no key"); };
    const out = await convictionCommittee(["JNJ"], {}, [dead], { fallback: 0.6 });
    assert.equal(out.JNJ, 0.6);
    const none = await convictionCommittee(["MRK"], {}, []);
    assert.equal(none.MRK, 0.6);
  });
});

describe("diversifier Stage 3: sizing fills the sleeve budget around what's planned", () => {
  const portfolio = { sleeve_usd: 1_500_000, holdings: [{ ticker: "FIW", weight: 0.07 }, { ticker: "PAVE", weight: 0.93 }] };
  const funding = fundSleeve({
    candidates: [{ id: "health", scarcity: "Health", tickers: ["JNJ", "MRK"] }],
    currentHoldings: portfolio.holdings, existingDiversifierTickers: ["FIW"],
    sleevePct: 0.15, sleeveUsd: portfolio.sleeve_usd,
  });
  it("budget = sleeve% minus the existing diversifier (FIW) weight", () => {
    assert.equal(funding.existingDivWeight, 0.07);
    assert.equal(funding.budget, 0.08);
  });
  it("splits the budget across new names (equal conviction+vol → equal split) and scales deep-tech build-out down", () => {
    assert.equal(funding.newHoldings.length, 2);
    assert.equal(funding.newHoldings[0].weight, 0.04);
    assert.equal(funding.newHoldings[0].target_usd, 60000);
    assert.ok(Math.abs(funding.buildoutScale - 0.85 / 0.93) < 1e-3);
  });
  it("the proposed plan still sums to 1.0 with the diversifier axis at exactly the sleeve %", () => {
    const holdings = applyFunding(portfolio, funding);
    const total = holdings.reduce((a, h) => a + h.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-3, `plan sums to ${total}`);
    const divTickers = new Set(["FIW", ...funding.newHoldings.map((h) => h.ticker)]);
    const divTotal = holdings.filter((h) => divTickers.has(h.ticker)).reduce((a, h) => a + h.weight, 0);
    assert.ok(Math.abs(divTotal - 0.15) < 1e-3, `diversifier axis = ${divTotal}`);
    assert.equal(holdings.find((h) => h.ticker === "FIW").weight, 0.07); // FIW untouched
  });
  it("EDGE: zero new qualifiers → plan still sums to 1.0 (no phantom-reserved cash hole) [B2]", () => {
    const f = fundSleeve({ candidates: [], currentHoldings: portfolio.holdings, existingDiversifierTickers: ["FIW"], sleevePct: 0.15, sleeveUsd: portfolio.sleeve_usd });
    assert.equal(f.newHoldings.length, 0);
    const h = applyFunding(portfolio, f);
    const total = h.reduce((a, x) => a + x.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-3, `sums to ${total}`);
  });
  it("caps to the top-N by conviction (focused sleeve, not dust) and still fills the budget", () => {
    const f = fundSleeve({
      candidates: [{ id: "s", scarcity: "S", tickers: ["A", "B", "C", "D"] }],
      currentHoldings: portfolio.holdings, existingDiversifierTickers: ["FIW"], sleevePct: 0.15, sleeveUsd: 1_500_000,
      convictions: { A: 0.9, B: 0.5, C: 0.8, D: 0.4 }, maxNames: 2,
    });
    assert.equal(f.newHoldings.length, 2);
    assert.deepEqual(f.newHoldings.map((h) => h.ticker).sort(), ["A", "C"]); // top-2 by conviction
    assert.ok(Math.abs(f.newHoldings.reduce((a, h) => a + h.weight, 0) - 0.08) < 1e-3); // budget still filled
  });
  it("EDGE: existing diversifiers already over the target → sums to 1.0, no build-out scale-up [B1]", () => {
    const over = { sleeve_usd: 1_500_000, holdings: [{ ticker: "FIW", weight: 0.20 }, { ticker: "PAVE", weight: 0.80 }] };
    const f = fundSleeve({ candidates: [{ id: "health", scarcity: "Health", tickers: ["JNJ"] }], currentHoldings: over.holdings, existingDiversifierTickers: ["FIW"], sleevePct: 0.15, sleeveUsd: over.sleeve_usd });
    assert.equal(f.budget, 0);
    assert.equal(f.newHoldings.length, 0);
    assert.ok(f.buildoutScale <= 1.0, `build-out must not scale UP (was ${f.buildoutScale})`);
    const h = applyFunding(over, f);
    const total = h.reduce((a, x) => a + x.weight, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-3, `sums to ${total}`);
  });
});
