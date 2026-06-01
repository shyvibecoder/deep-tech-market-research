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

// ── D1: LLM-generated, human-vetted constraint phrases (SCOUT-DESIGN) ──────────────────────────
// A generated phrase NEVER triggers a search until a human approves it. The model proposes →
// mergePhraseDoc lands new ones as `pending` → a human approves → approvedPhrases gates the sweep.

// Clean an LLM phrase response (JSON array OR a bulleted/numbered/newline list) into search phrases:
// strip list markers + quotes, trim, drop too-short/absurd lines, de-dupe case-insensitively.
export function parsePhrases(text) {
  let lines = [];
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("[")) { try { lines = JSON.parse(trimmed); } catch { /* fall through */ } }
  if (!lines.length) lines = trimmed.split(/\r?\n/);
  const seen = new Set(), out = [];
  for (const raw of lines) {
    // Normalize to lowercase — these are case-insensitive FTS search strings, so this de-dupes
    // near-variants and keeps the list visually consistent with the seed phrases.
    const p = String(raw).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["'`]|["'`]$/g, "").trim().toLowerCase();
    if (p.length < 4 || p.length > 80) continue;
    if (seen.has(p)) continue;
    seen.add(p); out.push(p);
  }
  return out;
}

// Merge freshly-generated phrases into the phrase doc: genuinely-new ones become `pending`; phrases
// already present (any status: approved/pending/rejected) are left untouched so a re-generation can't
// resurrect a rejected phrase or un-approve an approved one. De-dupe is case-insensitive.
export function mergePhraseDoc(prevDoc, phrases, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const existing = (prevDoc?.phrases || []).map((p) => ({ ...p }));
  const have = new Set(existing.map((p) => p.phrase.toLowerCase()));
  for (const p of (phrases || [])) {
    const k = String(p).toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    existing.push({ phrase: String(p), status: "pending", added: today });
  }
  return { schema_version: 1, phrases: existing };
}

// THE SEARCH GATE: only `approved` phrases are searched. If none are approved yet (fresh repo, or a
// pending-only doc), fall back to the seed list so the scout never breaks — the seed IS the bootstrap.
export function approvedPhrases(doc, { fallback = DEFAULT_CONSTRAINT_PHRASES } = {}) {
  const approved = (doc?.phrases || []).filter((p) => p.status === "approved").map((p) => p.phrase);
  return approved.length ? approved : fallback;
}

// Generate candidate constraint phrases via an injected model `complete(prompt) -> text` (the runner
// wraps Anthropic). Asks for SHORT, scarcity-AGNOSTIC complaint language so the phrases generalize
// across chokepoints rather than naming a specific material we already track.
export async function generateConstraintPhrases({ complete, count = 18 } = {}) {
  const prompt =
    `Task: build a SEC full-text search list to DISCOVER emerging STRUCTURAL supply chokepoints — ` +
    `inputs that are hard to build, qualify, or substitute (multi-year capacity, single-source, ` +
    `qualification barriers), NOT transient logistics. Output ${count} short phrases (3-6 words) that ` +
    `appear VERBATIM in 10-K/10-Q risk factors and MD&A when a company's critical input is becoming ` +
    `scarce.\n\n` +
    `Aim across these CONSTRAINT TYPES (a few each):\n` +
    `- hard allocation / sold-out capacity (e.g. "placed on allocation", "capacity remains constrained")\n` +
    `- single-source dependency (e.g. "rely on a single supplier", "sole source of supply")\n` +
    `- qualification barriers (e.g. "lengthy qualification process", "qualify an alternative source")\n` +
    `- multi-year lead times (e.g. "lead times have lengthened", "extended delivery lead times")\n` +
    `- locked-in / take-or-pay contracts that signal supplier pricing power (e.g. "take-or-pay", "long-term supply agreement")\n\n` +
    `PRECISION RULES (this is a search query, optimize for it):\n` +
    `- Specific enough to NOT match generic boilerplate, common enough to actually appear in filings.\n` +
    `- GENERIC language only — never name a material, product, company, or industry (must generalize).\n` +
    `- EXCLUDE transient/macro noise: shipping, freight, port, tariff, inflation, pandemic, labor cost, recession.\n\n` +
    `Output: one phrase per line, lowercase, no numbering, no quotes, no commentary.`;
  return parsePhrases(await complete(prompt));
}

// (approvePendingPhrases — the dashboard approve action — lives in web/scout-review.mjs so the
// browser can import it without pulling in the node-side scout code.)

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

// ── Normalized "lead" pipeline (multi-engine) ──────────────────────────────────────────────────
// Every engine (constraint-shadow / BOM-ladder / arXiv) emits LEADS of the same shape, which all
// flow through ONE shared evaluator. A lead = { engine, subject, tickers, lead: <engine detail> }.

