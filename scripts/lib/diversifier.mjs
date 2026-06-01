// DIVERSIFIER SCOUT — Stage 1 (the quantitative, BOOK-AWARE screen). The AI-capex Scout hunts supply-
// CONSTRAINED chokepoints; the second axis is the opposite — defensive DEMAND sleeves held to LOWER the
// book's drawdown. Those can't be found by constraint-shadow, so we screen a candidate universe through
// the same axis-check gate AND against the plan you already hold: a sleeve qualifies when it has low
// market beta, a NON-positive AI-capex loading (it must not amplify the build-out it's meant to hedge),
// a contained drawdown, AND it actually lowers the *combined* drawdown of the current plan (a sleeve that
// duplicates planned exposure — e.g. water when FIW is already planned — barely moves it, and surfaces
// as low ddReduction). Pure + read-only: given price series it ranks candidates and writes nothing.
// Stages 2 (committee conviction) and 3 (sleeve-budget → plan PR) build on this; this stage can't touch
// the AI-capex feed, the plan, or any shared file (collision-safe by construction).
import { basketStats, aiCapexLoading, blendIndex } from "./axis.mjs";
import { gateAiCapex } from "./scout.mjs";

// Candidate universe — defensive equity sleeves to screen. Deliberately NOT AI-narrative names. Edit here
// to widen the funnel; the SCREEN (not this list) decides what actually qualifies as a diversifier.
export const DIVERSIFIER_UNIVERSE = [
  { id: "health-defensive", sector: "Health", scarcity: "Defensive health demand (pharma / devices)", tickers: ["JNJ", "PFE", "MRK", "ABT", "MDT"] },
  { id: "water-climate", sector: "Climate-adaptation", scarcity: "Water / climate-adaptation infrastructure", tickers: ["PHO", "AWK", "WTRG"] },
  { id: "consumer-staples", sector: "Consumer staples", scarcity: "Consumer staples (inelastic demand)", tickers: ["PG", "KO", "PEP", "COST", "WMT"] },
  { id: "regulated-utilities", sector: "Utilities", scarcity: "Regulated utilities (rate-base)", tickers: ["NEE", "DUK", "SO", "D", "AEP"] },
  { id: "waste-environmental", sector: "Environmental services", scarcity: "Waste / environmental services (local monopolies)", tickers: ["WM", "RSG", "WCN"] },
  { id: "discount-retail", sector: "Consumer defensive", scarcity: "Discount / trade-down retail", tickers: ["DG", "DLTR", "TJX"] },
];

// Screen one candidate sleeve. Returns the full metric row + a qualify decision with a human reason.
// `qualifies` requires ALL of: gate pass (aiβ not positive), market beta ≤ betaMax, maxDD ≤ cap. When
// `planTickers` is supplied we ALSO compute the incremental drawdown reduction the sleeve gives the plan
// (planMaxDD − blendedMaxDD); a non-positive value means the sleeve is redundant with what's already held.
export function screenCandidate(seriesByTicker, c, marketTickers, complexTickers, { planTickers = [], aiBetaMax = 0.3, betaMax = 0.95, maxDDCap = 0.5, minDays = 60 } = {}) {
  const base = { id: c.id, sector: c.sector, scarcity: c.scarcity, tickers: c.tickers };
  const stats = basketStats(seriesByTicker, c.tickers);
  const load = aiCapexLoading(seriesByTicker, c.tickers, marketTickers, complexTickers, { aiBetaMax, minDays });
  if (!stats || !load) return { ...base, qualifies: false, reason: "insufficient price history" };

  const gate = gateAiCapex(load, { axis: "diversifier", aiBetaMax });
  const lowBeta = load.marketBeta <= betaMax;
  const ddOk = stats.maxDD <= maxDDCap;

  // Book-awareness: exact-ticker overlap with the plan, and the incremental drawdown reduction from
  // blending this sleeve 50/50 with the planned book (the sectoral-redundancy signal — e.g. water vs FIW).
  const heldOverlap = (c.tickers || []).filter((t) => planTickers.includes(t));
  let planMaxDD = null, blendedMaxDD = null, ddReduction = null;
  if (planTickers.length) {
    const planStats = basketStats(seriesByTicker, planTickers);
    const blend = blendIndex(seriesByTicker, [planTickers, c.tickers]);
    const blendStats = blend.closes.length ? basketStats({ B: { dates: blend.dates, closes: blend.closes } }, ["B"]) : null;
    if (planStats && blendStats) {
      planMaxDD = planStats.maxDD;
      blendedMaxDD = blendStats.maxDD;
      ddReduction = +(planMaxDD - blendedMaxDD).toFixed(4); // positive = adding this sleeve lowers the plan's drawdown
    }
  }

  const qualifies = gate.pass && lowBeta && ddOk;
  const reason = !gate.pass ? gate.reason
    : !lowBeta ? `market beta ${load.marketBeta} > ${betaMax} (moves too much with the market to diversify)`
    : !ddOk ? `maxDD ${(stats.maxDD * 100).toFixed(0)}% > ${(maxDDCap * 100).toFixed(0)}% cap`
    : heldOverlap.length ? `qualifies, but overlaps planned holdings (${heldOverlap.join(", ")}) — net the overlap before sizing`
    : ddReduction != null && ddReduction <= 0 ? "qualifies on the gate, but adds ~no drawdown reduction vs the current plan (redundant exposure)"
    : "qualifies — low-beta, non-amplifying, lowers the plan's drawdown";

  return {
    ...base,
    years: stats.years, cagr: stats.cagr, maxDD: stats.maxDD, sharpe: stats.sharpe,
    marketBeta: load.marketBeta, mktBeta: load.marketBeta, // marketBeta is canonical; mktBeta is the display alias the radar reads
    aiBeta: load.aiBeta, aiT: load.aiT,
    heldOverlap, planMaxDD, blendedMaxDD, ddReduction,
    gate, qualifies, reason,
  };
}

