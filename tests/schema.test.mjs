import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePortfolio, validateScarcities, validateSignals, validatePositions, validateSecurities } from "../scripts/lib/schema.mjs";

describe("schema: portfolio", () => {
  const ok = { schema_version: 1, sleeve_usd: 1, total_portfolio_usd: 2, accounts: { ira: 1, taxable: 1 }, holdings: [{ ticker: "MU", name: "Micron", account: "ira", target_usd: 1, weight: 0.1, tier: "B", role: "x" }] };
  it("passes a well-formed file", () => assert.equal(validatePortfolio(ok).length, 0));
  it("rejects a bad account enum", () => assert.ok(validatePortfolio({ ...ok, holdings: [{ ...ok.holdings[0], account: "roth" }] }).some((e) => /account/.test(e))));
  it("rejects an unknown schema_version", () => assert.ok(validatePortfolio({ ...ok, schema_version: 99 }).some((e) => /schema_version/.test(e))));
});

describe("schema: signals quotes contract", () => {
  const base = { schema_version: 1, scanned_at: new Date().toISOString(), quotes: {}, trigger_status: {}, digest: "", errors: [] };
  it("passes resolved (price) / errored / null quotes", () => {
    assert.equal(validateSignals({ ...base, quotes: { A: { price: 1 }, B: { error: "x" }, C: null } }).length, 0);
  });
  it("rejects a quote with neither price nor error", () => {
    assert.ok(validateSignals({ ...base, quotes: { A: {} } }).some((e) => /price.*error/.test(e)));
  });
});

describe("schema: scarcities enums + optional fields", () => {
  const s = { schema_version: 1, scarcities: [{ id: "x", sector: "Energy", scarcity: "y", bind_window: "now", priced_in: "high", durability: "high", substitution_risk: "low", tickers: [], non_consensus: true, thesis: "t" }] };
  it("passes valid + accepts confidence/last_reviewed", () => {
    assert.equal(validateScarcities({ ...s, scarcities: [{ ...s.scarcities[0], confidence: 0.7, last_reviewed: "2026-05-30" }] }).length, 0);
  });
  it("rejects a bad bind_window and out-of-range confidence", () => {
    assert.ok(validateScarcities({ ...s, scarcities: [{ ...s.scarcities[0], bind_window: "2040" }] }).length > 0);
    assert.ok(validateScarcities({ ...s, scarcities: [{ ...s.scarcities[0], confidence: 2 }] }).some((e) => /confidence/.test(e)));
  });
});

describe("schema: positions + securities", () => {
  it("validates positions types", () => {
    assert.equal(validatePositions({ positions: { MU: { shares: 10, cost_basis: 80 } } }).length, 0);
    assert.ok(validatePositions({ positions: { MU: { shares: "x" } } }).some((e) => /shares/.test(e)));
  });
  it("validates securities type enum", () => {
    assert.equal(validateSecurities({ securities: { MU: { type: "stock" } } }).length, 0);
    assert.ok(validateSecurities({ securities: { X: { type: "crypto" } } }).some((e) => /type/.test(e)));
  });
});
