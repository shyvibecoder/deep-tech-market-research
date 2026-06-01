import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFtsHits, rankProxies, proxyGraph, searchFts } from "../scripts/lib/edgar-fts.mjs";

// EDGAR full-text search transiently 500s / 429s under rapid sequential requests (observed in a real
// scout run: 4 of 10 phrases failed with `fts 500`). A single transient error must NOT silently drop
// a whole phrase — searchFts retries 5xx/429 with backoff (fetch+sleep injected for offline tests).
describe("edgar-fts: searchFts is resilient to transient 5xx/429", () => {
  const okBody = { hits: { hits: [{ _source: { display_names: ["Alpha Inc (AAA) (CIK 0000000001)"] } }] } };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  it("retries on a transient 500 then succeeds", async () => {
    let n = 0;
    const fetchImpl = async () => (++n < 3 ? res(500) : res(200, okBody));
    const out = await searchFts("on allocation", { fetchImpl, sleepImpl: async () => {} });
    assert.equal(n, 3);                       // 2 failures + 1 success
    assert.equal(out[0].ticker, "AAA");
  });
  it("throws after exhausting retries on persistent 500 (so the caller records the error)", async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return res(500); };
    await assert.rejects(() => searchFts("took-or-pay", { fetchImpl, sleepImpl: async () => {}, tries: 3 }), /fts 500/);
    assert.equal(n, 3);
  });
  it("does NOT retry a non-retryable 4xx (e.g. 400) — fails fast", async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return res(400); };
    await assert.rejects(() => searchFts("x", { fetchImpl, sleepImpl: async () => {} }), /fts 400/);
    assert.equal(n, 1);
  });
});

describe("edgar-fts: proxy exposure graph (second-order / cross-chokepoint structure)", () => {
  // HUB is exposed to 3 chokepoints (a diversified bottleneck-complex play); PURE to one.
  const chokepoints = [
    { id: "a", discovered: [{ ticker: "HUB", company: "Hub Co", score: 0.4 }, { ticker: "PURE", company: "Pure", score: 0.9 }] },
    { id: "b", discovered: [{ ticker: "HUB", company: "Hub Co", score: 0.5 }] },
    { id: "c", discovered: [{ ticker: "HUB", company: "Hub Co", score: 0.3 }, { ticker: "X", company: "X", score: 0.6 }] },
  ];
  const g = proxyGraph(chokepoints);
  it("ranks the cross-chokepoint hub first by degree", () => {
    assert.equal(g[0].ticker, "HUB"); assert.equal(g[0].degree, 3);
    assert.deepEqual(g[0].chokepoints, ["a", "b", "c"]); assert.equal(g[0].hub, true); assert.equal(g[0].pure_play, false);
  });
  it("marks single-chokepoint names as pure plays", () => {
    const pure = g.find((n) => n.ticker === "PURE");
    assert.equal(pure.degree, 1); assert.equal(pure.pure_play, true); assert.equal(pure.hub, false);
  });
  it("carries average specificity across the chokepoints it touches", () => {
    assert.equal(g[0].avg_specificity, +((0.4 + 0.5 + 0.3) / 3).toFixed(3));
  });
  it("is safe on empty", () => assert.deepEqual(proxyGraph([]), []));
});

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
