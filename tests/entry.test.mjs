import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entryQuality, stageBuy } from "../scripts/lib/entry.mjs";
import { parseEdgarFacts, parseTiingoFundamentals, corroborateValuation, valuationLabel } from "../scripts/lib/valuation.mjs";

describe("entry: per-name entry quality", () => {
  it("a pulled-back, uptrending, inflecting, cheap name reads GOOD (lean in)", () => {
    const e = entryQuality({ pctOffHigh: 0.18, aboveMa200: true, mom12m: 0.2, mom1m: 0.03, relStrength: 0.3, valuation: { tag: "cheap" } });
    assert.equal(e.label, "good");
    assert.ok(e.score >= 66);
  });
  it("a just-ran-up, at-highs, de-rating, rich name reads STRETCHED (stage it)", () => {
    const e = entryQuality({ pctOffHigh: 0.0, aboveMa200: true, mom12m: 0.6, mom1m: 0.25, relStrength: -0.3, valuation: { tag: "rich" } });
    assert.equal(e.label, "stretched");
    assert.ok(e.score < 40);
  });
  it("a hot 1-month move penalizes momentum (worse entry than the same 12m without the spike)", () => {
    const base = { pctOffHigh: 0.05, aboveMa200: true, mom12m: 0.3, relStrength: 0 };
    assert.ok(entryQuality({ ...base, mom1m: 0.25 }).score < entryQuality({ ...base, mom1m: 0.02 }).score);
  });
  it("a deep drawdown BELOW the 200-DMA is tapered (possible breakage, not a dip)", () => {
    const dipAbove = entryQuality({ pctOffHigh: 0.5, aboveMa200: true, mom12m: 0, relStrength: 0 });
    const deepBelow = entryQuality({ pctOffHigh: 0.5, aboveMa200: false, mom12m: 0, relStrength: 0 });
    assert.ok(deepBelow.score < dipAbove.score);
  });
  it("drops an implausible 12m momentum (data glitch like +972%) instead of trusting it", () => {
    const e = entryQuality({ pctOffHigh: 0.0, aboveMa200: true, mom12m: 9.72, mom1m: 0.1, relStrength: 0 });
    assert.ok(!("momentum" in e.legs), "glitch momentum leg dropped");
    assert.ok(!e.reasons.some((r) => /12m/.test(r)), "glitch not shown in reasons");
    // a sane +30% IS kept
    assert.ok("momentum" in entryQuality({ pctOffHigh: 0, aboveMa200: true, mom12m: 0.3 }).legs);
  });
  it("renormalizes over present legs; missing data → n/a, not a crash", () => {
    assert.equal(entryQuality({}).label, "n/a");
    const partial = entryQuality({ aboveMa200: true });
    assert.ok(Number.isFinite(partial.score));
  });
});

describe("entry: staging the buy", () => {
  it("good → deploy all now; stretched → mostly DCA; splits sum to the amount", () => {
    const g = stageBuy("good", 100000), s = stageBuy("stretched", 100000);
    assert.equal(g.now, 100000); assert.equal(g.dca, 0);
    assert.ok(s.now < 40000 && s.dca > 60000);
    assert.equal(s.now + s.dca, 100000);
  });
  it("fair stages partially", () => { const f = stageBuy("fair", 100000); assert.ok(f.now > 0 && f.dca > 0); });
});

