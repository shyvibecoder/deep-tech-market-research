import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestOptionStructure, taxableHedgeWarning } from "../scripts/lib/options.mjs";

// Posture -> a DEFINED-RISK options structure with delta/DTE bands. No naked options.
describe("options: regime-driven suggestion (defined-risk only)", () => {
  it("risk-on → long call / LEAPS (accelerate)", () => {
    const s = suggestOptionStructure("risk-on");
    assert.equal(s.stance, "accelerate");
    assert.match(s.structures.join(" "), /call|LEAPS/i);
  });
  it("defensive → protective put / put spread (hedge)", () => {
    const s = suggestOptionStructure("defensive");
    assert.equal(s.stance, "hedge");
    assert.match(s.structures.join(" "), /put/i);
  });
  it("caution → partial protection", () => {
    assert.equal(suggestOptionStructure("caution").stance, "protect");
  });
  it("neutral → no options action", () => {
    assert.equal(suggestOptionStructure("neutral").stance, "none");
  });
  it("macro stress forces a hedge even if posture isn't defensive", () => {
    assert.equal(suggestOptionStructure("neutral", { macroStressed: true }).stance, "hedge");
  });
  it("never suggests a naked/short option", () => {
    for (const p of ["risk-on", "neutral", "caution", "defensive"]) {
      const txt = suggestOptionStructure(p).structures.join(" ").toLowerCase();
      assert.ok(!/naked|short put|short call|sell.*(call|put)/.test(txt), `naked-ish in ${p}`);
    }
  });
});

// Tax tripwire: a collar/short-call on a taxable low-basis lot risks §1259/§1092/QDI.
describe("options: taxable hedge tax-warning gate", () => {
  it("warns on a collar (defensive posture suggests one)", () => {
    const w = taxableHedgeWarning(suggestOptionStructure("defensive"));
    assert.ok(w && /1259/.test(w), "defensive collar should trip the §1259 warning");
  });
  it("does NOT warn on a plain protective-put posture (caution: no short leg)", () => {
    assert.equal(taxableHedgeWarning(suggestOptionStructure("caution")), null);
  });
  it("does NOT warn on a long call (risk-on)", () => {
    assert.equal(taxableHedgeWarning(suggestOptionStructure("risk-on")), null);
  });
  it("is null-safe on junk input", () => {
    assert.equal(taxableHedgeWarning(null), null);
    assert.equal(taxableHedgeWarning({}), null);
  });
});
