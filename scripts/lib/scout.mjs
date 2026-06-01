// Scarcity SCOUT — discovers CANDIDATE new scarcities so the committee has fresh theses to evaluate
// (the alpha-generation gap; see docs/SCOUT-DESIGN.md). NOT a trend-finder: trends are priced and
// ALPHA.md says there's no edge in what's priced. Engine 1 = "constraint shadow": a binding
// constraint shows up FIRST as downstream filers complaining ("lead times extended", "unable to
// secure allocation"), before anyone names the chokepoint. We search those complaint phrases in SEC
// full-text, then cluster which filers show CROSS-PHRASE supply stress. The scout only widens the
// funnel — the existing committee adjudicates, a human approves (F9). Pure core → fixture-testable.

// D1 (SCOUT-DESIGN): the live phrase list is meant to be LLM-generated + human-vetted + cached.
// This is the SEED/fallback list — concrete supply-stress language that recurs in 10-K/10-Q risk
// factors and MD&A. Used when no vetted list is provided. Deliberately complaint-shaped, not
// scarcity-named, so we infer the chokepoint from the pattern of who's complaining.
export const DEFAULT_CONSTRAINT_PHRASES = [
  "lead times extended",
  "unable to secure allocation",
  "qualified a second source",
  "capacity-constrained supplier",
  "on allocation",
  "took-or-pay",
  "single source of supply",
  "extended delivery lead times",
  "supply remains constrained",
  "unable to obtain sufficient quantities",
];

// Cluster constraint-phrase search results into candidate leads.
//   results: [{ phrase, hits: [{ ticker, company, mentions }] }]   (hits = parseFtsHits output)
// A filer complaining under MANY DISTINCT phrases is feeling broad supply stress → a strong lead;
// breadth (distinct phrases) dominates raw mention volume so a one-phrase loudmouth can't win on
// boilerplate. Filers already explained by a KNOWN scarcity ticker are dropped (novelty filter, D2-adjacent).
export function clusterConstraintHits(results, { knownTickers = [], minPhrases = 2, max = 12 } = {}) {
  const known = new Set(knownTickers);
  const byTicker = {};
  let droppedKnown = 0;
  for (const { phrase, hits } of (results || [])) {
    if (!phrase || !Array.isArray(hits)) continue;
    for (const h of hits) {
      if (!h?.ticker) continue;
      if (known.has(h.ticker)) { droppedKnown++; continue; }
      const t = (byTicker[h.ticker] ||= { ticker: h.ticker, company: h.company, phrases: new Set(), mentions: 0 });
      t.phrases.add(phrase);
      t.mentions += h.mentions || 0;
    }
  }
  const candidates = Object.values(byTicker)
    .map((t) => {
      const phraseCount = t.phrases.size;
      // Breadth-dominant score: each distinct phrase is worth a full point; raw mentions only break
      // ties (sublinear, capped) so volume can't overpower cross-phrase corroboration.
      const score = +(phraseCount + Math.min(0.99, Math.log1p(t.mentions) / 10)).toFixed(3);
      return { ticker: t.ticker, company: t.company, phraseCount, phrases: [...t.phrases], mentions: t.mentions, score };
    })
    .filter((c) => c.phraseCount >= minPhrases)
    .sort((a, b) => b.score - a.score || b.phraseCount - a.phraseCount || a.ticker.localeCompare(b.ticker))
    .slice(0, max);
  return { candidates, droppedKnown };
}

const BIND = ["now", "2027", "2028-29", "2030+", "physics-floor"];
const slug = (s) => "scout-" + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Step 2: synthesize a raw lead into a committee-ingestible DRAFT scarcity (SCOUT-DESIGN). The
// committee CORRECTS these fields — so first guesses are deliberately CONSERVATIVE: priced_in starts
// 'low' (the committee must EARN a higher read, never the reverse), non_consensus=true (a not-yet-
// listed constraint is by definition off-consensus), bind defaults to the near-but-not-now '2027'.
// `draft:true` + `source:'scout'` guarantee it's never confused with a curated scarcity.
export function draftScarcity(lead, { proxies = [], subject = "", bind_window = "2027" } = {}) {
  return {
    id: slug(subject || lead?.ticker),
    sector: "Unknown (scout)",
    scarcity: subject || `Constraint flagged by ${lead?.company || lead?.ticker}`,
    bind_window: BIND.includes(bind_window) ? bind_window : "2027",
    priced_in: "low",                 // committee must earn any higher read
    durability: "medium",             // neutral prior
    substitution_risk: "medium",      // neutral prior
    tickers: proxies.length ? proxies : (lead?.ticker ? [lead.ticker] : []),
    non_consensus: true,
    thesis: `Scout lead: downstream filers report supply stress around ${subject || "this input"} ` +
      `(constraint language: ${(lead?.phrases || []).join("; ")}). Candidate chokepoint inferred from ` +
      `the complaint pattern — committee to confirm it is a real, durable, not-yet-priced scarcity.`,
    draft: true,
    source: "scout",
    complaining_filer: lead?.ticker || null,
    constraint_phrases: lead?.phrases || [],
  };
}

