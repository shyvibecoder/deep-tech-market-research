import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { corroborate, num, isTradeable } from "../scripts/lib/marketdata.mjs";

describe("marketdata: plausibility guard (num)", () => {
  it("accepts positive finite numbers", () => assert.equal(num("123.45"), 123.45));
  it("rejects zero, negative, NaN, non-finite", () => {
    for (const bad of [0, -5, "abc", Infinity, null, undefined]) assert.equal(num(bad), null);
  });
});

describe("marketdata: cross-source corroboration", () => {
  it("is ok when sources agree within 3%", () => {
    const c = corroborate({ yahoo: 100, stooq: 101.5 });
    assert.equal(c.ok, true);
    assert.equal(c.n, 2);
  });
  it("flags when a source diverges >3% (synthetic/bad print)", () => {
    const c = corroborate({ yahoo: 100, stooq: 101.5, finnhub: 130 });
    assert.equal(c.ok, false);
    assert.ok(c.spread > 0.03);
  });
  it("ok=null with a single source (cannot corroborate)", () => {
    assert.equal(corroborate({ yahoo: 100 }).ok, null);
  });
  it("drops implausible prices before computing", () => {
    const c = corroborate({ yahoo: 100, bad: -1 });
    assert.deepEqual(c.sources, ["yahoo"]);
  });
});

describe("marketdata: isTradeable", () => {
  it("treats real tickers as tradeable and placeholders/cash as not", () => {
    assert.equal(isTradeable("GEV"), true);
    assert.equal(isTradeable("CASH-MMF"), false);
    assert.equal(isTradeable("(private: SpaceX)"), false);
  });
});
