// Market-regime / timing layer  —  "alpha from the thesis, timing from the tape."
//
// The scarcity research supplies the ALPHA (what to own). This layer answers the
// roadmap's timing question — when to deploy/go-all-in vs. "apply the brakes and
// get into cash" — and is deliberately grounded in INDEPENDENT, replicated academic
// findings rather than curve-fit backtests. Full rationale + citations: REGIME.md.
//
// Signals used (each robust out-of-sample, each a single obvious parameter):
//   1. Trend filter        price vs 200-DMA            — Faber (2007); Hurst-Ooi-Pedersen (2017)
//   2. Absolute momentum   trailing 12-month return    — Moskowitz-Ooi-Pedersen (2012)
//   3. Volatility state    realized 3m vol vs 1y vol   — Moreira & Muir (2017), vol-managed
//   4. Drawdown gate       distance from 52w high      — tail-risk control
//
// Design choices for THIS portfolio (high-beta, cyclical, ~1.0 internally correlated
// deep-tech build-out/electrification basket — see MASTER-THESIS):
//   • The job is DRAWDOWN/REGIME RISK CONTROL, which trend & vol rules are empirically
//     good at — not return prediction.
//   • Because the names move together, cross-sectional BREADTH is largely redundant, so
//     it is only a minor confirmation, not a primary input.
//   • Signals are combined with simple, equal-ish weights and round numbers to avoid
//     overfitting; whipsaw/"momentum-crash" risk (Daniel-Moskowitz 2016) is acknowledged.
// Not financial advice; a transparent risk dial, not a market call.

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

import { suggestOptionStructure } from "./options.mjs";
import { v23Signals } from "./v23.mjs";

export const REGIME_VERSION = 3; // v3: brake + re-entry ARE the F+C Thrust ladder (was a composite risk-score)

// Clean-composite: aggregate the regime signal over the theme ETFs (themselves
// diversified composites) instead of 19 noisy single names. Falls back to all
// holdings when there aren't enough ETFs.
export function compositeHoldings(holdings, securities = {}) {
  const etfs = holdings.filter((h) => securities[h.ticker]?.type === "etf");
  return etfs.length >= 3 ? etfs : holdings;
}

// Per-name signed time-series-momentum tilt (Moskowitz-Ooi-Pedersen): which names to
// lean into vs. trim, from the 12m momentum sign + the 200-DMA trend.
export function perNameTilt(quotes, holdings) {
  return holdings.map((h) => {
    const q = quotes[h.ticker];
    if (!q || q.error || q.mom_12m == null) return { ticker: h.ticker, account: h.account || null, tsmom: 0, above_200: null, tilt: "n/a" };
    const tsmom = q.mom_12m > 0 ? 1 : q.mom_12m < 0 ? -1 : 0;
    let tilt = "neutral";
    if (tsmom > 0 && q.above_ma200) tilt = "overweight";
    else if (tsmom < 0 && q.above_ma200 === false) tilt = "underweight";
    return { ticker: h.ticker, account: h.account || null, tsmom, above_200: q.above_ma200, tilt };
  });
}

function accountPolicy(posture) {
  const brakes = posture === "defensive"; // F+C Thrust: brakes = CRASH_OFF or below-trend-no-thrust → DEFENSIVE
  return {
    ira: brakes
      ? "Tactical sleeve — apply the brakes here: slow/stop deploys, raise cash (tax-free turnover)."
      : "Tactical sleeve — deploy/accelerate per the posture (tax-free turnover).",
    taxable: brakes
      ? "Buy-and-hold anchors — don't sell (tax); hedge with defined-risk options if desired."
      : "Buy-and-hold anchors — stay invested; ignore the timing dial here.",
  };
}

