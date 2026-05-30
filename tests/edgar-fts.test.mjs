import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFtsHits, rankProxies } from "../scripts/lib/edgar-fts.mjs";

const fixture = {
  hits: { hits: [
    { _source: { display_names: ["Lockheed Martin Corp (LMT) (CIK 0000936468)"] } },
    { _source: { display_names: ["Iridium Communications Inc. (IRDM) (CIK 0001418819)"] } },
    { _source: { display_names: ["Lockheed Martin Corp (LMT) (CIK 0000936468)"] } },
    { _source: { display_names: ["No Ticker LLC (CIK 0000000001)"] } },
  ] },
};

describe("edgar-fts: discover exposed public proxies from filing mentions", () => {
  const out = parseFtsHits(fixture);
  it("tallies mentions per ticker, most-mentioned first", () => {
    assert.equal(out[0].ticker, "LMT"); assert.equal(out[0].mentions, 2);
    assert.equal(out.find((x) => x.ticker === "IRDM").mentions, 1);
  });
  it("skips entries without a ticker", () => {
    assert.ok(!out.some((x) => /No Ticker/.test(x.company)));
  });
  it("is safe on empty/garbage", () => assert.deepEqual(parseFtsHits({}), []));
});

describe("edgar-fts: rank proxies by SPECIFICITY (TF-IDF), not raw mentions", () => {
  // BIGCO is a diversified conglomerate: it shows up for every chokepoint (boilerplate),
  // so it's a WEAK proxy. PURE only shows up for one chokepoint repeatedly → strong proxy.
  const chokepoints = [
    { id: "a", discovered: [{ ticker: "BIGCO", company: "Big Co", mentions: 10 }, { ticker: "PURE", company: "Pure Play", mentions: 3 }] },
    { id: "b", discovered: [{ ticker: "BIGCO", company: "Big Co", mentions: 9 }, { ticker: "X", company: "X Inc", mentions: 4 }] },
    { id: "c", discovered: [{ ticker: "BIGCO", company: "Big Co", mentions: 8 }] },
  ];
  const ranked = rankProxies(chokepoints);
  const a = ranked.find((c) => c.id === "a");

  it("ranks the specific pure-play above the ubiquitous megacap despite fewer mentions", () => {
    assert.equal(a.discovered[0].ticker, "PURE"); // beats BIGCO even though BIGCO has 10 vs 3 mentions
    assert.ok(a.discovered[0].score > a.discovered[1].score);
  });
  it("flags a ticker appearing across many chokepoints as generic (weaker proxy)", () => {
    const big = a.discovered.find((d) => d.ticker === "BIGCO");
    assert.equal(big.generic, true);
    assert.equal(a.discovered.find((d) => d.ticker === "PURE").generic, false);
  });
  it("attaches a 0..1 score and preserves mentions/company", () => {
    const p = a.discovered.find((d) => d.ticker === "PURE");
    assert.ok(p.score > 0 && p.score <= 1); assert.equal(p.mentions, 3); assert.equal(p.company, "Pure Play");
  });
  it("is safe on empty input", () => assert.deepEqual(rankProxies([]), []));
  it("does not mutate the input", () => {
    const before = JSON.stringify(chokepoints);
    rankProxies(chokepoints);
    assert.equal(JSON.stringify(chokepoints), before);
  });
});
