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
  const entry = {
    id: candidate.id,
    sector: typeof candidate.sector === "string" ? candidate.sector : "Unknown (scout)",
    scarcity: typeof candidate.scarcity === "string" ? candidate.scarcity : candidate.id,
    tickers: Array.isArray(candidate.tickers) ? candidate.tickers.filter((t) => typeof t === "string") : [],
    thesis: typeof candidate.thesis === "string" ? candidate.thesis : "",
    non_consensus: typeof candidate.non_consensus === "boolean" ? candidate.non_consensus : true,
    source: "scout",
    last_reviewed: today,
  };
  if (PRICED.includes(candidate.priced_in)) entry.priced_in = candidate.priced_in;
  if (BIND.includes(candidate.bind_window)) entry.bind_window = candidate.bind_window;
  if (DURABILITY.includes(candidate.durability)) entry.durability = candidate.durability;
  if (RISK.includes(candidate.substitution_risk)) entry.substitution_risk = candidate.substitution_risk;
  return { ...scarcitiesDoc, scarcities: [...scarcitiesDoc.scarcities, entry] };
}