// Screen the whole universe and RANK: qualifiers first, then — since the sleeve's JOB is lowering the
// plan's drawdown — by the largest incremental drawdown reduction, then best Sharpe, then lowest maxDD.
// (With no plan supplied, ddReduction is null for all, so it falls through to Sharpe.) Ties broken by id
// so output is deterministic/stable.
export function screenDiversifiers(seriesByTicker, universe, marketTickers, complexTickers, opts = {}) {
  const rows = (universe || []).map((c) => screenCandidate(seriesByTicker, c, marketTickers, complexTickers, opts));
  return rows.sort((a, b) =>
    (b.qualifies ? 1 : 0) - (a.qualifies ? 1 : 0) ||
    (b.ddReduction ?? -Infinity) - (a.ddReduction ?? -Infinity) ||
    (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity) ||
    (a.maxDD ?? Infinity) - (b.maxDD ?? Infinity) ||
    a.id.localeCompare(b.id));
}

// ---------- Stage 2: committee conviction (drawdown-focused, reuses llm.mjs; NOT a bent runCommittee) ----------

// The committee's verb here is NOT "reassess priced-in" (that's the AI-capex committee) — it's "how good a
// DRAWDOWN HEDGE is this name": balance-sheet durability, demand inelasticity, dividend resilience, and
// whether it actually de-correlates in a drawdown. Returns a strict JSON conviction so it's machine-parseable.
export function convictionPrompt(ticker, evidence = {}) {
  return `You are a defensive-allocation committee (bull / bear / skeptic) sizing a DIVERSIFIER sleeve held to LOWER a concentrated AI-capex book's drawdown — NOT to chase return.
Name: ${ticker}. Sleeve: ${evidence.sleeve || "defensive"}. Evidence: ${JSON.stringify(evidence)}.
Judge ONLY its quality as a drawdown hedge: demand inelasticity, balance-sheet durability, dividend resilience, and how independently it behaves from the AI build-out. Higher conviction = a better, more reliable hedge.
Respond with STRICT JSON only, no prose: {"conviction": <0..1>, "why": "<one sentence>"}`;
}

// Pull a 0–1 conviction out of an LLM reply (JSON or loose). Clamps to [0,1]; returns null if absent.
export function parseConviction(text) {
  if (!text) return null;
  let v = null;
  const j = String(text).match(/"conviction"\s*:\s*(-?\d*\.?\d+)/i);
  if (j) v = parseFloat(j[1]);
  else { const m = String(text).match(/\b(0?\.\d+|1(?:\.0+)?|0)\b/); if (m) v = parseFloat(m[1]); }
  if (v == null || !Number.isFinite(v)) return null;
  return +Math.min(1, Math.max(0, v)).toFixed(3);
}

