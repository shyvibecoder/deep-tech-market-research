import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestOptionStructure } from "../scripts/lib/options.mjs";

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
