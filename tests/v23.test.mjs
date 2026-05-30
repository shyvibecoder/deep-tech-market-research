import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v23State, dislocationEntryWindow } from "../scripts/lib/v23.mjs";

// A FAITHFUL APPROXIMATION of the V2.3 overlay (Faber 200-DMA + 20-DMA fast re-entry +
// exit-only composite-stress AND-gate) for CROSS-CHECKING Puck's regime — not the exact
// production F+C Thrust rule. Same components Puck already uses, applied to QQQ.
describe("v23: state approximation on QQQ", () => {
  it("above the 200-DMA, calm → FULL (trend confirmed)", () => {
    const s = v23State({ above_ma200: true, above_ma20: true }, { macroStressed: false });
    assert.equal(s.state, "FULL");
  });
  it("below the 200-DMA but reclaimed the 20-DMA → FULL via fast re-entry", () => {
    const s = v23State({ above_ma200: false, above_ma20: true }, { macroStressed: false });
    assert.equal(s.state, "FULL"); assert.match(s.reasons.join(" "), /re-entry/i);
  });
  it("below both MAs → DEFENSIVE (to SGOV)", () => {
    assert.equal(v23State({ above_ma200: false, above_ma20: false }, {}).state, "DEFENSIVE");
  });
  it("composite-stress overlay is exit-only and ALWAYS wins (even in an uptrend)", () => {
    const s = v23State({ above_ma200: true, above_ma20: true }, { macroStressed: true });
    assert.equal(s.state, "DEFENSIVE"); assert.match(s.reasons.join(" "), /composite-stress|overlay/i);
  });
  it("no QQQ data → UNAVAILABLE (honest, not a guess)", () => {
    assert.equal(v23State(null, {}).state, "UNAVAILABLE");
    assert.equal(v23State({ error: "x" }, {}).state, "UNAVAILABLE");
  });
});

// The headline ask: WHEN should I take advantage of a dislocation? Answer = a thesis-intact
// dislocation EXISTS *and* timing has turned constructive (don't catch a falling knife).
describe("v23: dislocation entry window — when to act", () => {
  const FULL = { state: "FULL" }, DEF = { state: "DEFENSIVE" };
  it("OPEN: dislocation present AND trend re-confirmed (V2.3 FULL)", () => {
    const w = dislocationEntryWindow({ v23: FULL, regime: { posture: "neutral" }, drawdownFired: false, anyDislocation: true });
    assert.equal(w.window, "open"); assert.match(w.reason, /trend/i);
  });
  it("OPEN: dislocation present AND the drawdown trigger fired (deploy dry powder)", () => {
    const w = dislocationEntryWindow({ v23: DEF, regime: { posture: "defensive" }, drawdownFired: true, anyDislocation: true });
    assert.equal(w.window, "open"); assert.match(w.reason, /drawdown trigger/i);
  });
  it("OPEN: dislocation present AND Puck's 20-DMA fast re-entry firing", () => {
    const w = dislocationEntryWindow({ v23: DEF, regime: { posture: "caution", fast_reentry: true }, drawdownFired: false, anyDislocation: true });
    assert.equal(w.window, "open");
  });
  it("WAIT: dislocation present but still falling (DEFENSIVE, no re-entry, no trigger) → don't catch the knife", () => {
    const w = dislocationEntryWindow({ v23: DEF, regime: { posture: "defensive", fast_reentry: false }, drawdownFired: false, anyDislocation: true });
    assert.equal(w.window, "wait"); assert.match(w.reason, /falling|wait|turn/i);
  });
  it("NONE: nothing dislocated enough to act on", () => {
    assert.equal(dislocationEntryWindow({ v23: FULL, regime: {}, anyDislocation: false }).window, "none");
  });
});
