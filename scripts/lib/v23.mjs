// V2.3 "F+C Thrust" cross-check — a FAITHFUL REPLICA of the owner's canonical production rule
// (web/src/lib/strategy/faber-crash-thrust.ts + FABER-CRASH-STRATEGY.md), recomputed here on
// QQQ as an independent cross-check for Puck's regime. Checked once daily; always holds exactly
// one instrument (QLD 2× or SGOV). Pure.
//
// Signals (QQQ daily closes):
//   TREND     = close > 200-day SMA                                   (Faber 2007)
//   CRASH_OFF = trailing 252-day return < 0  AND  60-day annualized vol > 25%  (Daniel-Moskowitz 2016)
//   THRUST    = close > 20-day SMA  AND  20-day SMA today > 20-day SMA 10 trading days ago
// Ladder (first match wins): CRASH_OFF→SGOV ; else TREND→QLD ; else THRUST→QLD ; else SGOV.
// V2.3 overlay (exit-only): if the ladder picked QLD AND COMPOSITE_STRESS → force SGOV.
//   COMPOSITE_STRESS = VIX/VIX3M ≥ 1.0 for 3 consecutive days  AND  HY-velocity (20-day change in
//   −log(HYG)) in the top 5% of its trailing 252-day distribution. Missing/synthetic inputs ⇒ overlay
//   suppressed (refuses to act on fake data); the underlying V2.2 ladder decision stands.
//
// NOTE: Thrust's 20d/10d-slope params are not from a published paper (unlike 200-DMA / 252-day /
// 60-day-25%-vol), so it is the most parameter-exposed variant — plain Faber+Crash is the
// production default; F+C Thrust + this overlay is what's forward-tracked. Puck adds NO leverage:
// a 2× QLD sleeve would breach the −35% maxDD objective unless gated by full exit to cash.

// Shared, canonical SMA + annualized-vol (defined ONCE in technicals.mjs) so the live regime, the
// backtest and this cross-check provably use the same math — no drift across copies (audit C1/C2).
import { sma, annualizedVol } from "./technicals.mjs";
const annVol = (closes, n) => annualizedVol(closes, n);

export function v23Signals(closes) {
  if (!Array.isArray(closes) || closes.length < 211) return null; // 200-SMA + a 10-day slope lookback
  const price = closes[closes.length - 1];
  const sma200 = sma(closes, 200);
  const sma20 = sma(closes, 20);
  const sma20_10ago = sma(closes.slice(0, closes.length - 10), 20);
  const ret252 = closes.length >= 253 ? price / closes[closes.length - 253] - 1 : price / closes[0] - 1;
  const vol60 = annVol(closes, 60);
  return {
    trend: price > sma200,
    crash_off: ret252 < 0 && vol60 != null && vol60 > 0.25,
    thrust: price > sma20 && sma20_10ago != null && sma20 > sma20_10ago,
    detail: { price, sma200: +sma200.toFixed(2), sma20: +sma20.toFixed(2), ret252: +ret252.toFixed(4), vol60: vol60 == null ? null : +vol60.toFixed(3) },
  };
}

// The base F+C Thrust ladder (first match wins) — exactly the canonical decision order.
export function fcThrustLadder({ trend, crash_off, thrust }) {
  if (crash_off) return { instrument: "SGOV", rule: "crash" };
  if (trend) return { instrument: "QLD", rule: "trend" };
  if (thrust) return { instrument: "QLD", rule: "thrust" };
  return { instrument: "SGOV", rule: "cash" };
}

// --- V2.3 composite-stress overlay inputs (exit-only) ---
// VIX/VIX3M ≥ 1.0 for `days` consecutive sessions (term-structure backwardation).
// REQUIRES the two series to be DATE-ALIGNED (same trading days, equal length) — the caller aligns
// them (scan.mjs). If they aren't equal-length we can't trust positional comparison, so we SUPPRESS
// (return null) rather than compare stale bars across mismatched tails (audit: head-alignment bug).
export function termBackwardation(vixCloses, vix3mCloses, days = 3) {
  if (!Array.isArray(vixCloses) || !Array.isArray(vix3mCloses)) return null;
  if (vixCloses.length !== vix3mCloses.length) return null; // not aligned → suppress, don't guess
  const n = vixCloses.length;
  if (n < days) return null;
  for (let i = 0; i < days; i++) {
    const v = vixCloses[n - 1 - i], v3 = vix3mCloses[n - 1 - i];
    if (v == null || v3 == null || !(v3 > 0)) return null;
    if (v / v3 < 1.0) return false;
  }
  return true;
}