export function computeRegime(quotes, holdings, { macro, securities = {}, compositeCloses = null } = {}) {
  const sigHoldings = compositeHoldings(holdings, securities);
  const composite_basis = sigHoldings.map((h) => h.ticker);
  const per_name = perNameTilt(quotes, holdings); // per-name TSMOM tilt — SELECTION (kept; separate from the brake)
  const qs = sigHoldings.map((h) => quotes[h.ticker]).filter((q) => q && !q.error);

  // Aggregate per-name technicals — DISPLAYED CONTEXT ONLY (these no longer drive posture; the ladder does).
  const avgVsMa200 = mean(qs.map((q) => q.pct_vs_ma200).filter((x) => x != null));
  const avgMom = mean(qs.map((q) => q.mom_12m).filter((x) => x != null));
  const avgOffHigh = mean(qs.map((q) => q.pct_off_high).filter((x) => x != null));
  const breadthArr = qs.map((q) => q.above_ma200).filter((x) => x != null);
  const breadth = breadthArr.length ? breadthArr.filter(Boolean).length / breadthArr.length : null;
  const ma20Arr = qs.map((q) => q.above_ma20).filter((x) => x != null);
  const breadth20 = ma20Arr.length ? ma20Arr.filter(Boolean).length / ma20Arr.length : null;
  const volRatios = qs.map((q) => (q.vol_3m && q.vol_1y ? q.vol_3m / q.vol_1y : null)).filter((x) => x != null);
  const volState = volRatios.length ? volRatios.slice().sort((a, b) => a - b)[Math.floor(volRatios.length / 2)] : null;

  // THE TIMING ENGINE — the canonical F+C THRUST ladder (Faber 200-DMA trend + Daniel-Moskowitz 252-day-return
  // / 60-day-vol crash + rising-20-DMA THRUST re-entry), computed on the composite price series via the SAME
  // v23.mjs functions the backtest runs and the V2.3 cross-check replicates. ONE design, end to end. The brake
  // and the fast re-entry ARE this ladder — no separate composite risk-score, no breadth re-entry.
  const fc = (Array.isArray(compositeCloses) && compositeCloses.length >= 211) ? v23Signals(compositeCloses) : null;
  const macroStressed = !!macro?.stressed;
  const macroAvailable = macro != null;

  let posture, action, fast_reentry = false, fast_reentry_armed = false;
  if (!fc) {
    posture = "unknown";
    action = "Timing needs the composite price history (built in the scan) — fall back to the DCA calendar.";
  } else {
    fast_reentry_armed = fc.thrust; // a rising-20-DMA reclaim is in progress
    if (fc.crash_off) { posture = "defensive"; action = "Brakes on — raise cash, deploy only into the drawdown trigger (CRASH_OFF: trailing 252-day return negative AND 60-day vol > 25%)."; }
    else if (fc.trend) { posture = "risk-on"; action = "Deploy on schedule / accelerate low-regret anchors (TREND: the composite is above its 200-DMA)."; }
    else if (fc.thrust) { posture = "neutral"; fast_reentry = true; action = "Re-risk to neutral, resume deploys (THRUST fast re-entry: the composite reclaimed a RISING 20-DMA while still below its 200-DMA)."; }
    else { posture = "defensive"; action = "Brakes on — favor cash / dry powder (below the 200-DMA with no thrust and no crash)."; }
    // V2.3 composite-stress overlay (exit-only) — always wins, forces a full brake.
    if (macroStressed) { posture = "defensive"; fast_reentry = false; action = `Brakes on — raise cash, deploy only into the drawdown trigger (composite-stress overlay ON: ${(macro.reasons || []).join("; ")}).`; }
  }

  const confidence = !fc ? "low" : (qs.length >= 6 ? "high" : qs.length >= 3 ? "medium" : "low");
  const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(0) + "%");
  return {
    version: REGIME_VERSION,
    posture, fast_reentry, fast_reentry_armed, macro_stressed: macroStressed, macro_available: macroAvailable, confidence,
    composite_basis, per_name, account_policy: accountPolicy(posture),
    fc_thrust: fc ? { trend: fc.trend, crash_off: fc.crash_off, thrust: fc.thrust, detail: fc.detail } : null,
    components: {
      trend_vs_200dma: round1(avgVsMa200), momentum_12m: round1(avgMom),
      avg_off_high: round1(avgOffHigh), vol_state: volState == null ? null : +volState.toFixed(2),
      breadth_above_200dma: breadth == null ? null : +(breadth * 100).toFixed(0),
      breadth_above_20dma: breadth20 == null ? null : +(breadth20 * 100).toFixed(0),
    },
    macro: macro || null,
    options_suggestion: suggestOptionStructure(posture, { macroStressed, vix: macro?.vix ?? null }),
    action,
    basis: "F+C Thrust ladder (Faber 200-DMA trend + Daniel-Moskowitz 252d-return/60d-vol crash + rising-20-DMA thrust re-entry) on the composite, + exit-only composite-stress overlay — see v23.mjs / FABER-CRASH-STRATEGY.md",
    note: fc
      ? `TREND ${fc.trend ? "✓" : "✗"} · CRASH_OFF ${fc.crash_off ? "ON" : "off"} · THRUST ${fc.thrust ? "✓" : "✗"} (composite ${pct(avgVsMa200)} vs 200-DMA, ${pct(breadth)} of names above their 200-DMA)${macroStressed ? " · COMPOSITE-STRESS" : (macroAvailable ? "" : " · ⚠ macro overlay unavailable")}`
      : "awaiting composite price history (runs in the scan)",
  };
}

const round1 = (x) => (x == null ? null : +(x * 100).toFixed(1));
