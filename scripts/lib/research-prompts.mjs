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
//   v3 — DEEP, comprehensive evidence: the bundle now carries multi-angle news ARTICLE
//        excerpts (not just headlines) + SEC FILING PASSAGES read via full-text search, plus
//        the live de-rating/forced-flow/opportunity signals. The prompt commands grounding in
//        those excerpts/passages with explicit citations, forbids inventing facts/sources, and
//        the evidence cap is widened so the substance survives. Substance over a headline skim.
//   v4 — falsifiability + variant perception (premier-fund discipline): every call must state the
//        VARIANT VIEW (what we believe that consensus doesn't + the catalyst that forces the market
//        to agree), a steelmanned BEAR CASE, and a dated, falsifiable KILL-CRITERION ("wrong if X by
//        Y"). Confidence must respect dispersion across seats. See docs/RESEARCH-DESIGN.md.
// Circular-safe: triangulate is a hoisted export function in research.mjs, only called at runtime
// inside seatPrompt — so the cycle resolves cleanly (no use at module-eval time).
import { triangulate } from "./research.mjs";

//   v5 — hardening against the observed committee failure modes: seats now see explicit PRICE
//        CONTEXT (so an up-86%-YTD name can't be called "cheap"), are told to separate timing
//        ("binds now") from valuation ("cheap now"), and the CIO carries a burden-of-proof-on-change
//        default + a ban on pulling bind_window earlier without dated evidence. Pairs with the
//        deterministic verification gate (research-verify.mjs) that hard-blocks the same errors.
export const RESEARCH_PROMPT_VERSION = 5;

const OBJECTIVE = "Objective: maximize 10-year return while keeping max drawdown < 35% (best Calmar/Sortino).";
const OWNERSHIP = "You may ONLY propose: priced_in (low|medium|high|crowded), bind_window (now|2027|2028-29|2030+|physics-floor), non_consensus (bool), confidence (0..1), rationale, sources[], variant_view (what consensus misses + the catalyst), bear_case (the steelmanned counter), kill_criterion ({condition, by_date as YYYY or YYYY-MM}). NEVER change thesis, tickers, id, or sector.";

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
  const ec = evidence?.evidence_count || {};
  return [
    `You are a structural-tech-scarcity research analyst. ${OBJECTIVE}`,
    `Reassess ONE scarcity from the EVIDENCE BELOW and propose updated fields as STRICT JSON only.`,
    OWNERSHIP, calib(scorecard),
    `Ground every claim in the supplied evidence: cite the NEWS excerpts and SEC FILING passages (by ticker/form/date and source link) in "sources". The evidence bundle contains ${ec.news_with_excerpt || 0} article excerpts and ${ec.filing_passages || 0} filing passages — read them, don't rely on prior knowledge. If the evidence is thin or doesn't support a change, keep confidence low and leave fields unchanged. Do NOT invent facts, numbers, or sources not present below.`,
    `Think like a premier hedge-fund analyst: state a VARIANT VIEW (what the consensus is missing and the catalyst that forces a re-rate), steelman the BEAR CASE against your own call, and give a falsifiable KILL-CRITERION (a concrete condition + a by_date) you'd accept as proof you're wrong. Edge lives where independent sources (filings vs price vs news) DISAGREE — say so.`,
    `Current state: ${JSON.stringify({ id: scarcity.id, scarcity: scarcity.scarcity, priced_in: scarcity.priced_in, bind_window: scarcity.bind_window, non_consensus: scarcity.non_consensus, thesis: scarcity.thesis })}`,
    `EVIDENCE (live signals + news excerpts + SEC filing passages + quotes): ${JSON.stringify(evidence).slice(0, 24000)}`,
    `Output JSON: {"priced_in":...,"bind_window":...,"non_consensus":...,"confidence":0..1,"rationale":"...","sources":["..."],"variant_view":"...","bear_case":"...","kill_criterion":{"condition":"...","by_date":"YYYY-MM"}}`,
  ].join("\n");
}

