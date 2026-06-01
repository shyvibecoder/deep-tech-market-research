#!/usr/bin/env node
// Scarcity SCOUT runner (docs/SCOUT-DESIGN.md). Surveils SEC full-text for CONSTRAINT-language
// complaints, clusters filers under broad supply stress into candidate NEW scarcities, synthesizes a
// draft for each, and runs it through the SAME investment committee that scores the known 24. Only
// committee-approved survivors are published to a SEPARATE scout feed (web/data/scout-candidates.json)
// for human PR approval (F9 — humans own scarcities.json). The DECISION logic is the pure, tested
// scout.mjs + research.mjs; this runner just injects the real I/O. Best-effort: any hiccup logs and
// exits 0 (the scout must never fail the workflow), and it's hard-budgeted so a sweep can't run away.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableProviders, probeProviders, planCommittee, seatCaller, llm } from "./lib/llm.mjs";
import { runScoutSweep, DEFAULT_CONSTRAINT_PHRASES } from "./lib/scout.mjs";
import { runCommittee, sanitizeEdit } from "./lib/research.mjs";
import { searchFts } from "./lib/edgar-fts.mjs";
import { newsForQuery } from "./lib/news.mjs";
import { buildEvidenceBundle } from "./lib/research-sources.mjs";

const read = (p) => { try { return JSON.parse(readFileSync(new URL(`../web/data/${p}`, import.meta.url))); } catch { return null; } };
const date = new Date().toISOString().slice(0, 10);

const scar = read("scarcities.json");
const knownTickers = [...new Set((scar?.scarcities || []).flatMap((s) => s.tickers || []))];

// Budget knobs (D-cadence/budget): keep a weekly sweep bounded + cheap. Tunable via repo variables.
const maxSearches = Math.max(1, Number(process.env.SCOUT_MAX_SEARCHES) || 12);
const maxCandidates = Math.max(1, Number(process.env.SCOUT_MAX_CANDIDATES) || 6);
const minPhrases = Math.max(1, Number(process.env.SCOUT_MIN_PHRASES) || 2);

const providers = availableProviders();
if (!providers.length) { console.log("scout: skipped — no LLM key set"); process.exit(0); }

// Same committee wiring as research-run: liveness probe → independent chair + live seats.
const frontier = providers.find((p) => p === "anthropic" || p === "openai") || null;
const probes = await probeProviders(providers);
const live = Object.fromEntries(probes.map((r) => [r.provider, r.ok]));
for (const r of probes) console.log(`  ${r.ok ? "✓" : "✗"} ${r.provider} ${r.ok ? "live" : "DOWN — " + r.error}`);
const plan = planCommittee(providers);
const seats = plan.seats.map((s) => (live[s.provider] === false && frontier && live[frontier] ? seatCaller(frontier, null) : seatCaller(s.provider, s.model)));
const chair = plan.chair && live[plan.chair.provider] ? seatCaller(plan.chair.provider, plan.chair.model) : null;
console.log(`scout: committee chair=${plan.chair?.provider} | budget: ${maxSearches} searches, ${maxCandidates} candidates, minPhrases=${minPhrases}`);

// Real FTS sweep: wrap searchFts (pure parse already tested) + be polite to SEC between calls.
const searchPhrase = async (phrase) => { const hits = await searchFts(phrase); await new Promise((r) => setTimeout(r, 150)); return hits; };

// The committee IS the gate (committee-first, SCOUT-DESIGN): gather light evidence for the draft, run
// the adversarial seats + CIO, and approve only a confident, changed call (mirrors proposeScarcityEdits).
const evaluate = async (draft) => {
  let news = [];
  try { news = await newsForQuery(draft.scarcity, { limit: 4 }); } catch { /* evidence is best-effort */ }
  const evidence = buildEvidenceBundle({ scarcity: draft, news });
  const memo = await runCommittee({ scarcity: draft, evidence, seats, chair });
  if (!memo.cio) return { approved: false, reason: `no committee response${memo.errors.length ? `: ${memo.errors[0]}` : ""}` };
  const edit = sanitizeEdit(draft, memo.cio);
  // A scout lead is worth surfacing if the committee gives it a confident read; the human still
  // approves admission to the watchlist (F9). We do NOT require "changed" here (it's a NEW scarcity).
  if (!edit || (edit.confidence ?? 0) < 0.5) return { approved: false, reason: `low committee confidence (${edit?.confidence ?? 0})` };
  return { approved: true, proposal: { ...edit, scarcity: draft.scarcity, dispersion: memo.dispersion, complaining_filer: draft.complaining_filer } };
};

try {
  const out = await runScoutSweep({ phrases: DEFAULT_CONSTRAINT_PHRASES, knownTickers, minPhrases, maxSearches, maxCandidates, searchPhrase, evaluate });
  console.log(`scout: ${out.health.phrasesSearched} phrases → ${out.health.candidates} candidate(s) → ${out.proposals.length} proposal(s); dropped ${out.health.droppedKnown} known. errors=${out.errors.length}`);
  for (const e of out.errors) console.log(`  ⚠ ${e}`);
  // Publish to the SEPARATE scout feed (D3) — distinct from the committee's re-scores of the known 24.
  mkdirSync(new URL("../web/data/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../web/data/scout-candidates.json", import.meta.url),
    JSON.stringify({ schema_version: 1, generated: date, chair: plan.chair?.provider || null, health: out.health, candidates: out.proposals, considered: out.considered }, null, 2) + "\n");
  console.log(`scout: wrote web/data/scout-candidates.json (${out.proposals.length} candidate scarcities for human review)`);
} catch (e) {
  console.log(`scout: errored (non-fatal): ${e.message}`);
}
