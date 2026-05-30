import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { targetDeltas } from "../scripts/lib/sizing.mjs";

const holds = [
  { ticker: "GEV", account: "ira" }, { ticker: "MP", account: "ira" },
  { ticker: "ASML", account: "taxable" },
];
const tilt = (m) => Object.entries(m).map(([ticker, t]) => ({ ticker, tilt: t }));

describe("sizing: target-weight deltas (analysis → action)", () => {
  it("risk-on + overweight (IRA) → add", () => {
    const d = targetDeltas(holds, tilt({ GEV: "overweight" }), { posture: "risk-on" });
    const gev = d.find((x) => x.ticker === "GEV");
    assert.equal(gev.action, "add"); assert.equal(gev.delta_pct, 25);
  });
  it("does NOT add overweights when not risk-on (no accelerating into weakness)", () => {
    const d = targetDeltas(holds, tilt({ GEV: "overweight" }), { posture: "caution" });
    assert.equal(d.find((x) => x.ticker === "GEV").action, "hold");
  });
  it("trims underweights in any posture", () => {
    const d = targetDeltas(holds, tilt({ MP: "underweight" }), { posture: "defensive" });
    const mp = d.find((x) => x.ticker === "MP");
    assert.equal(mp.action, "trim"); assert.equal(mp.delta_pct, -25);
  });
  it("taxable sleeve always holds (buy-and-hold anchors)", () => {
    const d = targetDeltas(holds, tilt({ ASML: "overweight" }), { posture: "risk-on" });
    assert.equal(d.find((x) => x.ticker === "ASML").action, "hold (taxable anchor)");
  });
});