// Build a committee-ingestible DRAFT from ANY engine's lead; the thesis is tailored per engine so the
// committee (and the reviewer) sees WHERE the lead came from.
export function draftFromLead(L) {
  const phrases = L?.lead?.phrases || [];
  const draft = draftScarcity({ ticker: L?.tickers?.[0], company: L?.lead?.company, phrases },
    { proxies: L?.tickers || [], subject: L?.subject, bind_window: L?.bind_window || "2027" });
  draft.engine = L?.engine || "constraint-shadow";
  if (L?.lead?.ladder_from) {
    draft.ladder_from = L.lead.ladder_from;
    draft.thesis = `Scout (BOM ladder from "${L.lead.ladder_from}"): "${L.subject}" is an upstream dependency of a known scarcity${L.lead.why ? ` — ${L.lead.why}` : ""}. The supplier of a scarce thing is the highest-prior place to find the next scarce thing. Committee to confirm it's a real, durable, not-yet-priced chokepoint.`;
  }
  if (L?.lead?.papers != null) {
    draft.thesis = `Scout (research signal): elevated technical activity around "${L.subject}" (${L.lead.papers} recent papers) can foreshadow a forming physical bottleneck before it appears in filings. Committee to confirm investability + whether it's already priced.`;
  }
  return draft;
}

// Stable evidence fingerprint for D2 memory: subject + sorted tickers + sorted phrases. A new dated
// filing/ticker changes the hash → a previously-rejected candidate is allowed to re-enter.
export function leadEvidenceHash(L) {
  return [String(L?.subject || ""), ...((L?.tickers) || []).slice().sort(), ...((L?.lead?.phrases) || []).slice().sort()].join("|").toLowerCase();
}

// SHARED EVALUATOR: D2-dedupe → budget-cap → draft → committee, for leads from ANY engine.
//   evaluate(draft) -> { approved, proposal?, reason? }   (wrap the committee in the runner)
// seenState (optional) enables D2 memory: a previously-rejected lead is suppressed unless its
// evidence_hash changed. Budget is hard-capped by maxCandidates (committee calls cost money).
export async function evaluateLeads(leads, { evaluate, maxCandidates = 8, seenState = null } = {}) {
  const errors = [];
  let active = leads || [];
  let suppressed = [];
  if (seenState) {
    const tagged = active.map((L) => ({ L, id: draftFromLead(L).id, evidence_hash: leadEvidenceHash(L) }));
    const upd = scoutSeenUpdate(seenState, tagged);
    suppressed = upd.suppressed;
    const fresh = new Set(upd.fresh);
    active = tagged.filter((t) => fresh.has(t.id)).map((t) => t.L);
  }
  active = active.slice(0, maxCandidates);
  const proposals = [], considered = [];
  for (const L of active) {
    const draft = draftFromLead(L);
    let verdict;
    try { verdict = await evaluate(draft); }
    catch (e) { errors.push(`evaluate ${draft.id}: ${e.message}`); considered.push({ id: draft.id, engine: draft.engine, reason: `evaluate error: ${e.message}` }); continue; }
    if (verdict?.approved) proposals.push({ ...(verdict.proposal || {}), id: draft.id, tickers: draft.tickers, source: "scout", engine: draft.engine, constraint_phrases: draft.constraint_phrases });
    else considered.push({ id: draft.id, tickers: draft.tickers, engine: draft.engine, reason: verdict?.reason || "committee did not approve" });
  }
  return { proposals, considered, errors, suppressed };
}

// ENGINE 1 (constraint-shadow) lead producer: phrases → bounded FTS sweep → cluster → normalized leads.
//   searchPhrase(phrase) -> [{ ticker, company, mentions }]   (wrap searchFts in the runner)
export async function constraintShadowLeads({ phrases = DEFAULT_CONSTRAINT_PHRASES, knownTickers = [], minPhrases = 2, maxSearches = 12, maxCandidates = 8, searchPhrase, subjectFor = null } = {}) {
  const errors = [];
  const results = [];
  for (const phrase of phrases.slice(0, maxSearches)) {
    try { results.push({ phrase, hits: await searchPhrase(phrase) }); }
    catch (e) { errors.push(`${phrase}: ${e.message}`); }
  }
  const { candidates, droppedKnown } = clusterConstraintHits(results, { knownTickers, minPhrases, max: maxCandidates });
  const leads = candidates.map((c) => ({
    engine: "constraint-shadow",
    subject: (subjectFor && subjectFor(c)) || `${c.company || c.ticker} supply constraint`,
    tickers: [c.ticker],
    lead: { ticker: c.ticker, company: c.company, phrases: c.phrases },
  }));
  return { leads, errors, droppedKnown, phrasesSearched: results.length };
}

