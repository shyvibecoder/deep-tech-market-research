import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroStress } from "../scripts/lib/macro.mjs";

// Exit-only, AND-gated macro-stress overlay: defensive only when VIX term-structure
// is inverted (VIX >= VIX3M) AND high-yield credit is widening fast (HYG 1m <= -3%).
describe("macro: AND-gated stress overlay", () => {
  it("is stressed only when BOTH signals fire", () => {
    assert.equal(macroStress({ vix: 30, vix3m: 26, hygMom1m: -0.05 }).stressed, true);
  });
  it("is NOT stressed when only the VIX term-structure is inverted", () => {
    assert.equal(macroStress({ vix: 30, vix3m: 26, hygMom1m: -0.01 }).stressed, false);
  });
  it("is NOT stressed when only HY credit is widening", () => {
    assert.equal(macroStress({ vix: 16, vix3m: 20, hygMom1m: -0.06 }).stressed, false);
  });
  it("is NOT stressed in calm markets (contango + stable credit)", () => {
    assert.equal(macroStress({ vix: 14, vix3m: 18, hygMom1m: 0.01 }).stressed, false);
  });
  it("degrades gracefully with missing inputs", () => {
    assert.equal(macroStress({}).stressed, false);
    assert.equal(macroStress({ vix: 30 }).stressed, false);
  });
  it("reports which legs fired", () => {
    const m = macroStress({ vix: 30, vix3m: 26, hygMom1m: -0.05 });
    assert.equal(m.term_inverted, true);
    assert.equal(m.hy_stressed, true);
    assert.ok(m.reasons.length === 2);
  });
});

// Helm #1: the brake needs ALL inputs (VIX, VIX3M, HYG). If ANY is missing it must be SUPPRESSED
// (available:false) — not silently evaluate to "calm" (a false-negative: failing to de-risk when data
// is gone). Only the all-inputs-present case is a confident read.
describe("macro: suppress on any missing input (Helm #1)", () => {
  it("available:true only when all three inputs are present", () => {
    assert.equal(macroStress({ vix: 30, vix3m: 26, hygMom1m: -0.05 }).available, true);
  });
  it("available:false + suppressed when ANY input is missing (not a confident 'calm')", () => {
    for (const args of [{}, { vix: 30 }, { vix: 30, vix3m: 26 }, { vix3m: 26, hygMom1m: -0.05 }, { vix: 30, hygMom1m: -0.05 }]) {
      const m = macroStress(args);
      assert.equal(m.available, false, `should be unavailable: ${JSON.stringify(args)}`);
      assert.equal(m.suppressed, true);
      assert.equal(m.stressed, false);           // never fires when it couldn't be evaluated
      assert.ok(m.missing.length > 0);
    }
  });
  it("treats VIX3M<=0 as missing (no divide-by-zero / bogus ratio)", () => {
    assert.equal(macroStress({ vix: 30, vix3m: 0, hygMom1m: -0.05 }).available, false);
  });
});
