import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegime } from "../scripts/lib/regime.mjs";

const q = (vsMa200, mom12, off, volRatio, aboveMa200, aboveMa20) => ({
  price: 1, pct_vs_ma200: vsMa200, mom_12m: mom12, pct_off_high: off,
  vol_3m: volRatio, vol_1y: 1, above_ma200: aboveMa200, above_ma20: aboveMa20,
});
const holds = (n) => Array.from({ length: n }, (_, i) => ({ ticker: "T" + i }));
const bull = { T0: q(0.15, 0.4, -0.03, 0.9, true, true), T1: q(0.12, 0.35, -0.04, 0.95, true, true) };
const bear = { T0: q(-0.15, -0.3, -0.35, 1.5, false, false), T1: q(-0.2, -0.4, -0.4, 1.6, false, false) };

describe("regime v2: exit-only macro-stress overlay", () => {
  it("forces DEFENSIVE in a bull tape when macro stress is active (overlay wins)", () => {
    const r = computeRegime(bull, holds(2), { macro: { stressed: true, reasons: ["x"] } });
    assert.equal(r.posture, "defensive");
    assert.ok(/macro/i.test(r.action + r.note));
  });
  it("does NOT change posture when macro stress is inactive", () => {
    const r = computeRegime(bull, holds(2), { macro: { stressed: false, reasons: [] } });
    assert.equal(r.posture, "risk-on");
  });
});

describe("regime v2: fast re-entry (20-DMA breadth) override", () => {
  it("upgrades a defensive base by one notch when 20-DMA breadth is strong", () => {
    // base is bearish, but most names have reclaimed their 20-DMA → re-risk one step
    const reclaim = { T0: q(-0.15, -0.3, -0.30, 1.2, false, true), T1: q(-0.18, -0.35, -0.32, 1.2, false, true) };
    const r = computeRegime(reclaim, holds(2));
    assert.equal(r.fast_reentry, true);
    assert.notEqual(r.posture, "defensive"); // bumped up out of defensive
  });
  it("macro stress beats fast re-entry (brakes win)", () => {
    const reclaim = { T0: q(-0.15, -0.3, -0.30, 1.2, false, true), T1: q(-0.18, -0.35, -0.32, 1.2, false, true) };
    const r = computeRegime(reclaim, holds(2), { macro: { stressed: true, reasons: ["x"] } });
    assert.equal(r.posture, "defensive");
  });
});
