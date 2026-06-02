import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taxProfile, annualDragRate, locateAssets, DEFAULT_TAX } from "../scripts/lib/asset-location.mjs";

const holds = [
  { ticker: "GEV", account: "ira", role: "Anchor — build-out", weight: 0.10 },                              // build-out: high growth, low yield, tactical
  { ticker: "PAVE", account: "taxable", role: "Anchor — reshoring", weight: 0.10 },                          // build-out: tax-efficient anchor
  { ticker: "FIW", account: "taxable", role: "Anchor — non-build-out de-correlator", weight: 0.05 },         // diversifier: dividend-heavy
  { ticker: "NEE", account: "ira", role: "Diversifier (2nd axis) — utilities", axis: "diversifier", weight: 0.03 },
];
const sleeveUsd = 1_500_000;

describe("asset-location: tax profile by axis/role", () => {
  it("diversifiers are dividend-heavy + low-growth; build-out is low-yield + higher-growth", () => {
    const div = taxProfile(holds[2]); // FIW
    const bld = taxProfile(holds[0]); // GEV
    assert.ok(div.yieldPct > bld.yieldPct, "diversifier yields more");
    assert.ok(bld.growth > div.growth, "build-out grows faster");
  });
  it("a tactical (IRA) name turns over more than a taxable anchor", () => {
    assert.ok(taxProfile(holds[0]).turnover > taxProfile(holds[1]).turnover);
  });
  it("annual drag rises with yield + turnover", () => {
    assert.ok(annualDragRate({ yieldPct: 0.03, turnover: 0.6 }) > annualDragRate({ yieldPct: 0.008, turnover: 0.1 }));
  });
});

describe("asset-location: 3-way placement (Roth ← growth, Traditional ← income, taxable ← efficient)", () => {
  const r = locateAssets(holds, { capacities: { roth: 200_000, traditional: 200_000, taxable: 1_100_000 }, sleeveUsd, horizonYears: 20 });
  it("uses the 3-way split when Roth AND Traditional balances are given", () => assert.equal(r.three_way, true));
  it("puts a highest-growth build-out name in Roth", () => {
    assert.equal(r.rows.find((x) => x.ticker === "GEV").suggested, "roth");
  });
  it("shelters a dividend-heavy diversifier in a tax-advantaged account (never taxable)", () => {
    assert.notEqual(r.rows.find((x) => x.ticker === "FIW").suggested, "taxable");
  });
  it("reports a positive annual + horizon tax drag avoided", () => {
    assert.ok(r.summary.annual_drag_avoided > 0);
    assert.ok(r.summary.horizon_drag_avoided > r.summary.annual_drag_avoided);
  });
});

describe("asset-location: 2-way fallback (no Roth/Traditional split yet)", () => {
  const r = locateAssets(holds, { capacities: { ira: 400_000, taxable: 1_100_000 }, sleeveUsd });
  it("falls back to a combined tax-advantaged bucket and flags it", () => {
    assert.equal(r.three_way, false);
    assert.match(r.summary.note, /Roth \+ Traditional/);
    assert.ok(r.rows.every((x) => x.suggested === "tax-advantaged" || x.suggested === "taxable"));
  });
  it("shelters the highest-drag name first", () => {
    assert.equal(r.rows.find((x) => x.ticker === "NEE").suggested, "tax-advantaged"); // NEE: diversifier + tactical → highest drag
  });
});
