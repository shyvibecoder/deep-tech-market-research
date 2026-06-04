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
    ? term - q * S * Math.exp(-q * T) * normCdf(-d1) + r * K * Math.exp(-r * T) * normCdf(-d2)
    : term + q * S * Math.exp(-q * T) * normCdf(d1) - r * K * Math.exp(-r * T) * normCdf(d2)) / 365; // per day
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
  // Downside skew: OTM puts (the tail-hedge case) trade RICHER than realized vol implies,
  // so "fair value @ realized" is a FLOOR, not the price you'll pay — don't budget off it.
  if (type === "put" && K < S) notes.push("OTM put: realized-vol fair value is a FLOOR — tail puts trade richer (downside skew + variance premium)");
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

// IV-richness band from spot VIX (the free, already-fetched implied-vol proxy). Rich premium argues
// for DEBIT SPREADS / selling-to-fund over outright long premium; cheap argues the reverse (audit C-H1
// O3: the structural suggestion must not ignore whether you're overpaying for vol).
export function ivBand(vix) {
  if (!Number.isFinite(vix) || vix <= 0) return null;
  if (vix >= 22) return "rich";
  if (vix <= 14) return "cheap";
  return "normal";
}
function ivNote(band, vix) {
  if (!band) return null;
  const v = `VIX ${vix.toFixed(1)}`;
  if (band === "rich") return `IV is RICH (${v}) — premium is expensive: prefer DEBIT SPREADS (cap the long leg by selling a further strike) or buying shares over outright long calls/puts; if you sell premium, do it defined-risk.`;
  if (band === "cheap") return `IV is CHEAP (${v}) — outright long premium (calls/LEAPS or protective puts) is attractively priced vs. spreads.`;
  return `IV is NORMAL (${v}).`;
}

// Regime-driven, DEFINED-RISK options suggestion (no naked options, both accounts), now IV-AWARE: the
// posture sets the stance; spot VIX sets whether to favor outright long premium vs. debit spreads.
export function suggestOptionStructure(posture, { macroStressed = false, vix = null } = {}) {
  const band = ivBand(vix);
  const withIv = (sug) => band ? { ...sug, iv_band: band, vix: +(+vix).toFixed(1), iv_note: ivNote(band, vix) } : sug;
  if (macroStressed || posture === "defensive") return withIv({
    stance: "hedge",
    structures: band === "rich"
      ? ["debit put spread ~5-10% OTM (puts are expensive — spread to cut cost)", "collar if you already hold the shares (sell a call to fund the put)"]
      : ["protective put or debit put spread, ~5-10% OTM", "collar if you already hold the shares"],
    rationale: "cut the left tail without selling the thesis",
    dte: "30-90d", delta: "put ~0.20-0.35",
  });
  if (posture === "caution") return withIv({
    stance: "protect",
    structures: ["partial protective put / debit put spread on the most correlated cyclicals"],
    rationale: "tap the brakes, keep upside",
    dte: "30-90d", delta: "put ~0.15-0.25",
  });
  if (posture === "risk-on") return withIv({
    stance: "accelerate",
    structures: band === "rich"
      ? ["call DEBIT SPREAD for defined, cheaper upside (long premium is rich here)", "or simply buy shares vs. paying up for calls"]
      : ["long call / LEAPS for capped-downside leverage"],
    rationale: "leveraged upside vs. buying more shares, with defined risk",
    dte: "90-365d", delta: "call ~0.25-0.40",
  });
  return withIv({ stance: "none", structures: ["no options action — follow the DCA calendar"], rationale: "neutral regime", dte: "-", delta: "-" });
}

// Tax tripwire (NOT a rules engine, NOT tax advice): a collar or short-call overlay on an
// APPRECIATED, LOW-BASIS lot in a TAXABLE account can (a) trigger a constructive sale under
// IRC §1259 — gain recognized NOW; (b) defer/disallow losses under the straddle rules §1092;
// (c) suspend the qualified-dividend holding period (poisoning QDI on dividend payers). The
// app's own account policy already routes the taxable sleeve to buy-and-hold, so this is the
// one place an options suggestion could quietly push the user into an expensive, irreversible
// move. Protective puts and debit put spreads do NOT raise §1259. Returns null if benign.
export function taxableHedgeWarning(sug) {
  if (!sug || !Array.isArray(sug.structures)) return null;
  const txt = sug.structures.join(" ").toLowerCase();
  if (!/collar|short call|covered call|sell.*call|risk reversal/.test(txt)) return null;
  return "⚠ Taxable account: a collar / short-call on a low-basis appreciated lot can trigger a constructive sale (IRC §1259 — taxable gain now), defer losses under the straddle rules (§1092), and suspend the qualified-dividend holding period. Confirm with your CPA before writing calls against taxable anchors. (Protective puts / debit put spreads do not raise §1259.)";
}
