// Options fair-value evaluation (pure ESM, no deps — runs in the browser and Node).
// Purpose: before paying for any option, check the price is FAIR — by backing out
// its implied volatility and comparing to the underlying's RECENT REALIZED vol
// (which the scanner already computes). Rich/cheap is judged on the IV-vs-realized
// ratio with coarse, economically-motivated bands (a normal variance-risk premium
// makes options trade a bit above realized) — not a fitted model.
//
// Not financial advice. Realized vol is backward-looking; real option prices also
// carry event/skew/term premia. This is a sanity check, not a pricing oracle.

// Standard normal CDF/PDF (Abramowitz-Stegun 7.1.26 erf approximation).
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
const normPdf = (x) => 0.3989422804014327 * Math.exp(-x * x / 2);

// Black-Scholes-Merton price (q = continuous dividend yield). T in years.
export function bsPrice({ type, S, K, T, r = 0.04, sigma, q = 0 }) {
  if (T <= 0 || sigma <= 0) return Math.max(0, type === "put" ? K - S : S - K);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "put") return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
  return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

export function bsGreeks({ type, S, K, T, r = 0.04, sigma, q = 0 }) {
  if (T <= 0 || sigma <= 0) return { delta: null, gamma: null, vega: null, theta: null };
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * sq);
  const d2 = d1 - sigma * sq;
  const delta = type === "put" ? Math.exp(-q * T) * (normCdf(d1) - 1) : Math.exp(-q * T) * normCdf(d1);
  const gamma = Math.exp(-q * T) * normPdf(d1) / (S * sigma * sq);
  const vega = S * Math.exp(-q * T) * normPdf(d1) * sq / 100; // per 1 vol-point
  const term = -(S * Math.exp(-q * T) * normPdf(d1) * sigma) / (2 * sq);
  const theta = (type === "put"
    ? term + q * S * Math.exp(-q * T) * normCdf(-d1) + r * K * Math.exp(-r * T) * normCdf(-d2)
    : term - q * S * Math.exp(-q * T) * normCdf(d1) - r * K * Math.exp(-r * T) * normCdf(d2)) / 365; // per day
  return { delta, gamma, vega, theta };
}

// Implied vol by bisection (robust). Returns null if price is below intrinsic / no solution.
export function impliedVol({ type, S, K, T, r = 0.04, price, q = 0 }) {
  const intrinsic = Math.max(0, type === "put" ? K * Math.exp(-r * T) - S * Math.exp(-q * T) : S * Math.exp(-q * T) - K * Math.exp(-r * T));
  if (!(price > 0) || T <= 0 || price < intrinsic - 1e-6) return null;
  let lo = 1e-4, hi = 5;
  if (bsPrice({ type, S, K, T, r, sigma: hi, q }) < price) return null; // price too high to solve
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice({ type, S, K, T, r, sigma: mid, q });
    if (Math.abs(p - price) < 1e-6) return mid;
    if (p > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Verdict bands on IV / realized-vol (coarse, economically motivated):
//  < 0.95 cheap · 0.95–1.35 fair (normal variance premium) · > 1.35 rich.
export function fairnessVerdict(ivToRealized) {
  if (ivToRealized == null) return { verdict: "unknown", reason: "could not solve implied vol" };
  if (ivToRealized < 0.95) return { verdict: "cheap", reason: "IV below recent realized vol" };
  if (ivToRealized <= 1.35) return { verdict: "fair", reason: "IV within a normal variance-risk premium of realized" };
  return { verdict: "rich", reason: "IV well above realized vol — paying up for premium" };
}

// Full evaluation. refVol = the underlying's recent realized vol (e.g. signals vol_1y).
export function evaluateOption({ type, S, K, daysToExpiry, r = 0.04, marketPrice, q = 0, refVol }) {
  const T = Math.max(daysToExpiry, 0) / 365;
  const intrinsic = Math.max(0, type === "put" ? K - S : S - K);
  const iv = impliedVol({ type, S, K, T, r, price: marketPrice, q });
  const ivToRealized = iv != null && refVol ? iv / refVol : null;
  const fair = refVol ? bsPrice({ type, S, K, T, r, sigma: refVol, q }) : null;
  const { verdict, reason } = fairnessVerdict(ivToRealized);
  const greeks = iv != null ? bsGreeks({ type, S, K, T, r, sigma: iv, q }) : {};
  const notes = [];
  if (marketPrice < intrinsic - 1e-6) notes.push("market price below intrinsic — check inputs");
  if (daysToExpiry < 7) notes.push("very short-dated: IV is noisy");
  if (refVol == null) notes.push("no realized-vol reference — fairness is indeterminate");
  return {
    type, S, K, days: daysToExpiry, T, intrinsic: +intrinsic.toFixed(2),
    market_price: marketPrice,
    implied_vol: iv == null ? null : +(iv * 100).toFixed(1),
    realized_vol: refVol == null ? null : +(refVol * 100).toFixed(1),
    iv_to_realized: ivToRealized == null ? null : +ivToRealized.toFixed(2),
    fair_value_at_realized: fair == null ? null : +fair.toFixed(2),
    edge_vs_fair: fair == null ? null : +(marketPrice - fair).toFixed(2),
    verdict, reason, greeks, notes,
  };
}

// Regime-driven, DEFINED-RISK options suggestion (no naked options, both accounts).
// Maps the timing posture (+ macro brake) to a structure with delta/DTE bands.
export function suggestOptionStructure(posture, { macroStressed = false } = {}) {
  if (macroStressed || posture === "defensive") return {
    stance: "hedge",
    structures: ["protective put or debit put spread, ~5-10% OTM", "collar if you already hold the shares"],
    rationale: "cut the left tail without selling the thesis",
    dte: "30-90d", delta: "put ~0.20-0.35",
  };
  if (posture === "caution") return {
    stance: "protect",
    structures: ["partial protective put / debit put spread on the most correlated cyclicals"],
    rationale: "tap the brakes, keep upside",
    dte: "30-90d", delta: "put ~0.15-0.25",
  };
  if (posture === "risk-on") return {
    stance: "accelerate",
    structures: ["long call / LEAPS for capped-downside leverage"],
    rationale: "leveraged upside vs. buying more shares, with defined risk",
    dte: "90-365d", delta: "call ~0.25-0.40",
  };
  return { stance: "none", structures: ["no options action — follow the DCA calendar"], rationale: "neutral regime", dte: "-", delta: "-" };
}
