// Research orchestration: deep-dive (model A) → red-team (model B) → synthesis (A),
// gated and sanitized so the bot can ONLY propose F9-owned fields with enough
// confidence. LLM functions are INJECTED, so the logic is fully unit-testable without
// network/keys (in prod they're bound to the free providers).
import { deepDivePrompt, redTeamPrompt, synthesisPrompt, seatPrompt, cioPrompt, croPrompt, RESEARCH_PROMPT_VERSION } from "./research-prompts.mjs";
import { verifyProposal } from "./research-verify.mjs";

const PRICED = ["low", "medium", "high", "crowded"];
const BIND = ["now", "2027", "2028-29", "2030+", "physics-floor"];

// Phase 3: evidence triangulation. Edge lives where INDEPENDENT sources disagree. We can derive the
// TAPE lean mechanically (de-rating flag + price momentum); filing/news *sentiment* is left to the
// LLM seats (we don't fake an NLP classifier). The high-signal mechanical flag is
// "fundamentals-vs-price divergence": a thesis the market already loves (high/crowded) whose tape is
// de-rating — often where the real call is. Pure + tested; the note is injected into the seat prompts.
export function triangulate(evidence) {
  const ev = evidence || {};
  const ec = ev.evidence_count || {};
  const q = Object.values(ev.quotes || {}).filter(Boolean);
  const lanes = {
    filings: ec.filing_passages || 0,
    news: ec.news_with_excerpt || ec.news || 0,
    tape: q.length > 0 || !!ev.signals,
    positioning: ev.signals?.forced_flow != null || ev.signals?.opportunity != null,
  };
  // Mechanical tape lean: de-rating flag and/or broadly negative momentum → "weak"; firmly positive
  // → "strong"; otherwise neutral.
  const avg = (k) => q.length ? q.reduce((a, x) => a + (typeof x[k] === "number" ? x[k] : 0), 0) / q.length : 0;
  const mom = avg("mom_1m") + avg("vs200");
  const deRating = ev.signals?.de_rating === "de-rating" || ev.signals?.de_rating === true;
  const lean = (deRating || mom < -0.05) ? "weak" : (mom > 0.05 && !deRating) ? "strong" : "neutral";
  const tape = { lean, detail: `de_rating=${ev.signals?.de_rating ?? "—"}, mom≈${mom.toFixed(2)}` };

  const hasSubstance = lanes.filings > 0 || lanes.news > 0 || q.length > 0;
  const loved = ev.priced_in === "high" || ev.priced_in === "crowded";
  let divergence = null, note = "";
  if (!hasSubstance) { divergence = "thin-evidence"; note = "Thin evidence — few independent sources; keep confidence low."; }
  else if (loved && lean === "weak") {
    divergence = "fundamentals-vs-price";
    note = `Fundamentals-vs-price divergence: consensus rates this ${ev.priced_in} but the TAPE is de-rating (${tape.detail}). Weigh whether the fundamental story still holds or the market is right early.`;
  } else {
    note = `Lanes — filings:${lanes.filings} news:${lanes.news} tape:${lean}. No strong cross-source divergence; weight independent corroboration over any single loud source.`;
  }
  return { lanes, tape, divergence, note };
}

