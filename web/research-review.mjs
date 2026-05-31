// Front-end research review: turn the bot's LLM proposals into an in-dashboard Accept/Reject
// flow. PURE + browser+node — the UI imports it; tests cover it without a DOM. The same F9
// ownership rule the server enforces is mirrored here: a proposal may ONLY change bot-owned
// fields (priced_in / bind_window / non_consensus); thesis / tickers / id can never be written
// from the browser, no matter what the proposal contains.

export const BOT_OWNED_FIELDS = new Set(["priced_in", "bind_window", "non_consensus"]);
const PRICED = ["low", "medium", "high", "crowded"];
const BIND = ["now", "2027", "2028-29", "2030+", "physics-floor"];

const validField = (field, v) =>
  field === "priced_in" ? PRICED.includes(v)
  : field === "bind_window" ? BIND.includes(v)
  : field === "non_consensus" ? typeof v === "boolean"
  : false;

// Build the human review model: one entry per proposal that actually changes a bot-owned field
// on a REAL scarcity, listing each change as {field, from, to} plus the LLM's reasoning so the
// user can judge it. Proposals that change nothing (or reference an unknown id) are dropped.
export function proposalDiffs(proposals, scarcitiesDoc) {
  const byId = {};
  for (const s of scarcitiesDoc?.scarcities || []) byId[s.id] = s;
  const out = [];
  for (const p of proposals || []) {
    const cur = byId[p?.id];
    if (!cur) continue;
    const changes = [];
    for (const field of BOT_OWNED_FIELDS) {
      if (field in p && validField(field, p[field]) && p[field] !== cur[field]) {
        changes.push({ field, from: cur[field] ?? null, to: p[field] });
      }
    }
    if (!changes.length) continue;
    out.push({
      id: p.id, scarcity: cur.scarcity, changes,
      rationale: typeof p.rationale === "string" ? p.rationale : "",
      sources: Array.isArray(p.sources) ? p.sources : [],
      confidence: typeof p.confidence === "number" ? p.confidence : null,
      prompt_version: p.prompt_version ?? null,
    });
  }
  return out;
}

// Apply ONE accepted proposal to the scarcities document, F9-guarded. Returns a NEW document
// (never mutates the input); only valid bot-owned fields are written; everything else in the
// proposal is ignored; an unknown id is a no-op. Stamps last_reviewed for the audit trail.
export function applyAcceptance(scarcitiesDoc, proposal, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!scarcitiesDoc?.scarcities || !proposal?.id) return scarcitiesDoc;
  let touched = false;
  const scarcities = scarcitiesDoc.scarcities.map((s) => {
    if (s.id !== proposal.id) return s;
    const next = { ...s };
    let changed = false;
    for (const field of BOT_OWNED_FIELDS) {
      if (field in proposal && validField(field, proposal[field]) && proposal[field] !== s[field]) {
        next[field] = proposal[field]; changed = true;
      }
    }
    if (changed) { next.last_reviewed = today; touched = true; }
    return next;
  });
  return touched ? { ...scarcitiesDoc, scarcities } : scarcitiesDoc;
}