// --- Investment-committee seats (Phase 2) ---------------------------------------------------------
// Each seat argues a distinct MANDATE but must also give an HONEST neutral priced_read (low|medium|
// high|crowded) — the read, not the mandate, drives dispersion. Genuine cognitive diversity comes
// from running these on different model families (see the provider pool).
const SEAT = {
  bull: "the BULL / long PM. Make the STRONGEST variant-perception case: what does consensus underrate, and what catalyst forces a re-rate? Be specific and evidence-grounded.",
  bear: "the BEAR / short-seller. Try to KILL this thesis: supply response, demand air-pocket, substitution, policy reversal, or it's already-priced and will de-rate first. Attack, don't hedge.",
  skeptic: "the BASE-RATE SKEPTIC. Take the OUTSIDE view: how often do 'structural shortage' stories actually mean-revert? Ignore the narrative; weigh reference-class frequency and disconfirming data.",
};
// Render the basket's price context explicitly so a model CANNOT call an up-86%-YTD name "cheap"
// without confronting the number. This is the prompt-side guard against the momentum trap.
function priceContext(evidence) {
  const q = evidence?.quotes || {};
  const parts = Object.entries(q).filter(([, v]) => v && !v.error).map(([t, v]) => {
    const ytd = typeof v.ytd === "number" ? `${(v.ytd * 100).toFixed(0)}% YTD` : null;
    const ma = typeof v.vs200 === "number" ? `${(v.vs200 * 100).toFixed(0)}% vs 200-DMA` : null;
    return `${t} ${[ytd, ma].filter(Boolean).join(", ")}`.trim();
  });
  if (!parts.length) return "PRICE CONTEXT: no live quotes available.";
  return `PRICE CONTEXT (the basket is ALREADY up by this much): ${parts.join("; ")}. A name already up a lot / well above its 200-DMA is LESS likely to be under-priced — do not call an extended winner "cheap" without a concrete, fundamental reason the price hasn't caught up.`;
}

export function seatPrompt(role, scarcity, evidence = {}, scorecard = null) {
  const ec = evidence?.evidence_count || {};
  return [
    `You are ${SEAT[role] || SEAT.bull}`,
    `Scarcity under review: "${scarcity.scarcity}". ${OBJECTIVE}`,
    calib(scorecard),
    `Ground every claim in the EVIDENCE; cite news excerpts / SEC filing passages (ticker/form/date). The bundle has ${ec.news_with_excerpt || 0} excerpts and ${ec.filing_passages || 0} filing passages — read them, don't invent. Edge lives where filings, price, and news DISAGREE.`,
    priceContext(evidence),
    `TWO SEPARATE QUESTIONS — do not conflate them: (1) TIMING — does the scarcity BIND now vs later (bind_window)? (2) VALUATION — is it CHEAP now vs already-priced (priced_read)? "Binds now" is NOT the same as "cheap now": a real, present shortage can be fully priced in. Answer each on its own evidence.`,
    `TRIANGULATION: ${triangulate(evidence).note}`,
    `Current state: ${JSON.stringify({ priced_in: scarcity.priced_in, bind_window: scarcity.bind_window, non_consensus: scarcity.non_consensus, thesis: scarcity.thesis })}`,
    `EVIDENCE: ${JSON.stringify(evidence).slice(0, 24000)}`,
    `Output STRICT JSON: {"priced_read":"low|medium|high|crowded","argument":"your mandate's case (<=120 words)","confidence":0..1}`,
  ].join("\n");
}

