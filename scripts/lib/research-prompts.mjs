// Research LLM prompts — VERSIONED so they improve over time and we can tell which
// prompt version produced which proposal (and whether newer prompts are better-
// calibrated, judged by the scorecard). The research loop re-derives each scarcity's
// priced_in/bind_window/confidence from current evidence; prompts are anchored to the
// objective and the F9 ownership rule (the bot may NEVER touch thesis/tickers).
//
// CHANGELOG (why each version is better — "prompts get better and better"):
//   v1 — initial deep-dive → red-team → synthesis, F9-anchored, tilt-hit-rate prior.
//   v2 — calibrate on the MATCHING call type: the bot proposes priced_in, which drives
//        the de-rating/inflecting (relative) signal, so the prior now uses the alpha-edge
//        hit-rate (by_signal) when it exists — the accuracy of the exact judgment it's
//        making — instead of the per-name tilt hit-rate it has no control over.
export const RESEARCH_PROMPT_VERSION = 2;

const OBJECTIVE = "Objective: maximize 10-year return while keeping max drawdown < 35% (best Calmar/Sortino).";
const OWNERSHIP = "You may ONLY propose: priced_in (low|medium|high|crowded), bind_window (now|2027|2028-29|2030+|physics-floor), non_consensus (bool), confidence (0..1), rationale, sources[]. NEVER change thesis, tickers, id, or sector.";

// Calibrate on the call type the bot actually makes. priced_in → de-rating/inflecting,
// which is graded RELATIVE to the complex (scorecard.by_signal). Prefer that accuracy; it
// is the closest mirror of this judgment. Fall back to the per-name tilt hit-rate, then to
// a modest default. The whole point: don't claim confidence the matching record can't support.
const calib = (sc) => {
  const bs = sc?.by_signal;
  const n = (bs?.underperform?.n || 0) + (bs?.outperform?.n || 0);
  if (n > 0) {
    const hits = (bs.underperform?.hits || 0) + (bs.outperform?.hits || 0);
    return `Calibration prior: the system's OWN de-rating/inflecting (relative-vs-complex) calls — the same priced_in judgment you are making — have been right ${Math.round((hits / n) * 100)}% of the time over ${n} resolved calls. Be humble accordingly; do not assert high confidence this matching track record can't support.`;
  }
  if (sc?.hit_rate != null)
    return `Calibration prior: no relative calls have resolved yet; the related per-name tilt hit-rate is ${(sc.hit_rate * 100).toFixed(0)}% over ${sc.total?.n || 0} calls — keep confidence in line with that.`;
  return "Calibration prior: no resolved track record yet — keep confidence modest (<=0.6).";
};

export function deepDivePrompt(scarcity, evidence = {}, scorecard = null) {
  return [
    `You are a structural-tech-scarcity research analyst. ${OBJECTIVE}`,
    `Reassess ONE scarcity from current evidence and propose updated fields as STRICT JSON only.`,
    OWNERSHIP, calib(scorecard),
    `Current state: ${JSON.stringify({ id: scarcity.id, scarcity: scarcity.scarcity, priced_in: scarcity.priced_in, bind_window: scarcity.bind_window, non_consensus: scarcity.non_consensus, thesis: scarcity.thesis })}`,
    `Evidence (quotes/de-rating/news/filings): ${JSON.stringify(evidence).slice(0, 8000)}`,
    `Output JSON: {"priced_in":...,"bind_window":...,"non_consensus":...,"confidence":0..1,"rationale":"...","sources":["..."]}`,
  ].join("\n");
}

export function redTeamPrompt(scarcity, proposal) {
  return [
    `You are a skeptical red-team (a different model than the analyst). Attack this proposed reassessment of "${scarcity.scarcity}".`,
    `Which claims are over-stated, already-priced, unsupported by the evidence, or a momentum/whipsaw artifact? Should confidence be lower?`,
    `Proposal: ${JSON.stringify(proposal)}`,
    `Reply with 3-5 sharp bullets.`,
  ].join("\n");
}

export function synthesisPrompt(scarcity, proposal, critique) {
  return [
    `Reconcile the analyst proposal with the red-team critique into a FINAL proposed edit. ${OWNERSHIP}`,
    `If the critique lands, lower confidence or revert toward the current state.`,
    `Proposal: ${JSON.stringify(proposal)}`,
    `Critique: ${critique}`,
    `Output the same STRICT JSON shape only.`,
  ].join("\n");
}
