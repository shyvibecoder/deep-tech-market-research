import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePhrases, mergePhraseDoc, approvedPhrases, generateConstraintPhrases, DEFAULT_CONSTRAINT_PHRASES } from "../scripts/lib/scout.mjs";
import { approvePendingPhrases } from "../web/scout-review.mjs";

// D1 (SCOUT-DESIGN): the constraint-phrase list is LLM-GENERATED, HUMAN-VETTED, then CACHED — and a
// generated phrase NEVER triggers a search until approved. These cover the gate: generation, merge
// into a pending/approved doc, the approved-only search gate, and the approve action.
describe("scout D1: parsePhrases (clean LLM output into search phrases)", () => {
  it("extracts phrases from a newline/bulleted/numbered list, trimmed + de-duped", () => {
    const out = parsePhrases(`1. "lead times extended"\n- Unable to secure allocation\n* lead times extended\n  qualified a second source  `);
    assert.deepEqual(out, ["lead times extended", "unable to secure allocation", "qualified a second source"]);
  });
  it("also parses a JSON array response", () => {
    assert.deepEqual(parsePhrases('["on allocation", "took-or-pay"]'), ["on allocation", "took-or-pay"]);
  });
  it("drops too-short / junk lines and caps absurd length", () => {
    const out = parsePhrases("ok\nhi\nsupply remains constrained\n" + "x".repeat(200));
    assert.deepEqual(out, ["supply remains constrained"]);   // "ok"/"hi" too short, 200-char line dropped
  });
});

describe("scout D1: mergePhraseDoc (new phrases land PENDING, existing keep status)", () => {
  const prev = { schema_version: 1, phrases: [
    { phrase: "lead times extended", status: "approved", added: "2026-06-01" },
    { phrase: "took-or-pay", status: "rejected", added: "2026-06-01" },
  ] };
  it("adds genuinely-new phrases as pending and leaves existing ones untouched", () => {
    const doc = mergePhraseDoc(prev, ["lead times extended", "on allocation"], { today: "2026-06-08" });
    const m = Object.fromEntries(doc.phrases.map((p) => [p.phrase, p]));
    assert.equal(m["lead times extended"].status, "approved");      // unchanged
    assert.equal(m["took-or-pay"].status, "rejected");              // unchanged (won't re-add)
    assert.equal(m["on allocation"].status, "pending");             // new → pending
    assert.equal(m["on allocation"].added, "2026-06-08");
  });
  it("is case-insensitive on de-dupe (no near-duplicate pending entries)", () => {
    const doc = mergePhraseDoc(prev, ["LEAD TIMES EXTENDED"], { today: "2026-06-08" });
    assert.equal(doc.phrases.filter((p) => p.phrase.toLowerCase() === "lead times extended").length, 1);
  });
  it("bootstraps from an empty/missing doc", () => {
    const doc = mergePhraseDoc(null, ["on allocation"], { today: "2026-06-08" });
    assert.equal(doc.phrases[0].phrase, "on allocation");
    assert.equal(doc.phrases[0].status, "pending");
  });
});

describe("scout D1: approvedPhrases (the SEARCH GATE — only vetted phrases get searched)", () => {
  it("returns only approved phrases", () => {
    const doc = { phrases: [
      { phrase: "a", status: "approved" }, { phrase: "b", status: "pending" }, { phrase: "c", status: "rejected" },
    ] };
    assert.deepEqual(approvedPhrases(doc), ["a"]);
  });
  it("falls back to the seed list when nothing is approved yet (scout never breaks)", () => {
    assert.deepEqual(approvedPhrases({ phrases: [{ phrase: "b", status: "pending" }] }, { fallback: DEFAULT_CONSTRAINT_PHRASES }), DEFAULT_CONSTRAINT_PHRASES);
    assert.deepEqual(approvedPhrases(null, { fallback: DEFAULT_CONSTRAINT_PHRASES }), DEFAULT_CONSTRAINT_PHRASES);
  });
});

describe("scout D1: generateConstraintPhrases (Anthropic generates; injected for tests)", () => {
  it("calls the model and returns parsed phrases", async () => {
    let prompt = "";
    const complete = async (p) => { prompt = p; return '- lead times extended\n- on allocation'; };
    const out = await generateConstraintPhrases({ complete, count: 15 });
    assert.deepEqual(out, ["lead times extended", "on allocation"]);
    assert.match(prompt, /SEC|filing|10-K|MD&A/i);             // about filing language
  });
  it("the prompt targets STRUCTURAL chokepoints and excludes transient supply-chain noise", async () => {
    let prompt = "";
    await generateConstraintPhrases({ complete: async (p) => { prompt = p; return ""; } });
    assert.match(prompt, /structural|single-source|qualif|allocation/i, "must steer toward durable, hard-to-substitute constraints");
    assert.match(prompt, /shipping|freight|port|tariff|inflation|pandemic/i, "must explicitly exclude transient/macro noise");
    assert.match(prompt, /generic|generalize/i, "must forbid naming specific materials/companies");
  });
});

describe("scout D1: approvePendingPhrases (dashboard approve action)", () => {
  it("flips pending → approved, leaves approved/rejected as-is, never mutates input", () => {
    const doc = { phrases: [
      { phrase: "a", status: "pending" }, { phrase: "b", status: "approved" }, { phrase: "c", status: "rejected" },
    ] };
    const before = JSON.stringify(doc);
    const next = approvePendingPhrases(doc, { today: "2026-06-08" });
    assert.equal(next.phrases.find((p) => p.phrase === "a").status, "approved");
    assert.equal(next.phrases.find((p) => p.phrase === "c").status, "rejected");
    assert.equal(JSON.stringify(doc), before);   // input untouched
  });
});