// The CIO weighs the debate and issues the FINAL proposal. It must respect dispersion (wide → cut
// confidence), and emit a variant view + steelmanned bear case + a falsifiable dated kill-criterion.
export function cioPrompt(scarcity, seats, disp) {
  return [
    `You are the CIO chairing an investment committee on "${scarcity.scarcity}". ${OBJECTIVE}`,
    `Weigh the three seats and issue the FINAL call. ${OWNERSHIP}`,
    `Seat reads dispersion: ${disp?.level || "n/a"} (agreement ${disp?.agreement ?? "n/a"}). If dispersion is wide, the committee disagrees — LOWER confidence and consider leaving fields unchanged.`,
    `BURDEN OF PROOF IS ON CHANGE. The DEFAULT is NO CHANGE: keep the current fields unless the evidence clearly and specifically justifies moving them. When in doubt, leave fields unchanged and lower confidence — a held call is better than a wrong one.`,
    `Do NOT move bind_window EARLIER (pull timing forward toward "now") unless a DATED, CONCRETE piece of evidence (a filing, contract, or policy date) supports the acceleration. "It feels urgent" is not evidence — most shortages bind on the documented thesis timeline, not sooner.`,
    `BULL: ${JSON.stringify(seats.bull || {})}`,
    `BEAR: ${JSON.stringify(seats.bear || {})}`,
    `SKEPTIC: ${JSON.stringify(seats.skeptic || {})}`,
    `Output STRICT JSON including variant_view, bear_case (steelman the BEAR), and a falsifiable kill_criterion {condition, by_date as YYYY or YYYY-MM}: {"priced_in":...,"bind_window":...,"non_consensus":...,"confidence":0..1,"rationale":"...","sources":["..."],"variant_view":"...","bear_case":"...","kill_criterion":{"condition":"...","by_date":"YYYY-MM"}}`,
  ].join("\n");
}

// The CHIEF RISK OFFICER review (Phase: trust). A final, independent pass on the committee's
// proposal — ideally on the strongest available model — replicating the human sanity-check: is any
// ticker real and correctly attributed? Is the thesis logically sound? Is it momentum-chasing a
// name already up a lot? The CRO can APPROVE, REVISE (dock confidence), or VETO (kill it).
export function croPrompt(scarcity, edit, evidence = {}) {
  const ec = evidence?.evidence_count || {};
  return [
    `You are the CHIEF RISK OFFICER. Independently review this proposed reassessment before it reaches the human. Be skeptical; your job is to catch errors the committee missed.`,
    `Check specifically: (1) HALLUCINATION — is every company/ticker named in the variant_view REAL and correctly attributed to "${scarcity.scarcity}"? A made-up or misattributed ticker (e.g. citing an auto-parts company as a robotics-data play) is an automatic VETO. (2) LOGIC — does the thesis actually follow from the evidence, or is it a non-sequitur? (3) MOMENTUM-CHASING — does it call a name already up a lot "cheap/under-priced" without a concrete reason price hasn't caught up? (4) OVER-REACH — is confidence justified by the ${(ec.news_with_excerpt || 0)} excerpts + ${(ec.filing_passages || 0)} filing passages actually present?`,
    `Scarcity: ${JSON.stringify({ scarcity: scarcity.scarcity, priced_in: scarcity.priced_in, bind_window: scarcity.bind_window, tickers: scarcity.tickers, thesis: scarcity.thesis })}`,
    `PROPOSAL: ${JSON.stringify({ priced_in: edit.priced_in, bind_window: edit.bind_window, non_consensus: edit.non_consensus, confidence: edit.confidence, variant_view: edit.variant_view, rationale: edit.rationale })}`,
    `Output STRICT JSON: {"verdict":"approve|revise|veto","confidence_adj":-1..0,"reason":"<=60 words; for veto, name the specific flaw"}`,
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
    `If the critique lands, lower confidence or revert toward the current state. Preserve the variant_view, bear_case, and a falsifiable kill_criterion (condition + by_date) in the final output.`,
    `Proposal: ${JSON.stringify(proposal)}`,
    `Critique: ${critique}`,
    `Output the same STRICT JSON shape only (including variant_view, bear_case, kill_criterion).`,
  ].join("\n");
}
