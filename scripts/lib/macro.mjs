// Macro-stress overlay (Timing v2) — exit-only, AND-gated. Forces a defensive posture
// ONLY when two independent, leading risk signals fire together (rare combined-signal):
//   1. VIX term-structure inverted  — front VIX >= VIX3M (backwardation = acute stress)
//   2. HY credit widening fast       — HYG ~1-month return <= -3% (spreads blowing out)
// Requiring a conjunction makes false positives rare; being exit-only makes it safe
// (it can only de-risk, never add). Adapted from the V2.3 composite-stress pattern;
// coarse, economically-motivated thresholds (not curve-fit). See REGIME.md.

const HY_VELOCITY = -0.03;   // HYG 1m return at/below this = fast HY widening
const TERM_INVERT = 1.0;     // VIX / VIX3M at/above this = backwardation

export function macroStress({ vix, vix3m, hygMom1m } = {}) {
  // Helm #1: the exit-only brake needs ALL inputs present. If ANY is missing, SUPPRESS it (available:
  // false) rather than evaluating a missing leg to false — "false on missing data" is a silent false-
  // negative (failing to de-risk when the feed is gone). Only an all-inputs-present read is confident;
  // the consumer marks the overlay UNAVAILABLE (not "calm") and falls back to the price-only regime.
  const missing = [vix == null && "VIX", (vix3m == null || !(vix3m > 0)) && "VIX3M", hygMom1m == null && "HYG"].filter(Boolean);
  if (missing.length) {
    return { stressed: false, available: false, suppressed: true, missing,
      term_inverted: null, hy_stressed: null, vix_term: null, hy_mom_1m: hygMom1m ?? null,
      reasons: [`macro overlay suppressed — missing input(s): ${missing.join(", ")}`] };
  }
  const term_inverted = vix / vix3m >= TERM_INVERT;
  const hy_stressed = hygMom1m <= HY_VELOCITY;
  const reasons = [];
  if (term_inverted) reasons.push(`VIX term-structure inverted (VIX ${(+vix).toFixed(1)} ≥ VIX3M ${(+vix3m).toFixed(1)})`);
  if (hy_stressed) reasons.push(`HY credit widening fast (HYG 1m ${(hygMom1m * 100).toFixed(1)}%)`);
  return {
    stressed: term_inverted && hy_stressed, // AND gate
    available: true, suppressed: false, missing: [],
    term_inverted, hy_stressed,
    vix_term: +(vix / vix3m).toFixed(3),
    hy_mom_1m: hygMom1m,
    reasons,
  };
}
