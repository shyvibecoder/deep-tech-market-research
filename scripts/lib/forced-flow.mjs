// Forced-flow / neglect — ALPHA.md Edge 3. The most durable retail edge is buying what
// others are FORCED to sell (index deletions, tax-loss harvesting, fund liquidations,
// "uninvestable" screens) — mechanical selling unrelated to fundamentals. We don't have a
// reliable FREE feed of those events, so we detect their FOOTPRINT from the tape: a name
// deeply off its highs, below trend, with negative short momentum. The essential discipline:
// separate forced selling into an INTACT thesis (accumulate) from a genuinely broken one
// (avoid) — not every dip is a gift. Pure; no curve-fitting (round, documented constants).

// 0..1 magnitude of mechanical de-rating from the price footprint.
export function dislocation(q = {}) {
  if (!q || q.error) return null;
  const off = typeof q.pct_off_high === "number" ? q.pct_off_high : null; // ≤ 0
  const m1 = typeof q.mom_1m === "number" ? q.mom_1m : null;
  if (off == null && m1 == null) return null;
  let d = 0;
  if (off != null) d += Math.min(1, Math.max(0, -off) / 0.4) * 0.6;  // −40% off high → full 0.6 weight
  if (q.above_ma200 === false) d += 0.2;                            // below the 200-DMA trend
  if (m1 != null && m1 < 0) d += Math.min(1, -m1 / 0.2) * 0.2;      // −20% 1-month → full 0.2 weight
  return +Math.min(1, d).toFixed(3);
}

// Tax-loss-selling seasonality (free, calendar-derived): Nov–Dec losers get harvested
// (mechanical selling pressure), then rebound in January (the "January effect").
export function taxLossWindow(today) {
  const m = Number(String(today || "").slice(5, 7));
  if (m === 11 || m === 12) return "selling";
  if (m === 1) return "rebound";
  return null;
}

const INTACT_OPP = 55;     // a still-strong structural Opportunity score
const DISLOCATED = 0.5;    // meaningful mechanical de-rating

// Per-scarcity read: mean dislocation across its names + the seasonal overlay, classified
// against whether the structural thesis (Opportunity) is intact.
export function forcedFlowSignal({ quotes = {}, tickers = [], opportunity = null, today, minTickers = 2 } = {}) {
  const ds = (tickers || []).map((t) => dislocation(quotes[t])).filter((x) => x != null);
  const window = taxLossWindow(today);
  if (!ds.length) return { dislocation: null, window, intact: null, flag: "none", n: 0 };
  const d = +(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(3);
  const intact = opportunity != null && opportunity >= INTACT_OPP;
  let flag = "none";
  // P8: forced-flow is a BASKET signal — require corroboration across >=2 contributing tickers so it
  // can't fire off a single dislocated name (e.g. when the rest of the basket errored out). The
  // dislocation value is still reported for transparency; only the actionable flag is gated.
  if (ds.length >= minTickers) {
    if (d >= DISLOCATED && intact) flag = "accumulate";  // forced/neglect selling into an intact thesis → buy
    else if (d >= DISLOCATED && opportunity != null && !intact) flag = "broken"; // real deterioration → avoid
  }
  return { dislocation: d, window, intact, flag, n: ds.length };
}

// Overlay composition ("alpha → timing → cash"): forced-flow governs SELECTION (what to deploy
// into), the regime/timing overlay governs PACE (whether to deploy now). They must never
// contradict on screen. When timing has the brakes ON (defensive/caution or macro-stress), an
// "accumulate" is reframed as a deploy-ON-TRIGGER priority — not a buy-now call — so the two
// overlays stay ONE coherent system across scenarios (e.g. a crash: brakes on AND many intact
// names dislocated → "buy these WHEN the drawdown trigger releases dry powder", not "buy now").
export function reconcileWithTiming(ff, regime = {}) {
  if (!ff || ff.flag !== "accumulate") return ff;
  const brakesOn = regime.posture === "defensive" || regime.posture === "caution" || !!regime.macro_stressed;
  return {
    ...ff,
    subordinate_to_timing: brakesOn,
    guidance: brakesOn
      ? "Deploy-on-trigger priority: timing has the brakes on — don't buy now; favor this name when the drawdown trigger releases dry powder."
      : "Accumulate: timing permits — forced/neglect selling into an intact thesis.",
  };
}
