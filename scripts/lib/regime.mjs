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

export const REGIME_VERSION = 2;

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
  const brakes = posture === "defensive" || posture === "caution";
  return {
    ira: brakes
      ? "Tactical sleeve — apply the brakes here: slow/stop deploys, raise cash (tax-free turnover)."
      : "Tactical sleeve — deploy/accelerate per the posture (tax-free turnover).",
    taxable: brakes
      ? "Buy-and-hold anchors — don't sell (tax); hedge with defined-risk options if desired."
      : "Buy-and-hold anchors — stay invested; ignore the timing dial here.",
  };
}

export function computeRegime(quotes, holdings, { macro, securities = {} } = {}) {
  const sigHoldings = compositeHoldings(holdings, securities);
  const composite_basis = sigHoldings.map((h) => h.ticker);
  const per_name = perNameTilt(quotes, holdings);
  const qs = sigHoldings.map((h) => quotes[h.ticker]).filter((q) => q && !q.error);

  // Per-name signal components, then portfolio-aggregate them.
  const vsMa200 = qs.map((q) => q.pct_vs_ma200).filter((x) => x != null);
  const mom = qs.map((q) => q.mom_12m).filter((x) => x != null);
  const offs = qs.map((q) => q.pct_off_high).filter((x) => x != null);
  const breadthArr = qs.map((q) => q.above_ma200).filter((x) => x != null);
  // Fast re-entry breadth: % of names that have reclaimed their 20-DMA (Daniel-Moskowitz fix).
  const ma20Arr = qs.map((q) => q.above_ma20).filter((x) => x != null);
  const breadth20 = ma20Arr.length ? ma20Arr.filter(Boolean).length / ma20Arr.length : null;
  // Volatility state: median(3m vol / 1y vol) across names; >1 = vol rising (de-risk).
  const volRatios = qs.map((q) => (q.vol_3m && q.vol_1y ? q.vol_3m / q.vol_1y : null)).filter((x) => x != null);

  const avgVsMa200 = mean(vsMa200);
  const avgMom = mean(mom);
  const avgOffHigh = mean(offs);
  const breadth = breadthArr.length ? breadthArr.filter(Boolean).length / breadthArr.length : null;
  const volState = volRatios.length ? volRatios.slice().sort((a, b) => a - b)[Math.floor(volRatios.length / 2)] : null;

  if (avgVsMa200 == null && avgMom == null && avgOffHigh == null) {
    return { version: REGIME_VERSION, posture: "unknown", risk_score: null, components: {},
      composite_basis, per_name, account_policy: accountPolicy("unknown"),
      macro_available: macro != null, macro_stressed: !!macro?.stressed, fast_reentry: false, confidence: "low", confidence_note: "no usable price history",
      action: "Insufficient price history — fall back to the DCA calendar.",
      note: "timing layer needs live quotes (runs in GitHub Actions)" };
  }

  // Each component -> 0..100 (50 = neutral). Round constants on purpose (anti-overfit).
  const trendScore = avgVsMa200 == null ? 50 : clamp(50 + avgVsMa200 * 250);     // +20% vs 200dma -> 100
  const momScore = avgMom == null ? 50 : clamp(50 + avgMom * 100);               // +50% 12m -> 100, -50% -> 0
  const ddScore = avgOffHigh == null ? 50 : clamp(100 + avgOffHigh * 250);       // at highs ->100, -20% ->50
  const volScore = volState == null ? 50 : clamp(100 - (volState - 1) * 150);    // vol flat ->100ish, +33% ->50
  const breadthScore = breadth == null ? 50 : breadth * 100;

  // Trend + absolute momentum are the load-bearing, best-evidenced signals (35%/30%);
  // drawdown + volatility are the brakes (15%/15%); breadth a 5% confirmation.
  const risk = Math.round(
    0.35 * trendScore + 0.30 * momScore + 0.15 * ddScore + 0.15 * volScore + 0.05 * breadthScore
  );

  // Honesty: the risk_score is NOT precise (O2). Down-rate confidence on thin samples
  // or when risk sits near a band edge (where a 1% move flips the posture / whipsaws).
  const nearEdge = Math.min(...[25, 45, 70].map((b) => Math.abs(risk - b)));
  const confidence = qs.length < 3 ? "low" : nearEdge < 5 ? "low" : qs.length < 6 ? "medium" : "high";
  const confidence_note = nearEdge < 5 ? "risk_score near a band edge — posture may whipsaw; treat as a coarse dial"
    : qs.length < 3 ? "thin sample — low confidence" : "";

  let posture = "neutral", action = "Stick to the DCA calendar; no acceleration.";
  if (risk >= 70) { posture = "risk-on"; action = "Uptrend + positive 12m momentum, contained vol — deploy on schedule / accelerate low-regret anchors."; }
  else if (risk < 25) { posture = "defensive"; action = "Brakes on — favor cash/dry powder; deploy only into the drawdown trigger."; }
  else if (risk < 45) { posture = "caution"; action = "Tap the brakes — slow deploys, build dry powder, wait for trend/vol to confirm."; }

  // --- Overlays (order matters): a broad fast-re-entry thrust CLEARS the deploy-brake; macro
  // stress is exit-only and ALWAYS wins (forces defensive, overriding the thrust below). ---
  // DESIGN (iterated): when ≥60% of names reclaim their 20-DMA — a broad thrust that is strong evidence
  // the downtrend has broken — clear a braked posture to NEUTRAL (not just one ladder notch, which left a
  // thrust out of a DEFENSIVE regime still braked → inert in exactly the sharp V-recoveries this is for).
  // Capped at neutral: it lifts the deploy-brake (pace) but never reaches risk-on, so it does NOT trigger
  // the overweight ACCELERATION in sizing (regimeFactor) — re-risk, not lever up.
  const fast_reentry = breadth20 != null && breadth20 >= 0.6;
  if (fast_reentry && (posture === "defensive" || posture === "caution")) {
    posture = "neutral";
    action = `Fast re-entry: ≥60% of names reclaimed their 20-DMA — breadth thrust clears the brake to neutral. ${action}`;
  }
  const macroStressed = !!macro?.stressed;
  const macroAvailable = macro != null; // R1: was the exit-only brake actually computed?
  if (macroStressed) {
    posture = "defensive";
    action = `Macro-stress overlay ON (${(macro.reasons || []).join("; ")}) — brakes: raise cash, deploy only into the drawdown trigger.`;
  }

  const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(0) + "%");
  return {
    version: REGIME_VERSION,
    posture, risk_score: risk, confidence, confidence_note, fast_reentry, macro_stressed: macroStressed, macro_available: macroAvailable,
    composite_basis, per_name, account_policy: accountPolicy(posture),
    components: {
      trend_vs_200dma: round1(avgVsMa200), momentum_12m: round1(avgMom),
      avg_off_high: round1(avgOffHigh), vol_state: volState == null ? null : +volState.toFixed(2),
      breadth_above_200dma: breadth == null ? null : +(breadth * 100).toFixed(0),
      breadth_above_20dma: breadth20 == null ? null : +(breadth20 * 100).toFixed(0),
    },
    macro: macro || null,
    options_suggestion: suggestOptionStructure(posture, { macroStressed }),
    action,
    basis: "trend(200-DMA)+abs-momentum(12m)+vol-state+drawdown, +20-DMA fast re-entry +VIX/HY macro overlay; see REGIME.md",
    note: `trend ${pct(avgVsMa200)} vs 200-DMA · 12m mom ${pct(avgMom)} · ${pct(avgOffHigh)} from highs · vol ${volState == null ? "n/a" : volState.toFixed(2) + "x"} · breadth200 ${pct(breadth)} · breadth20 ${pct(breadth20)}${macroStressed ? " · MACRO-STRESS" : (macroAvailable ? "" : " · ⚠ macro overlay unavailable")}`,
  };
}

const clamp = (x) => Math.max(0, Math.min(100, x));
const round1 = (x) => (x == null ? null : +(x * 100).toFixed(1));
