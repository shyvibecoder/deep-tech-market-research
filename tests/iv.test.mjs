import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAtmIv } from "../scripts/lib/iv.mjs";

const chain = (spot) => ({
  optionChain: { result: [{
    quote: { regularMarketPrice: spot },
    options: [{
      calls: [{ strike: 90, impliedVolatility: 0.50 }, { strike: 100, impliedVolatility: 0.40 }, { strike: 110, impliedVolatility: 0.45 }],
      puts:  [{ strike: 90, impliedVolatility: 0.52 }, { strike: 100, impliedVolatility: 0.42 }, { strike: 110, impliedVolatility: 0.47 }],
    }],
  }] },
});

describe("iv: parse ATM implied vol from a Yahoo options chain", () => {
  it("averages the nearest-strike call & put IV", () => {
    // spot 100 → nearest strike 100 → (0.40 + 0.42)/2 = 0.41
    assert.equal(parseAtmIv(chain(100), 100), 0.41);
  });
  it("uses the chain's own spot when none is passed", () => {
    assert.equal(parseAtmIv(chain(110)), 0.46); // nearest 110 → (0.45+0.47)/2
  });
  it("returns null on an empty/garbage chain", () => {
    assert.equal(parseAtmIv({}, 100), null);
    assert.equal(parseAtmIv({ optionChain: { result: [{ options: [] }] } }, 100), null);
  });
});
