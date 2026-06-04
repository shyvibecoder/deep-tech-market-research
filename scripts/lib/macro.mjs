// Macro-stress overlay — the EXACT V2.3 composite-stress rule (§23.D), exit-only and AND-gated.
// Forces a defensive posture ONLY when two independent leading risk signals fire together:
//   1. VTS — VIX term-structure backwardation: VIX/VIX3M ≥ 1.0 for 3 CONSECUTIVE trading days.
//   2. HV  — HY credit velocity: the 20-day change in −log(HYG) sits in the TOP 5% of its trailing
//            252-day distribution (an ADAPTIVE percentile, not a fixed return threshold).
// Both legs are the canonical rules implemented once in v23.mjs (`termBackwardation`,
// `hyVelocityElevated`) and reused here, so the live PORTFOLIO brake == the QLD/SGOV cross-check
// overlay by construction. Requiring a conjunction makes false positives rare (~2–3/yr); being
// exit-only makes it safe (it can only de-risk, never add). See REGIME.md / FABER-CRASH-STRATEGY.md.
//
// Staleness guard: each leg returns null when its inputs are missing or too short (VTS needs ≥3 bars
// of both VIX & VIX3M; HV needs ≥273 bars of HYG). ANY null ⇒ the WHOLE overlay is SUPPRESSED
// (available:false) rather than evaluated to a silent false-negative "calm" — the consumer marks the
// overlay UNAVAILABLE and falls back to the price-only ladder.

import { termBackwardation, hyVelocityElevated } from "./v23.mjs";

export function macroStress({ vixCloses, vix3mCloses, hygCloses } = {}) {
  const term = termBackwardation(vixCloses, vix3mCloses); // true/false/null — VIX/VIX3M ≥ 1.0 ×3 consecutive days
  const hy = hyVelocityElevated(hygCloses);               // true/false/null — 20d −log(HYG) velocity in top 5% of trailing 252d
  const missing = [
    term == null && "VIX/VIX3M(≥3 bars)",
    hy == null && "HYG(≥273 bars)",
  ].filter(Boolean);

  // Today's term ratio + spot VIX (the latter is the IV-richness proxy the options suggestion reads).
  const a = Array.isArray(vixCloses) ? vixCloses[vixCloses.length - 1] : null;
  const b = Array.isArray(vix3mCloses) ? vix3mCloses[vix3mCloses.length - 1] : null;
  const vix_term = a != null && b > 0 ? +(a / b).toFixed(3) : null;
  const vix = a != null && a > 0 ? +(+a).toFixed(2) : null;

  if (term == null || hy == null) {
    return {
      stressed: false, available: false, suppressed: true, missing,
      term_inverted: term, hy_stressed: hy, vix_term, vix,
      reasons: [`macro overlay suppressed — missing/short input(s): ${missing.join(", ")}`],
    };
  }
  const reasons = [];
  if (term) reasons.push(`VIX term-structure inverted ≥3 consecutive days (VIX/VIX3M ≥ 1.0; now ${vix_term})`);
  if (hy) reasons.push("HY credit velocity in the top 5% of its trailing year (20-day −log(HYG))");
  return {
    stressed: term && hy, // AND gate — the V2.3 conjunction
    available: true, suppressed: false, missing: [],
    term_inverted: term, hy_stressed: hy, vix_term, vix,
    reasons,
  };
}