export function parseProposal(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const str = (v, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
// A kill-criterion is only useful if it's FALSIFIABLE: a concrete condition AND a date by which it
// resolves. Accept YYYY, YYYY-MM, or YYYY-MM-DD; reject vague "someday" text.
const KILL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
function cleanKill(k) {
  if (!k || typeof k !== "object") return null;
  const condition = str(k.condition, 300);
  const by_date = typeof k.by_date === "string" && KILL_DATE.test(k.by_date.trim()) ? k.by_date.trim() : null;
  return condition && by_date ? { condition, by_date } : null;
}

// Enforce F9 ownership in CODE: keep only bot-owned, validated fields. Never thesis/tickers/id.
// Phase 1 also carries DESCRIPTIVE hedge-fund fields (variant_view / bear_case / kill_criterion):
// these never mutate scarcities.json — they ride on the proposal for the human reviewer + the
// report. Still F9: thesis/tickers/id/sector can never appear in the output.
export function sanitizeEdit(scarcity, raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (PRICED.includes(raw.priced_in)) out.priced_in = raw.priced_in;
  if (BIND.includes(raw.bind_window)) out.bind_window = raw.bind_window;
  if (typeof raw.non_consensus === "boolean") out.non_consensus = raw.non_consensus;
  out.confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  const rationale = str(raw.rationale); if (rationale) out.rationale = rationale;
  const variant = str(raw.variant_view); if (variant) out.variant_view = variant;
  const bear = str(raw.bear_case); if (bear) out.bear_case = bear;
  const kill = cleanKill(raw.kill_criterion); if (kill) out.kill_criterion = kill;
  return out;
}

// Dispersion across the committee seats' honest priced_in reads — a conviction proxy. Tight
// agreement = higher conviction; wide = low conviction (the CIO must cut confidence / size small).
// Reuses the strict-majority logic; invalid/missing reads are ignored. Soft signal, not truth.
export function dispersion(reads) {
  const { priced_in, agreement, n } = ensembleConsensus((reads || []).map((r) => ({ priced_in: r })));
  const counts = {};
  for (const r of (reads || [])) if (PRICED.includes(r)) counts[r] = (counts[r] || 0) + 1;
  const distinct = Object.keys(counts).length;
  const level = n === 0 ? "wide"
    : distinct === 1 ? "tight"
    : priced_in ? "moderate"        // a strict majority exists but isn't unanimous
    : "wide";                       // no majority
  return { level, agreement, n, reads: counts };
}

// Ensemble gate: a priced_in reassessment is only robust if INDEPENDENT models agree.
// Take the deep-dive proposal from each model, require a strict majority on priced_in,
// and report the agreement ratio (used to scale confidence). A lone model's call — which
// could be a hallucination — never surfaces on its own. Pure + tested.
export function ensembleConsensus(proposals) {
  const vals = (proposals || []).map((p) => p?.priced_in).filter((v) => PRICED.includes(v));
  if (!vals.length) return { priced_in: null, agreement: 0, n: 0 };
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const [top, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { priced_in: topCount > vals.length / 2 ? top : null, agreement: +(topCount / vals.length).toFixed(2), n: vals.length };
}

const changed = (s, e) =>
  (e.priced_in && e.priced_in !== s.priced_in) ||
  (e.bind_window && e.bind_window !== s.bind_window) ||
  (typeof e.non_consensus === "boolean" && e.non_consensus !== s.non_consensus);

// Phase 2: run a synthetic investment committee for ONE scarcity. bull/bear/skeptic seats run on
// (ideally different) injected model fns; each returns an honest priced_read; the CIO weighs the
// debate (with dispersion) into a final edit. Seat failures are captured loudly; the CIO still runs
// on survivors. Returns null cio only when EVERY seat failed. Pure given injected seats → testable.
// Bounded-concurrency map: run `fn` over `items` at most `limit` in flight, preserving input order.
// Lets us parallelize without firing every call at once (which would 429 the free tiers). A worker
// error rejects the whole map (callers wrap per-item where partial failure is acceptable).
export async function mapLimit(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, list.length || 1));
  const workers = Array.from({ length: n }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runCommittee({ scarcity, evidence = {}, seats, scorecard = null }) {
  const pool = (seats || []).filter(Boolean);
  const roles = ["bull", "bear", "skeptic"];
  const out = { seats: {}, dispersion: null, cio: null, errors: [] };
  const reads = [];
  // Seats are INDEPENDENT → run them concurrently (≈1 round instead of 3). Each captures its own
  // failure so one dead provider can't sink the others; the CIO then runs on whoever answered.
  await Promise.all(roles.map(async (role, i) => {
    const fn = pool[i] || pool[0];           // degrade: reuse the only model if fewer keys
    if (!fn) return;
    try {
      const r = parseProposal(await fn(seatPrompt(role, scarcity, evidence, scorecard))) || {};
      out.seats[role] = r;
      if (PRICED.includes(r.priced_read)) reads.push(r.priced_read);
    } catch (e) { if (!out.errors.includes(e.message)) out.errors.push(e.message); }
  }));
  if (!Object.keys(out.seats).length) return out;   // every seat failed → caller records no-response
  out.dispersion = dispersion(reads);
  const cioFn = pool[0];
  try { out.cio = parseProposal(await cioFn(cioPrompt(scarcity, out.seats, out.dispersion))) || null; }
  catch (e) { if (!out.errors.includes(e.message)) out.errors.push(e.message); }
  return out;
}

// CHIEF RISK OFFICER review (trust lever #3): an independent model pass over the committee's edit,
// doing the FUZZY checks code can't — hallucinated/misattributed tickers, illogical thesis,
// momentum-chasing. APPROVE passes through; REVISE docks confidence; VETO drops the proposal.
// FAIL-OPEN: any CRO error or unparseable verdict keeps the proposal (we never silently drop on an
// infra hiccup) — the deterministic gate already caught the hard stuff. Pure given an injected `cro`.
export async function croReview({ scarcity, edit, evidence = {}, cro }) {
  if (!cro || !edit) return { veto: false, edit, error: "" };
  let v;
  try { v = parseProposal(await cro(croPrompt(scarcity, edit, evidence))); }
  catch (e) { return { veto: false, edit, error: e.message }; }
  if (!v || typeof v.verdict !== "string") return { veto: false, edit };   // unparseable → approve
  const verdict = v.verdict.toLowerCase();
  if (verdict === "veto") return { veto: true, edit, reason: typeof v.reason === "string" ? v.reason : "CRO veto" };
  if (verdict === "revise") {
    const adj = typeof v.confidence_adj === "number" ? Math.min(0, v.confidence_adj) : 0;
    const next = { ...edit, confidence: +Math.max(0, (edit.confidence || 0) + adj).toFixed(3) };
    if (typeof v.reason === "string") next.cro_note = v.reason;
    return { veto: false, edit: next };
  }
  return { veto: false, edit };   // approve
}

// Build one "considered" audit entry (pure — so it's safe to create inside concurrent workers and
// merge in order later, rather than pushing to a shared array mid-flight).
function noteOf(s, reason, edit, error) {
  return {
    id: s.id, scarcity: s.scarcity, reason,
    priced_in: edit?.priced_in ?? null, bind_window: edit?.bind_window ?? null,
    non_consensus: typeof edit?.non_consensus === "boolean" ? edit.non_consensus : null,
    confidence: edit?.confidence ?? null, rationale: edit?.rationale || "", error: error || "",
  };
}

export async function proposeScarcityEdits({ scarcities, evidence = {}, analyst, analysts = null, redteam, seats = null, cro = null, scorecard = null, minConfidence = 0.6, concurrency = 4 }) {
  const pool = analysts && analysts.length ? analysts : (analyst ? [analyst] : []);
  const primary = pool[0];
  const proposals = [];
  // Audit trail: every scarcity the engine looked at but did NOT propose, and WHY. This makes a
  // "0 proposals" run inspectable — you can see it reasoned (low confidence / split models / a
  // confident no-change) rather than silently shrugged. A scarcity is in exactly one of
  // proposals/considered, never both.
  const considered = [];
  const note = (s, reason, edit, error) => considered.push(noteOf(s, reason, edit, error));
  // COMMITTEE MODE (Phase 2): bull/bear/skeptic → CIO per scarcity. Scarcities are INDEPENDENT, so we
  // run them with bounded concurrency (default 4) for a big speedup, then merge results IN INPUT ORDER
  // so the report is deterministic run-to-run. Each scarcity returns a tagged outcome.
  if (seats && seats.length) {
    const results = await mapLimit(scarcities, concurrency, async (s) => {
      const ev = evidence[s.id] || {};
      const memo = await runCommittee({ scarcity: s, evidence: ev, seats, scorecard });
      if (!memo.cio) return { kind: "considered", entry: noteOf(s, "no-response", null, memo.errors.join(" | ")) };
      const edit = sanitizeEdit(s, memo.cio);
      if (memo.dispersion) edit.dispersion = { level: memo.dispersion.level, agreement: memo.dispersion.agreement };
      const tri = triangulate(ev);
      if (tri.divergence) edit.divergence_flag = tri.divergence;
      // DETERMINISTIC VERIFICATION GATE (trust layer): hard-fail kills momentum traps + unsupported
      // overconfidence outright; soft flags dock confidence and ride on the proposal for the report.
      const vr = verifyProposal(s, edit, ev);
      if (vr.flags.length) edit.verify_flags = vr.flags;
      if (vr.penalty) edit.confidence = +Math.max(0, edit.confidence - vr.penalty).toFixed(3);
      if (vr.hardFail) {
        const why = vr.flags.filter((f) => f.code === "price-contradiction" || f.code === "thin-evidence-overconfident");
        const entry = noteOf(s, "verification-failed", edit);
        entry.rationale = why.map((f) => `${f.code}: ${f.detail}`).join(" | ");
        return { kind: "considered", entry };
      }
      if (edit && edit.confidence >= minConfidence && changed(s, edit)) {
        // CRO REVIEW (trust lever #3): only review calls that would actually be proposed (saves a
        // model call on every no-change). A veto drops it; a revise may push it back below threshold.
        if (cro) {
          const rv = await croReview({ scarcity: s, edit, evidence: ev, cro });
          if (rv.veto) {
            const entry = noteOf(s, "cro-vetoed", rv.edit);
            entry.rationale = rv.reason || "CRO veto";
            return { kind: "considered", entry };
          }
          if (rv.edit.confidence < minConfidence) {
            return { kind: "considered", entry: noteOf(s, "below-confidence", rv.edit) };
          }
          return { kind: "proposal", entry: { id: s.id, ...rv.edit, prompt_version: RESEARCH_PROMPT_VERSION } };
        }
        return { kind: "proposal", entry: { id: s.id, ...edit, prompt_version: RESEARCH_PROMPT_VERSION } };
      }
      return { kind: "considered", entry: noteOf(s, !edit || !changed(s, edit) ? "no-change" : "below-confidence", edit) };
    });
    for (const r of results) (r.kind === "proposal" ? proposals : considered).push(r.entry);
    return { proposals, considered, report: buildReport(proposals, scorecard, considered) };
  }

  for (const s of scarcities) {
    const ev = evidence[s.id] || {};
    // Deep-dive on every model in the pool. Capture ALL distinct errors so a dead/retired model is
    // reported with its reason instead of vanishing into an empty string (the old silent-fail trap).
    // Collecting every error (not just the first) is what reveals a SECOND provider also failing —
    // e.g. "Gemini 429" hiding the fact that Groq returned nothing too.
    const raws = [];
    const errs = [];
    for (const fn of pool) {
      try { raws.push(parseProposal(await fn(deepDivePrompt(s, ev, scorecard)))); }
      catch (e) { if (!errs.includes(e.message)) errs.push(e.message); raws.push(null); }
    }
    // Resilient: anchor on the first model that actually produced a parseable call, not raws[0].
    // One dead provider must not zero out the whole run when another model answered.
    const good = raws.filter(Boolean);
    let a = good[0];
    if (!a) { note(s, "no-response", null, errs.join(" | ")); continue; }
    // Multi-model: require a strict majority on priced_in across the models that DID answer, else
    // this call isn't robust → skip. A lone surviving model falls through to single-model handling.
    let ensemble = null;
    if (good.length >= 2) {
      ensemble = ensembleConsensus(good);
      if (!ensemble.priced_in) { note(s, "no-majority", a); continue; }
      a = { ...a, priced_in: ensemble.priced_in }; // the ensemble owns the direction
    }
    let critique = ""; try { critique = await redteam(redTeamPrompt(s, a)); } catch { critique = ""; }
    let finRaw; try { finRaw = parseProposal(await primary(synthesisPrompt(s, a, critique))) || a; } catch { finRaw = a; }
    const edit = sanitizeEdit(s, finRaw);
    if (edit && ensemble) {
      edit.priced_in = ensemble.priced_in;                              // ensemble direction is authoritative
      edit.confidence = +(edit.confidence * ensemble.agreement).toFixed(3); // split models → less confident
      edit.ensemble = { agreement: ensemble.agreement, models: ensemble.n };
    }
    if (edit && edit.confidence >= minConfidence && changed(s, edit)) {
      proposals.push({ id: s.id, ...edit, prompt_version: RESEARCH_PROMPT_VERSION });
    } else {
      // Distinguish "the bar was too high" from "the engine confidently saw no change" — both are
      // healthy, but only the audit trail lets a human tell them apart.
      note(s, !edit || !changed(s, edit) ? "no-change" : "below-confidence", edit);
    }
  }
  return { proposals, considered, report: buildReport(proposals, scorecard, considered) };
}

export function buildReport(proposals, scorecard, considered = []) {
  const head = `# Auto-research proposals (prompt v${RESEARCH_PROMPT_VERSION})\n\n` +
    `Tilt hit-rate prior: ${scorecard?.hit_rate != null ? (scorecard.hit_rate * 100).toFixed(0) + "%" : "n/a"}. ` +
    `Human-approved only; bot-owned fields (priced_in/bind_window/non_consensus) per ARCHITECTURE §1.\n`;
  const body = proposals.length
    ? "\n## Proposed\n" + proposals.map((p) => {
        const conv = p.dispersion ? `, ${p.dispersion.level} conviction` : "";
        const lines = [
          `- **${p.id}** → priced_in=${p.priced_in ?? "—"}, bind=${p.bind_window ?? "—"}, non_consensus=${p.non_consensus ?? "—"} (conf ${p.confidence}${p.ensemble ? `, ${Math.round(p.ensemble.agreement * 100)}% of ${p.ensemble.models} models agree` : ""}${conv})`,
          `  - ${p.rationale || ""}`,
        ];
        if (p.variant_view) lines.push(`  - Variant: ${p.variant_view}`);
        if (p.bear_case) lines.push(`  - Bear: ${p.bear_case}`);
        if (p.divergence_flag) lines.push(`  - Divergence: ${p.divergence_flag}`);
        if (p.verify_flags?.length) lines.push(`  - Checks: ${p.verify_flags.map((f) => f.code).join(", ")}`);
        if (p.kill_criterion) lines.push(`  - Wrong if: ${p.kill_criterion.condition} (by ${p.kill_criterion.by_date})`);
        return lines.join("\n");
      }).join("\n") + "\n"
    : "\nNo changes proposed this run.\n";
  return head + body + buildConsidered(considered);
}

// The discipline trail: per scarcity that wasn't proposed, what the ensemble concluded and why it
// was dropped. Turns a bare "0 proposals" into something a human can actually audit.
const REASON_LABEL = {
  "no-change": "confident no-change", "below-confidence": "below confidence bar",
  "no-majority": "models split (no priced_in majority)", "no-response": "no usable model output",
  "verification-failed": "❌ failed an automated check (likely momentum trap / unsupported)",
  "cro-vetoed": "❌ vetoed by the Chief-Risk-Officer review (hallucination / logic flaw)",
};
function buildConsidered(considered) {
  if (!considered?.length) return "";
  return "\n## Considered but not proposed\n" + considered.map((c) => {
    const conf = c.confidence != null ? `, conf ${c.confidence}` : "";
    const would = c.priced_in ? ` [would say priced_in=${c.priced_in}]` : "";
    const err = c.error ? ` — ⚠ ${c.error}` : "";
    return `- **${c.id}** — ${REASON_LABEL[c.reason] || c.reason}${conf}${would}${err}` + (c.rationale ? `\n  - ${c.rationale}` : "");
  }).join("\n") + "\n";
}
