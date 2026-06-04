// PER-NAME ENTRY QUALITY — is NOW a good time to buy THIS name? Pure (browser + Node), advisory.
//
// The regime/dislocation card answers "deploy in general?" at the COMPOSITE level. This differentiates per
// name: a thesis-intact name that's pulled back, still in its uptrend, gaining relative strength, and not
// expensive is a GOOD entry; one that just ran up, is stretched, or richly valued should be STAGED (DCA'd)
// rather than bought all at once. We blend the legs we already have — dislocation, trend, momentum,
// relative-strength (the alpha signal), and valuation (when corroborated data exists) — into one 0–100 score
// + a label, and a staging split (deploy-now vs DCA). Heuristic + transparent; it returns its reasons.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Each leg returns a sub-score in [0,1] (higher = better entry) or null when its input is missing (then it's
// dropped and the remaining legs are re-weighted). All legs assume the name's THESIS is already vetted (the
// plan only contains vetted names) — so "more off the highs" reads as a better entry, not a broken one,
// until it's both deeply down AND below trend.
function legs(inp) {
  const L = {};
  // Dislocation: a pullback is a better entry. Rises to ~1.0 around 25% off the 52w high, then we taper if
  // it's deeply down AND below the 200-DMA (possible thesis breakage, not a dip).
  if (Number.isFinite(inp.pctOffHigh)) {
    let s = clamp01(inp.pctOffHigh / 0.25);
    if (inp.pctOffHigh > 0.45 && inp.aboveMa200 === false) s *= 0.4; // deep + downtrend → caution
    L.dislocation = s;
  }
  // Trend acts as a GATE, not a reward: above the 200-DMA is just "fine" (neutral) — it shouldn't make a
  // name AT its highs look like a great entry; below it is a downtrend = a worse entry (falling knife).
  if (typeof inp.aboveMa200 === "boolean") L.trend = inp.aboveMa200 ? 0.55 : 0.2;
  // Momentum is an INVERTED-U: a healthy uptrend is a good entry, but BOTH a downtrend (no momentum) AND an
  // EXTENDED/PARABOLIC run (overbought → mean-reversion risk) are WORSE entries. Peaks ~+40% over 12m, then
  // decays steeply so an EXTENDED name reads "don't chase the top": +90% ≈ neutral (0.5), +100% drops BELOW
  // neutral, ~+140% bottoms out — and an absurd glitch just lands at the overbought floor. (The old slope of
  // 0.25 was far too shallow — a name up +250% scored like a flat one; audit M1.)
  if (Number.isFinite(inp.mom12m)) {
    const m = inp.mom12m;
    let s = m <= 0.4 ? clamp01(0.6 + m) : clamp01(1 - (m - 0.4)); // rise to +40%, then decay ~1:1 (overbought)
    if (Number.isFinite(inp.mom1m) && inp.mom1m > 0.15) s *= 0.7; // just ran up hard in a month → worse entry
    L.momentum = clamp01(s);
  }
  // Relative strength vs the complex (the alpha signal): inflecting (+) is a better entry than de-rating (−).
  if (Number.isFinite(inp.relStrength)) L.relstrength = clamp01(0.5 + inp.relStrength / 2);
  // Valuation (optional): cheap → better entry, rich → worse. From valuation.mjs's tag.
  if (inp.valuation && inp.valuation.tag) L.valuation = inp.valuation.tag === "cheap" ? 0.9 : inp.valuation.tag === "rich" ? 0.2 : 0.55;
  return L;
}

const WEIGHTS = { dislocation: 0.22, trend: 0.20, momentum: 0.20, relstrength: 0.18, valuation: 0.20 };

export function entryQuality(inp = {}) {
  const L = legs(inp);
  const present = Object.keys(L);
  if (!present.length) return { score: null, label: "n/a", reasons: ["no entry data"] };
  const wsum = present.reduce((a, k) => a + WEIGHTS[k], 0);
  const score = Math.round(100 * present.reduce((a, k) => a + WEIGHTS[k] * L[k], 0) / wsum);
  const label = score >= 66 ? "good" : score >= 40 ? "fair" : "stretched";
  const reasons = [];
  if (Number.isFinite(inp.pctOffHigh)) reasons.push(`${Math.round(inp.pctOffHigh * 100)}% off high`);
  if (typeof inp.aboveMa200 === "boolean") reasons.push(inp.aboveMa200 ? "above 200-DMA" : "below 200-DMA");
  if ("momentum" in L) reasons.push(`12m ${inp.mom12m >= 0 ? "+" : ""}${Math.round(inp.mom12m * 100)}%${inp.mom1m > 0.15 ? " (just ran up)" : inp.mom12m > 1 ? " (extended)" : ""}`);
  if (Number.isFinite(inp.relStrength)) reasons.push(inp.relStrength > 0.05 ? "inflecting vs complex" : inp.relStrength < -0.05 ? "de-rating vs complex" : "neutral vs complex");
  if (inp.valuation?.tag) reasons.push(inp.valuation.label || inp.valuation.tag);
  return { score, label, reasons, legs: L };
}

// Staging: how much to deploy NOW vs DCA, by entry label. A good entry leans in; a stretched one is mostly
// DCA'd so a lump-sum doesn't buy the top. Returns whole-dollar {now, dca} summing to amount.
export const STAGE = { good: 1.0, fair: 0.6, stretched: 0.34, "n/a": 1.0 };
export function stageBuy(label, amount) {
  const f = STAGE[label] ?? 1.0;
  const now = Math.round((amount || 0) * f);
  return { now, dca: Math.max(0, Math.round((amount || 0) - now)), now_frac: f };
}
