import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toUsd } from "../scripts/lib/fx.mjs";

// F2b: convert a foreign-denominated amount to USD using CUR->USD rates.
describe("fx: convert to USD", () => {
  const rates = { EUR: 1.08, JPY: 0.0064, USD: 1 };
  it("passes USD through unchanged", () => assert.equal(toUsd(100, "USD", rates), 100));
  it("treats null/undefined currency as USD", () => assert.equal(toUsd(100, null, rates), 100));
  it("converts a known currency", () => assert.equal(toUsd(100, "EUR", rates), 108));
  it("returns null when the rate is unknown (so callers can skip+flag)", () => {
    assert.equal(toUsd(100, "GBP", rates), null);
  });
});
