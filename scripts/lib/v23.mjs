// V2.3 cross-check + dislocation-entry timing.
//
// The owner runs a separate production strategy ("V2.3"): a LEVERAGED trend-follower —
// F+C Thrust on QLD (2× QQQ) ↔ SGOV — with a Faber 200-DMA trend filter, Daniel-Moskowitz
// crash break, 20-DMA fast re-entry override, and an EXIT-ONLY composite-stress overlay
// (VIX term-structure AND HY-velocity elevated). Puck is unleveraged and graded, but its
// regime layer is built from the SAME academic parts, so it can compute a faithful
// APPROXIMATION of the V2.3 state on QQQ as an independent cross-check. This is NOT the
// proprietary production rule — divergences between the two are the useful signal. Pure.
//
// Hard design rule carried from that strategy: any leveraged (QLD) sleeve must be gated by
// FULL EXIT to cash (SGOV), never merely de-risked a notch — 2× QQQ draws down 50–70% and
// would blow Puck's −35% maxDD objective otherwise. (Documented; Puck adds no leverage here.)

export function v23State(qqq, { macroStressed = false } = {}) {
  if (!qqq || qqq.error || qqq.above_ma200 == null) {
    return { state: "UNAVAILABLE", reasons: ["no QQQ trend data this run"], basis: "needs live QQQ quote" };
  }
  const reasons = [];
  // Exit-only composite-stress overlay ALWAYS wins (rare combined-signal days).
  if (macroStressed) {
    return { state: "DEFENSIVE", reasons: ["composite-stress overlay ON (VIX-term AND HY-velocity) — exit-only brake"], basis: "overlay" };
  }
  if (qqq.above_ma200) { reasons.push("QQQ above 200-DMA — Faber trend confirmed"); return { state: "FULL", reasons, basis: "trend" }; }
  // Below the 200-DMA: the 20-DMA fast re-entry override can keep it risk-on (Daniel-Moskowitz fix).
  if (qqq.above_ma20) { reasons.push("below 200-DMA but reclaimed 20-DMA — fast re-entry override"); return { state: "FULL", reasons, basis: "fast-reentry" }; }
  reasons.push("below 200-DMA and 20-DMA — crash break, rotate to SGOV");
  return { state: "DEFENSIVE", reasons, basis: "crash-break" };
}

// WHEN to take advantage of a dislocation: a thesis-intact dislocation must EXIST *and*
// timing must have turned constructive — otherwise you're catching a falling knife. The
// constructive triggers (any one): V2.3-style trend re-confirmed (FULL), Puck's 20-DMA fast
// re-entry firing, or the drawdown trigger releasing dry powder.
export function dislocationEntryWindow({ v23 = {}, regime = {}, drawdownFired = false, anyDislocation = false } = {}) {
  if (!anyDislocation) return { window: "none", reason: "nothing dislocated into an intact thesis right now." };
  const turns = [];
  if (drawdownFired) turns.push("the drawdown trigger fired — deploy dry powder");
  if (v23.state === "FULL") turns.push("V2.3-style trend re-confirmed (FULL)");
  if (regime.fast_reentry) turns.push("Puck's 20-DMA fast re-entry is firing");
  if (turns.length) {
    return { window: "open", reason: `Act: a thesis-intact dislocation is present AND timing has turned — ${turns.join("; ")}.`, triggers: turns };
  }
  return { window: "wait", reason: "Hold: the dislocation is real and the thesis intact, but timing is still defensive (below trend, no re-entry, no drawdown trigger) — wait for the turn so you don't catch a falling knife." };
}
