// Front-end review for the SEPARATE scout feed (web/data/scout-candidates.json, SCOUT-DESIGN D3).
// Unlike research-review (which diffs bot-owned fields on EXISTING scarcities), scout candidates are
// proposed NEW scarcities — a higher-scrutiny "admit this to the watchlist?" decision. PURE +
// browser+node (the UI imports it; tests cover it without a DOM). F9 still holds: admission writes
// only schema-valid fields and is human-approved via PR; the bot never writes scarcities.json itself.
const PRICED = ["low", "medium", "high", "crowded"];
const BIND = ["now", "2027", "2028-29", "2030+", "physics-floor"];
const DURABILITY = ["low", "medium", "high", "very-high"];
const RISK = ["low", "medium", "high"];

// Build one review row per NEW candidate, carrying the scout-specific context (constraint phrases,
// complaining filer, committee read). Drops any candidate whose id ALREADY exists in scarcities so a
// duplicate can never be admitted.
export function scoutCandidateView(feed, scarcitiesDoc) {
  const known = new Set((scarcitiesDoc?.scarcities || []).map((s) => s.id));
  const out = [];
  for (const c of feed?.candidates || []) {
    if (!c?.id || known.has(c.id)) continue;
    out.push({
      id: c.id,
      scarcity: typeof c.scarcity === "string" ? c.scarcity : c.id,
      tickers: Array.isArray(c.tickers) ? c.tickers : [],
      priced_in: PRICED.includes(c.priced_in) ? c.priced_in : null,
      bind_window: BIND.includes(c.bind_window) ? c.bind_window : null,
      confidence: typeof c.confidence === "number" ? c.confidence : null,
      dispersion: c.dispersion && typeof c.dispersion === "object" ? c.dispersion : null,
      complaining_filer: typeof c.complaining_filer === "string" ? c.complaining_filer : null,
      constraint_phrases: Array.isArray(c.constraint_phrases) ? c.constraint_phrases : [],
      legibility: c.legibility === "already-legible" || c.legibility === "early-contrarian" ? c.legibility : null,
      rationale: typeof c.rationale === "string" ? c.rationale : "",
    });
  }
  return out;
}

// Admit an accepted candidate as a NEW scarcity. Returns a NEW document (never mutates input); only
// schema-valid fields are written; an id that already exists is a no-op (no duplicates). Stamps
// source:"scout" + last_reviewed for the audit trail. The user approves this via a PR (F9).
export function appendScoutScarcity(scarcitiesDoc, candidate, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!scarcitiesDoc?.scarcities || !candidate?.id) return scarcitiesDoc;
  if (scarcitiesDoc.scarcities.some((s) => s.id === candidate.id)) return scarcitiesDoc; // collision → no-op
  // The scarcities schema REQUIRES priced_in/bind_window/durability/substitution_risk to be valid
  // enums. A committee proposal only carries priced_in/bind_window, so the other two must default —
  // otherwise admitting a candidate yields a schema-invalid scarcities.json that breaks the scan (F1).
  // Conservative defaults match the scout draft (the committee can be asked to revise post-admission).
  const entry = {
    id: candidate.id,
    sector: typeof candidate.sector === "string" ? candidate.sector : "Unknown (scout)",
    scarcity: typeof candidate.scarcity === "string" ? candidate.scarcity : candidate.id,
    tickers: Array.isArray(candidate.tickers) ? candidate.tickers.filter((t) => typeof t === "string") : [],
    thesis: typeof candidate.thesis === "string" ? candidate.thesis : "",
    non_consensus: typeof candidate.non_consensus === "boolean" ? candidate.non_consensus : true,
    priced_in: PRICED.includes(candidate.priced_in) ? candidate.priced_in : "low",
    bind_window: BIND.includes(candidate.bind_window) ? candidate.bind_window : "2027",
    durability: DURABILITY.includes(candidate.durability) ? candidate.durability : "medium",
    substitution_risk: RISK.includes(candidate.substitution_risk) ? candidate.substitution_risk : "medium",
    source: "scout",
    last_reviewed: today,
  };
  return { ...scarcitiesDoc, scarcities: [...scarcitiesDoc.scarcities, entry] };
}

// D1 dashboard action: flip every `pending` constraint phrase to `approved` (approved/rejected
// unchanged). Returns a NEW doc (never mutates input); the user commits it via PR, after which the
// weekly sweep is allowed to SEARCH those phrases. Lives here (browser+node) so the dashboard can
// import it without the node-side scout code; the generator/runner read the same scout-phrases.json.
export function approvePendingPhrases(doc, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!doc?.phrases) return doc;
  return { ...doc, phrases: doc.phrases.map((p) => p.status === "pending" ? { ...p, status: "approved", approved: today } : { ...p }) };
}
