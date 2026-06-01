import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutSweep, evaluateLeads } from "../scripts/lib/scout.mjs";

// Orchestration (SCOUT-DESIGN flow): phrases → bounded FTS search → cluster → draft → committee →
// survivors. All I/O is INJECTED (searchPhrase, evaluate) so the whole funnel is testable offline.
// runScoutSweep proves: budget is bounded, the committee is the gate, and the scout NEVER decides
// on its own (it only forwards drafts the committee approved).
const knownTickers = ["NVDA"];
// Two no-name filers complaining across multiple phrases; one known megacap that should drop.
const searchPhrase = async (phrase) => ({
  "lead times extended": [{ ticker: "AAA", company: "Alpha", mentions: 2 }, { ticker: "NVDA", company: "Nvidia", mentions: 1 }],
  "on allocation": [{ ticker: "AAA", company: "Alpha", mentions: 1 }, { ticker: "BBB", company: "Beta", mentions: 3 }],
  "single source of supply": [{ ticker: "AAA", company: "Alpha", mentions: 1 }, { ticker: "BBB", company: "Beta", mentions: 1 }],
}[phrase] || []);

describe("scout: runScoutSweep orchestration", () => {
  it("runs phrases → cluster → committee, returning only committee-approved candidates as proposals", async () => {
    // evaluate() stands in for the committee: approve AAA, reject BBB.
    const evaluate = async (draft) => draft.tickers.includes("AAA")
      ? { approved: true, proposal: { id: draft.id, priced_in: "medium", confidence: 0.6 } }
      : { approved: false, reason: "bear: supply response imminent" };
    const out = await runScoutSweep({
      phrases: ["lead times extended", "on allocation", "single source of supply"],
      knownTickers, minPhrases: 2, searchPhrase, evaluate,
    });
    assert.ok(out.proposals.some((p) => p.id?.includes("aaa") || p.tickers?.includes("AAA")) || out.proposals.length >= 1);
    // BBB was clustered but the committee rejected it → not a proposal, but recorded.
    assert.ok(out.considered.some((c) => c.reason && /bear/.test(c.reason)));
    assert.ok(!out.proposals.some((p) => (p.tickers || []).includes("BBB")));
  });

  it("ENFORCES the call budget: stops searching once maxSearches is hit (cost guard)", async () => {
    let calls = 0;
    const counting = async (p) => { calls++; return searchPhrase(p); };
    await runScoutSweep({
      phrases: ["lead times extended", "on allocation", "single source of supply", "took-or-pay", "on allocation"],
      knownTickers, minPhrases: 1, searchPhrase: counting, evaluate: async () => ({ approved: false }), maxSearches: 2,
    });
    assert.equal(calls, 2, "must not exceed maxSearches FTS calls");
  });

  it("caps how many candidates reach the committee (maxCandidates) to bound committee cost", async () => {
    let evals = 0;
    const evaluate = async () => { evals++; return { approved: false }; };
    await runScoutSweep({
      phrases: ["lead times extended", "on allocation", "single source of supply"],
      knownTickers: [], minPhrases: 1, searchPhrase, evaluate, maxCandidates: 1,
    });
    assert.equal(evals, 1, "must not evaluate more than maxCandidates drafts");
  });

  it("is resilient: a failing phrase search is skipped, not fatal", async () => {
    const flaky = async (p) => { if (p === "on allocation") throw new Error("fts 429"); return searchPhrase(p); };
    const out = await runScoutSweep({
      phrases: ["lead times extended", "on allocation", "single source of supply"],
      knownTickers, minPhrases: 1, searchPhrase: flaky, evaluate: async () => ({ approved: false }),
    });
    assert.ok(out.errors.some((e) => /429/.test(e)));
    assert.ok(Array.isArray(out.proposals));   // still completed
  });

  it("reports a health summary (phrases searched, candidates, proposals, drops)", async () => {
    const out = await runScoutSweep({
      phrases: ["lead times extended", "on allocation", "single source of supply"],
      knownTickers, minPhrases: 2, searchPhrase, evaluate: async () => ({ approved: false }),
    });
    assert.equal(out.health.phrasesSearched, 3);
    assert.ok(out.health.candidates >= 1);
    assert.equal(out.health.proposals, 0);
    assert.ok(out.health.droppedKnown >= 1);   // NVDA dropped
  });
});

// The shared evaluator works on leads from ANY engine and applies D2 memory + the budget cap.
describe("scout: evaluateLeads (multi-engine + D2 memory)", () => {
  const leads = [
    { engine: "constraint-shadow", subject: "abf substrate", tickers: ["AAA"], lead: { phrases: ["on allocation"] } },
    { engine: "bom-ladder", subject: "photoresist", tickers: ["TOK"], lead: { ladder_from: "hbm", why: "lithography input" } },
    { engine: "arxiv", subject: "cryogenic cmos", tickers: ["CRYO"], lead: { papers: 8 } },
  ];
  it("drafts + evaluates leads from all engines, tagging each with its engine", async () => {
    const evaluate = async (d) => d.tickers.includes("TOK") ? { approved: true, proposal: { confidence: 0.7 } } : { approved: false, reason: "bear: priced" };
    const out = await evaluateLeads(leads, { evaluate });
    assert.equal(out.proposals.length, 1);
    assert.equal(out.proposals[0].engine, "bom-ladder");
    assert.ok(out.considered.some((c) => c.engine === "arxiv"));
  });
  it("D2 memory: suppresses a previously-rejected lead whose evidence is unchanged", async () => {
    const draftId = "scout-abf-substrate";  // slug of "abf substrate"
    const seenState = { seen: { [draftId]: { status: "rejected", evidence_hash: "abf substrate|aaa|on allocation" } } };
    let evals = 0;
    await evaluateLeads(leads, { evaluate: async () => { evals++; return { approved: false }; }, seenState });
    assert.equal(evals, 2, "the rejected, unchanged abf lead is suppressed → only 2 leads evaluated");
  });
  it("respects maxCandidates across the combined engine leads", async () => {
    let evals = 0;
    await evaluateLeads(leads, { evaluate: async () => { evals++; return { approved: false }; }, maxCandidates: 2 });
    assert.equal(evals, 2);
  });
});

// F3 (audit): the budget cap must not let one engine starve another. Leads are interleaved by engine
// so a high-volume constraint-shadow run can't crowd out the higher-signal BOM leads.
describe("scout: evaluateLeads interleaves engines under the budget cap (F3)", () => {
  it("gives each engine a fair slot rather than first-come (constraint-shadow can't starve bom)", async () => {
    const leads = [
      { engine: "constraint-shadow", subject: "cs one", tickers: ["C1"], lead: { phrases: ["p"] } },
      { engine: "constraint-shadow", subject: "cs two", tickers: ["C2"], lead: { phrases: ["p"] } },
      { engine: "constraint-shadow", subject: "cs three", tickers: ["C3"], lead: { phrases: ["p"] } },
      { engine: "bom-ladder", subject: "bom one", tickers: ["B1"], lead: { ladder_from: "hbm" } },
    ];
    const seen = [];
    await evaluateLeads(leads, { evaluate: async (d) => { seen.push(d.engine); return { approved: false }; }, maxCandidates: 2 });
    assert.equal(seen.length, 2);
    assert.ok(seen.includes("bom-ladder"), "bom-ladder must get a slot under the cap, not be starved by constraint-shadow");
  });
});