// HY-velocity = 20-day change in −log(HYG); elevated when today is in the top 5% of its trailing
// 252-day distribution. v_t = −log(HYG_t) − (−log(HYG_{t−win})) = log(HYG_{t−win} / HYG_t) > 0 when HYG falls.
export function hyVelocityElevated(hygCloses, { win = 20, lookback = 252, pct = 0.95 } = {}) {
  if (!hygCloses || hygCloses.length < win + lookback + 1) return null;
  const vel = [];
  for (let t = win; t < hygCloses.length; t++) {
    if (!(hygCloses[t] > 0) || !(hygCloses[t - win] > 0)) return null;
    vel.push(Math.log(hygCloses[t - win] / hygCloses[t]));
  }
  if (vel.length < lookback) return null;
  const today = vel[vel.length - 1];
  const sorted = vel.slice(-lookback).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * pct)];
  // Elevated = today is in the top-5% tail AND credit is actually WIDENING (velocity > 0 ⇔ HYG fell
  // over the 20-day window). The `> 0` floor kills two false positives the bare percentile produced:
  // (a) a dead-flat tape where threshold == today == 0, and (b) a credit-RALLY-then-flat tape where
  // the trailing distribution is all-negative so a flat today (0) sits "in the top 5%" but is not
  // stress at all. "HY credit widening fast" requires real widening, not merely the calmest reading.
  return today >= threshold && today > 0;
}

// Composite stress: BOTH conditions. Returns null (suppressed) if either input is uncomputable.
export function compositeStress({ vixCloses, vix3mCloses, hygCloses } = {}) {
  const term = termBackwardation(vixCloses, vix3mCloses);
  const hy = hyVelocityElevated(hygCloses);
  if (term == null || hy == null) return null;
  return term && hy;
}

// Full V2.3 state on QQQ. `compositeStress` is true/false/null (null ⇒ overlay suppressed).
export function v23State(closes, { compositeStress = null } = {}) {
  const sig = v23Signals(closes);
  if (!sig) return { state: "UNAVAILABLE", instrument: null, reasons: ["no/short QQQ series this run"], basis: "needs ~1y of QQQ closes" };
  const base = fcThrustLadder(sig);
  const reasons = [];
  if (base.rule === "crash") reasons.push("CRASH_OFF: 252-day return negative AND 60-day vol > 25% — to SGOV");
  else if (base.rule === "trend") reasons.push("TREND: QQQ above its 200-DMA — QLD (2×)");
  else if (base.rule === "thrust") reasons.push("THRUST: above a rising 20-DMA — fast re-entry, QLD (2×)");
  else reasons.push("no trend / no thrust / no crash — SGOV (cash)");

  let instrument = base.instrument, overlay_applied = false;
  if (base.instrument === "QLD" && compositeStress === true) {
    instrument = "SGOV"; overlay_applied = true;
    reasons.push("V2.3 composite-stress overlay ON (VIX-term 3d backwardation AND HY-velocity top-5%) — exit-only, force SGOV");
  } else if (base.instrument === "QLD" && compositeStress == null) {
    reasons.push("overlay suppressed (VIX/VIX3M/HYG inputs incomplete) — V2.2 ladder stands");
  }
  return {
    state: instrument === "QLD" ? "FULL" : "DEFENSIVE",
    instrument, rule: base.rule, overlay_applied,
    signals: { trend: sig.trend, crash_off: sig.crash_off, thrust: sig.thrust },
    detail: sig.detail, reasons, basis: "faithful F+C Thrust replica on QQQ",
  };
}

// WHEN to take advantage of a dislocation: a thesis-intact dislocation must EXIST *and* timing must
// have turned constructive — else you're catching a falling knife. Constructive triggers (any one):
// V2.3 trend re-confirmed (FULL), Puck's 20-DMA fast re-entry, or the drawdown trigger firing.
export function dislocationEntryWindow({ v23 = {}, regime = {}, drawdownFired = false, anyDislocation = false } = {}) {
  if (!anyDislocation) return { window: "none", reason: "nothing dislocated into an intact thesis right now." };
  const turns = [];
  if (drawdownFired) turns.push("the drawdown trigger fired — deploy dry powder");
  if (v23.state === "FULL") turns.push("V2.3 trend re-confirmed (FULL)");
  if (regime.fast_reentry) turns.push("Puck's 20-DMA fast re-entry is firing");
  if (turns.length) return { window: "open", reason: `Act: a thesis-intact dislocation is present AND timing has turned — ${turns.join("; ")}.`, triggers: turns };
  return { window: "wait", reason: "Hold: the dislocation is real and the thesis intact, but timing is still defensive (below trend, no re-entry, no drawdown trigger) — wait for the turn so you don't catch a falling knife." };
}