// Run the conviction pass over a list of tickers. `callers` are seat functions (prompt)=>text (e.g. from
// llm.mjs seatCaller) so multiple models vote and we average — and tests can inject a fake. If no caller
// returns a parseable conviction (no key / offline), every name falls back to `fallback` → the sizing
// degrades to pure inverse-volatility (equal conviction), so the pipeline still works without an LLM.
export async function convictionCommittee(tickers, evidenceByTicker = {}, callers = [], { fallback = 0.6 } = {}) {
  const out = {};
  for (const t of tickers) {
    const votes = [];
    for (const call of callers) {
      try { const c = parseConviction(await call(convictionPrompt(t, evidenceByTicker[t] || {}))); if (c != null) votes.push(c); } catch { /* a dead model must not sink the sleeve */ }
    }
    out[t] = votes.length ? +(votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(3) : fallback;
  }
  return out;
}

// ---------- Stage 3: size the sleeve (conviction × inverse-vol within a budget) → a proposed plan ----------

// Allocate a diversifier sleeve sized at `sleevePct` of the investable sleeve. Existing diversifier holdings
// already in the plan (e.g. FIW) COUNT toward the budget (so water isn't double-bought); the remaining
// budget is split across the new gate-qualifying names by conviction × inverse-volatility. The AI-capex
// holdings are scaled down so the whole plan still sums to 1.0. Pure + deterministic.
export function fundSleeve({ candidates = [], currentHoldings = [], existingDiversifierTickers = [], sleevePct = 0.15, sleeveUsd = 0, convictions = {}, vols = {}, account = "taxable", tier = "C", defaultConviction = 0.6, defaultVol = 0.25 }) {
  const held = new Set(currentHoldings.map((h) => h.ticker));
  const names = [];
  for (const c of candidates) for (const t of c.tickers || []) if (!held.has(t) && !names.some((n) => n.ticker === t)) names.push({ ticker: t, sleeve: c.id, scarcity: c.scarcity });

  const existingDivWeight = currentHoldings.filter((h) => existingDiversifierTickers.includes(h.ticker)).reduce((a, h) => a + (h.weight || 0), 0);
  const budget = Math.max(0, +(sleevePct - existingDivWeight).toFixed(6)); // new-name budget = sleeve minus what existing diversifiers already cover
  const raw = names.map((n) => (convictions[n.ticker] ?? defaultConviction) * (1 / Math.max(vols[n.ticker] ?? defaultVol, 0.01)));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const newHoldings = names.map((n, i) => {
    const weight = +(budget * raw[i] / sum).toFixed(4);
    return { ticker: n.ticker, name: n.ticker, account, weight, target_usd: Math.round(weight * sleeveUsd), tier, role: `Diversifier (2nd axis) — ${n.scarcity}`, conviction: +(convictions[n.ticker] ?? defaultConviction).toFixed(3), sleeve: n.sleeve };
  });
  const aiWeight = +(1 - existingDivWeight).toFixed(6); // current non-diversifier (AI-capex) weight
  const aiScale = aiWeight > 0 ? +((1 - sleevePct) / aiWeight).toFixed(4) : 1; // scale AI-capex down so the plan still sums to 1.0
  return { newHoldings, budget, existingDivWeight: +existingDivWeight.toFixed(4), aiScale, sleevePct, existingDiversifierTickers };
}

// Produce the PROPOSED holdings list for the plan PR: AI-capex holdings scaled by aiScale, existing
// diversifiers (FIW) kept as-is, new diversifier names appended. The result sums back to ~1.0 with the
// diversifier axis at `sleevePct`. (Stage 3 of the pipeline; the human reviews + merges this.)
export function applyFunding(portfolio, funding) {
  const { newHoldings, aiScale, existingDiversifierTickers = [] } = funding;
  const newSet = new Set(newHoldings.map((h) => h.ticker));
  const scaled = (portfolio.holdings || []).filter((h) => !newSet.has(h.ticker)).map((h) => {
    if (existingDiversifierTickers.includes(h.ticker)) return { ...h }; // existing diversifier (FIW) untouched — already in the budget
    const weight = +((h.weight || 0) * aiScale).toFixed(4);
    return { ...h, weight, target_usd: Math.round(weight * (portfolio.sleeve_usd || 0)) };
  });
  return [...scaled, ...newHoldings];
}
