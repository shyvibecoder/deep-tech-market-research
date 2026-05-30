import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFtsHits } from "../scripts/lib/edgar-fts.mjs";

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