describe("valuation: EDGAR XBRL parse", () => {
  // Minimal companyfacts: 4 quarters of diluted EPS + 2 annual revenues + net income.
  const facts = { facts: { "us-gaap": {
    EarningsPerShareDiluted: { units: { "USD/shares": [
      { start: "2024-01-01", end: "2024-03-31", val: 1.0, form: "10-Q" },
      { start: "2024-04-01", end: "2024-06-30", val: 1.1, form: "10-Q" },
      { start: "2024-07-01", end: "2024-09-30", val: 1.2, form: "10-Q" },
      { start: "2024-10-01", end: "2024-12-31", val: 1.3, form: "10-Q" },
      { start: "2023-10-01", end: "2023-12-31", val: 0.9, form: "10-Q" },
    ] } },
    Revenues: { units: { USD: [
      { end: "2024-12-31", val: 1200, fp: "FY", form: "10-K" },
      { end: "2023-12-31", val: 1000, fp: "FY", form: "10-K" },
    ] } },
    NetIncomeLoss: { units: { USD: [{ end: "2024-12-31", val: 180, fp: "FY", form: "10-K" }] } },
  } } };
  it("computes TTM diluted EPS from the 4 latest quarters, then trailing P/E from price", () => {
    const v = parseEdgarFacts(facts, { price: 92 });
    assert.ok(Math.abs(v.eps_ttm - 4.6) < 1e-9, `eps_ttm ${v.eps_ttm}`); // 1.0+1.1+1.2+1.3
    assert.equal(v.pe, 20); // 92 / 4.6
  });
  it("derives revenue YoY and net margin from annual filings", () => {
    const v = parseEdgarFacts(facts, { price: 92 });
    assert.ok(Math.abs(v.revenue_yoy - 0.2) < 1e-9); // 1200/1000 - 1
    assert.ok(Math.abs(v.net_margin - 0.15) < 1e-9); // 180/1200
  });
  it("returns null P/E (no crash) when EPS is missing", () => {
    assert.equal(parseEdgarFacts({ facts: { "us-gaap": {} } }, { price: 50 }).pe, null);
  });
});

describe("valuation: Tiingo parse + corroboration + label", () => {
  it("takes the latest reported peRatio", () => {
    const v = parseTiingoFundamentals([{ date: "2026-05-01", peRatio: 19 }, { date: "2026-06-01", peRatio: 21 }]);
    assert.equal(v.pe, 21);
  });
  it("corroborates two close P/Es (ok) and flags single-source when one is missing", () => {
    const both = corroborateValuation({ edgar: { pe: 20, revenue_yoy: 0.2 }, tiingo: { pe: 21 } });
    assert.equal(both.ok, true); assert.equal(both.single_source, false);
    assert.ok(both.pe >= 20 && both.pe <= 21);
    assert.equal(both.revenue_yoy, 0.2); // EDGAR growth carried through
    const one = corroborateValuation({ edgar: { pe: 20 }, tiingo: { pe: null } });
    assert.equal(one.single_source, true); assert.equal(one.ok, null);
  });
  it("flags divergence when the two P/Es disagree widely", () => {
    const c = corroborateValuation({ edgar: { pe: 12 }, tiingo: { pe: 30 } });
    assert.equal(c.ok, false);
  });
  it("labels P/E relative to the peer median (cheap/fair/rich)", () => {
    assert.equal(valuationLabel({ pe: 12 }, { peerMedianPe: 20 }).tag, "cheap"); // 0.6×
    assert.equal(valuationLabel({ pe: 30 }, { peerMedianPe: 20 }).tag, "rich");  // 1.5×
    assert.equal(valuationLabel({ pe: 21 }, { peerMedianPe: 20 }).tag, "fair");
    assert.equal(valuationLabel({ pe: null }).tag, null);
  });
  it("a high trailing P/E backed by strong revenue growth is NOT 'rich' (cyclical-recovery fix, e.g. MU)", () => {
    const noGrowth = valuationLabel({ pe: 52, revenue_yoy: 0.02 }, { peerMedianPe: 29 });
    assert.equal(noGrowth.tag, "rich"); // 1.8× peers, flat growth → genuinely rich
    const recovering = valuationLabel({ pe: 52, revenue_yoy: 0.49 }, { peerMedianPe: 29 });
    assert.equal(recovering.tag, "fair"); // same multiple, +49% rev → growth-justified, not penalized
    assert.match(recovering.label, /forward lower/);
  });
});
