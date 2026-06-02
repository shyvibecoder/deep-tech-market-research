import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relativeStrength, deRatingSignal, tickerRelStrength } from "../scripts/lib/derating.mjs";

describe("derating: tickerRelStrength (per-scarcity rs → per-ticker mean for the entry read)", () => {
  const scarcities = [
    { id: "a", tickers: ["CEG", "GEV"] },
    { id: "b", tickers: ["GEV", "MP"] },
    { id: "c", tickers: ["XYZ"] }, // no signal → excluded
  ];
  const signals = { a: { rs: -0.12 }, b: { rs: 0.20 }, c: {} };
  it("averages rs across the baskets a ticker belongs to", () => {
    const r = tickerRelStrength(scarcities, signals);
    assert.equal(r.CEG, -0.12);          // only in a
    assert.equal(r.GEV, 0.04);           // mean(-0.12, 0.20)
    assert.equal(r.MP, 0.20);            // only in b
  });
  it("omits tickers whose scarcity has no finite rs", () => {
    assert.ok(!("XYZ" in tickerRelStrength(scarcities, signals)));
  });
  it("empty inputs → empty map (no crash)", () => assert.deepEqual(tickerRelStrength(null, null), {}));
});

// True-alpha signal: operationalize the thesis claim — crowded theses DE-RATE first
// (relative weakness vs the deep-tech build-out complex), under-priced ones INFLECT (relative
// strength). Relative strength = scarcity-basket momentum minus the complex's.
describe("derating: relative strength vs the complex", () => {
  it("is the scarcity-basket mean momentum minus the complex", () => {
    assert.equal(relativeStrength([0.05, 0.03], 0.02), 0.02);
  });
  it("returns null without inputs", () => {
    assert.equal(relativeStrength([], 0.02), null);
    assert.equal(relativeStrength([0.05], null), null);
  });
});

describe("derating: signal (the alpha read)", () => {
  it("flags a CROWDED thesis rolling over relative to the complex → reduce", () => {
    const s = deRatingSignal("crowded", -0.05);
    assert.equal(s.flag, "de-rating"); assert.equal(s.action, "reduce");
  });
  it("flags an UNDER-priced thesis gaining relative strength → accumulate", () => {
    const s = deRatingSignal("low", 0.05);
    assert.equal(s.flag, "inflecting"); assert.equal(s.action, "accumulate");
  });
  it("stays quiet when crowded-but-strong or cheap-but-weak (no false signal)", () => {
    assert.equal(deRatingSignal("crowded", 0.05).flag, "none");
    assert.equal(deRatingSignal("low", -0.05).flag, "none");
    assert.equal(deRatingSignal("high", null).flag, "none");
  });
});