// Soft anti-consensus signal (D-gate): legibility = mainstream financial coverage vs primary
// (filing/trade/patent) coverage. Heavy financial coverage → likely already priced → DOWNWEIGHT
// (penalty), never a hard drop; the committee still evaluates it and the Bear seat is the real filter.
export function legibilityTag({ financialCoverage = 0, primaryCoverage = 0 } = {}) {
  const legible = financialCoverage >= 10 && financialCoverage > primaryCoverage;
  return legible
    ? { tag: "already-legible", penalty: +Math.min(0.3, financialCoverage / 100).toFixed(3) }
    : { tag: "early-contrarian", penalty: 0 };
}

// ORCHESTRATION (SCOUT-DESIGN flow): phrases → bounded FTS sweep → cluster → draft → committee →
// survivors. All I/O is INJECTED so the funnel is testable offline and the runner stays thin:
//   searchPhrase(phrase) -> [{ ticker, company, mentions }]   (wrap searchFts in the runner)
//   evaluate(draft)      -> { approved, proposal?, reason? }  (wrap the committee in the runner)
// Budget is hard-bounded: maxSearches caps FTS calls, maxCandidates caps committee evaluations — a
// sweep is open-ended unlike scoring 24 known items, so cost is enforced here (D-cadence/budget).
export async function runScoutSweep({
  phrases = DEFAULT_CONSTRAINT_PHRASES, knownTickers = [], minPhrases = 2,
  maxSearches = 12, maxCandidates = 8, subjectFor = null,
  searchPhrase, evaluate,
} = {}) {
  const errors = [];
  const toSearch = phrases.slice(0, maxSearches);
  const results = [];
  for (const phrase of toSearch) {
    try { results.push({ phrase, hits: await searchPhrase(phrase) }); }
    catch (e) { errors.push(`${phrase}: ${e.message}`); }
  }
  const { candidates, droppedKnown } = clusterConstraintHits(results, { knownTickers, minPhrases, max: maxCandidates });
  const proposals = [], considered = [];
  for (const lead of candidates) {
    // subjectFor lets the runner name the inferred chokepoint (e.g. via the filer's top phrase or an
    // LLM label); default to the filer so the draft is always well-formed even without enrichment.
    const subject = (subjectFor && subjectFor(lead)) || `${lead.company || lead.ticker} supply constraint`;
    const draft = draftScarcity(lead, { proxies: [lead.ticker], subject });
    let verdict;
    try { verdict = await evaluate(draft); }
    catch (e) { errors.push(`evaluate ${draft.id}: ${e.message}`); considered.push({ id: draft.id, reason: `evaluate error: ${e.message}` }); continue; }
    if (verdict?.approved) proposals.push({ ...(verdict.proposal || {}), id: draft.id, tickers: draft.tickers, source: "scout", constraint_phrases: lead.phrases });
    else considered.push({ id: draft.id, tickers: draft.tickers, reason: verdict?.reason || "committee did not approve" });
  }
  const health = { phrasesSearched: results.length, candidates: candidates.length, proposals: proposals.length, droppedKnown, errors: errors.length };
  return { proposals, considered, errors, health };
}

// D2 memory: split this run's candidates into fresh vs suppressed. A previously-REJECTED candidate
// stays suppressed UNLESS its evidence_hash changed (materially new dated evidence → re-entry),
// mirroring the committee's "burden of proof is on change". `proposed`/`accepted` are not re-run.
export function scoutSeenUpdate(prevState, candidates) {
  const seen = (prevState && prevState.seen) || {};
  const fresh = [], suppressed = [];
  for (const c of (candidates || [])) {
    const rec = seen[c.id];
    const reentered = rec && rec.status === "rejected" && rec.evidence_hash !== c.evidence_hash;
    if (rec && !reentered) suppressed.push(c.id);
    else fresh.push(c.id);
  }
  return { fresh, suppressed };
}
