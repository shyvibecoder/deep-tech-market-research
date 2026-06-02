// CATALYST WATCH — automate the MANUAL triggers' conditions from evidence (news + SEC filings), judged by
// the committee, and turn a fired trigger into a portfolio-aware SUGGESTED action. ADVISORY ONLY (F9: the bot
// never trades or edits the book — a "fired" manual trigger is a high-confidence flag you confirm, and any
// plan edit is a PR you merge). Pure helpers here; the evidence fetch + committee call + PR draft live in the
// scanner / browser. Same anti-noise discipline as the auto triggers: corroboration + a 2-run confirmation,
// so one stale/wrong/maybe-manipulated headline can't "fire" a sell.

const uniq = (a) => [...new Set((a || []).filter(Boolean))];

// Combine N committee verdicts → a consensus status. Each verdict: { met:boolean, confidence:0..1, citations:[] }.
// Gates: MAJORITY of seats say met, CORROBORATED (≥minSources distinct citations — a filing or multiple
// sources, not one headline), and mean confidence ≥ minConfidence. A trigger only reaches "fired" when it was
// ALSO elevated on the PRIOR run (2-run confirmation via `prev`). Status ladder:
//   monitoring → approaching → likely-met → fired
export function catalystConsensus(verdicts, prev = null, { minConfidence = 0.6, minSources = 2 } = {}) {
  const v = (verdicts || []).filter((x) => x && typeof x.met === "boolean");
  if (!v.length) return { status: "monitoring", met: false, confidence: 0, citations: [], seats: 0 };
  const metSeats = v.filter((x) => x.met);
  const majorityMet = metSeats.length > v.length / 2;
  const confidence = +((metSeats.reduce((a, x) => a + (x.confidence || 0), 0) / (metSeats.length || 1))).toFixed(2);
  const citations = uniq(v.flatMap((x) => x.citations || []));
  const corroborated = citations.length >= minSources;
  const metNow = majorityMet && corroborated && confidence >= minConfidence;
  const prevElevated = !!prev && ["likely-met", "fired"].includes(prev.status);
  const status = metNow ? (prevElevated ? "fired" : "likely-met")
    : (majorityMet || confidence >= 0.4) ? "approaching" : "monitoring";
  return { status, met: metNow, confidence, citations, seats: v.length, corroborated };
}

// Is this status worth alerting on (issue/email)? Only a confirmed fire.
export const catalystFires = (c) => c?.status === "fired";

// Deterministic fallback suggestion (used when no LLM, or as the committee's grounding) — enriches the canned
// policy action with the live position context. The LLM draft (scanner) supersedes this when available.
export function suggestedActionFallback(trigger, { weightPct = null, regime = null } = {}) {
  const sz = Number.isFinite(weightPct) ? ` Current weight ~${(weightPct * 100).toFixed(1)}% of the sleeve.` : "";
  const reg = regime ? ` Regime: ${regime}.` : "";
  return `${trigger?.action || ""}${sz}${reg}`.trim();
}

// Which triggers does the catalyst engine evaluate from evidence? The MANUAL ones with a `watch` spec.
export function watchableTriggers(triggers) {
  return (triggers || []).filter((t) => t && t.type === "manual" && t.watch && Array.isArray(t.watch.queries) && t.watch.queries.length);
}