// Back-compat engine-1 sweep = produce constraint-shadow leads + evaluate them. The runner uses the
// engine producers + evaluateLeads directly to combine engines; this preserves the original contract.
export async function runScoutSweep(opts = {}) {
  const { leads, errors, droppedKnown, phrasesSearched } = await constraintShadowLeads(opts);
  const ev = await evaluateLeads(leads, { evaluate: opts.evaluate, maxCandidates: opts.maxCandidates ?? 8 });
  const allErrors = [...errors, ...ev.errors];
  return { proposals: ev.proposals, considered: ev.considered, errors: allErrors,
    health: { phrasesSearched, candidates: leads.length, proposals: ev.proposals.length, droppedKnown, errors: allErrors.length } };
}

// ── ENGINE 2: BOM laddering (SCOUT-DESIGN) ─────────────────────────────────────────────────────
// Walk UP the dependency stack from KNOWN scarcities. parse the model's upstream-dependency list into
// { input, why }: accepts "Input — reason" / "Input: reason" lines, bullets/numbers, or a JSON array.
export function parseLadderResponse(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed).map((x) => ({ input: String(x.input || "").trim(), why: String(x.why || "").trim() })).filter((x) => x.input.length >= 3); }
    catch { /* fall through */ }
  }
  const out = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s*(?:[—:–-]\s+|—)\s*(.+)$/);
    const input = (m ? m[1] : line).trim();
    const why = m ? m[2].trim() : "";
    if (input.length < 3) continue;
    out.push({ input, why });
  }
  return out;
}

// Engine-2 lead producer: for each of up to maxSeeds known scarcities, the model proposes upstream
// inputs; we discover public proxies for each (reusing the chokepoint discovery), and emit a lead.
// Inputs whose only proxies are ALREADY-known tickers are dropped (novelty). propose()/discover()
// injected. Budget: maxSeeds propose-calls × maxPerSeed inputs.
export async function bomLadderLeads({ scarcities = [], propose, discover, knownTickers = [], maxSeeds = 6, maxPerSeed = 2 } = {}) {
  const known = new Set(knownTickers);
  const leads = [], errors = [];
  for (const s of scarcities.slice(0, maxSeeds)) {
    let inputs = [];
    try { inputs = parseLadderResponse(await propose(s)).slice(0, maxPerSeed); }
    catch (e) { errors.push(`ladder ${s.id}: ${e.message}`); continue; }
    for (const { input, why } of inputs) {
      let tickers = [];
      try { tickers = (await discover(input)) || []; }
      catch (e) { errors.push(`discover ${input}: ${e.message}`); }
      const novel = tickers.filter((t) => !known.has(t));
      if (tickers.length && !novel.length) continue;           // every proxy already known → not novel
      leads.push({ engine: "bom-ladder", subject: input, tickers: novel.length ? novel : tickers, lead: { ladder_from: s.id, why } });
    }
  }
  return { leads, errors };
}

// ── ENGINE 3: arXiv technical-literature signal (SCOUT-DESIGN; earliest + noisiest) ─────────────
// Keyless arXiv Atom API. parseArxiv: pull <entry> title/summary/published from the feed (no XML lib
// — the feed is simple and stable; regex keeps it dependency-free + pure).
export function parseArxiv(xml) {
  const out = [];
  const clean = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  for (const m of String(xml || "").matchAll(/<entry\b[\s\S]*?<\/entry>/g)) {
    const block = m[0];
    const title = clean((block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
    const summary = clean((block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/) || [])[1]);
    const published = ((block.match(/<published\b[^>]*>([\s\S]*?)<\/published>/) || [])[1] || "").trim();
    if (title) out.push({ title, summary, published });
  }
  return out;
}

export async function searchArxiv(query, { maxResults = 20, fetchImpl = fetch } = {}) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:"${query}"`)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  const r = await fetchImpl(url, { headers: { accept: "application/atom+xml" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`arxiv ${r.status}`);
  return parseArxiv(await r.text());
}

// Engine-3 lead producer: a query with ENOUGH recent papers (research heat) AND a discoverable public
// proxy becomes a low-prior lead. Topics with no public proxy are dropped (the committee needs tickers
// to score). search()/discover() injected. This is the noisiest engine — leads start priced_in='low'
// and lean on the committee + the human's higher-scrutiny review.
export async function arxivLeads({ queries = [], search, discover, minPapers = 5, maxQueries = 12 } = {}) {
  const leads = [], errors = [];
  for (const q of queries.slice(0, maxQueries)) {
    let papers = [];
    try { papers = (await search(q)) || []; }
    catch (e) { errors.push(`arxiv ${q}: ${e.message}`); continue; }
    if (papers.length < minPapers) continue;
    let tickers = [];
    try { tickers = (await discover(q)) || []; }
    catch (e) { errors.push(`discover ${q}: ${e.message}`); }
    if (!tickers.length) continue;                            // no public proxy → not evaluable
    leads.push({ engine: "arxiv", subject: q, tickers, lead: { papers: papers.length } });
  }
  return { leads, errors };
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
