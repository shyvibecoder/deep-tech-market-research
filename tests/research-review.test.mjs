import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BOT_OWNED_FIELDS, proposalDiffs, applyAcceptance } from "../web/research-review.mjs";

const scarcities = {
  schema_version: 3,
  scarcities: [
    { id: "copper", scarcity: "Copper", priced_in: "high", bind_window: "2030+", non_consensus: false, thesis: "t", tickers: ["FCX"] },
    { id: "gallium", scarcity: "Gallium", priced_in: "low", bind_window: "now", non_consensus: true, thesis: "g", tickers: ["MP"] },
  ],
};

describe("research-review: F9 bot-owned field set", () => {
  it("is exactly priced_in / bind_window / non_consensus (never thesis/tickers/id)", () => {
    assert.deepEqual([...BOT_OWNED_FIELDS].sort(), ["bind_window", "non_consensus", "priced_in"]);
  });
});

describe("research-review: proposalDiffs (before→after view model)", () => {
  const proposals = [
    { id: "copper", priced_in: "crowded", bind_window: "2030+", non_consensus: true, confidence: 0.8, rationale: "rolling over", sources: ["10-K"], prompt_version: 3 },
    { id: "gallium", priced_in: "low", confidence: 0.7, rationale: "no change" }, // no actual change
    { id: "ghost", priced_in: "high" }, // id not in scarcities
  ];
  const diffs = proposalDiffs(proposals, scarcities);

  it("emits a diff only for proposals that actually change a bot-owned field on a real scarcity", () => {
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].id, "copper");
  });
  it("lists each changed field as {field, from, to} + carries rationale/sources/confidence/version", () => {
    const c = diffs[0];
    assert.deepEqual(c.changes.find((x) => x.field === "priced_in"), { field: "priced_in", from: "high", to: "crowded" });
    assert.deepEqual(c.changes.find((x) => x.field === "non_consensus"), { field: "non_consensus", from: false, to: true });
    assert.ok(!c.changes.some((x) => x.field === "bind_window")); // unchanged → not listed
    assert.equal(c.rationale, "rolling over"); assert.deepEqual(c.sources, ["10-K"]); assert.equal(c.confidence, 0.8); assert.equal(c.prompt_version, 3);
    assert.equal(c.scarcity, "Copper");
  });
  it("is safe on empty / missing inputs", () => {
    assert.deepEqual(proposalDiffs([], scarcities), []);
    assert.deepEqual(proposalDiffs(null, scarcities), []);
    assert.deepEqual(proposalDiffs(proposals, { scarcities: [] }), []);
  });
});

describe("research-review: applyAcceptance (F9-guarded mutation)", () => {
  it("updates ONLY bot-owned fields for the accepted id, returns a NEW object (no mutation)", () => {
    const before = JSON.stringify(scarcities);
    const out = applyAcceptance(scarcities, { id: "copper", priced_in: "crowded", non_consensus: true });
    assert.equal(JSON.stringify(scarcities), before); // input untouched
    const cu = out.scarcities.find((s) => s.id === "copper");
    assert.equal(cu.priced_in, "crowded"); assert.equal(cu.non_consensus, true);
    assert.equal(cu.bind_window, "2030+"); // untouched
  });
  it("DROPS any non-bot-owned field in the proposal (thesis/tickers/id can never be written)", () => {
    const out = applyAcceptance(scarcities, { id: "copper", priced_in: "crowded", thesis: "HACKED", tickers: ["EVIL"], scarcity: "X" });
    const cu = out.scarcities.find((s) => s.id === "copper");
    assert.equal(cu.priced_in, "crowded");
    assert.equal(cu.thesis, "t"); assert.deepEqual(cu.tickers, ["FCX"]); assert.equal(cu.scarcity, "Copper");
  });
  it("stamps last_reviewed (audit) and validates enum values", () => {
    const out = applyAcceptance(scarcities, { id: "copper", priced_in: "crowded" }, { today: "2026-05-31" });
    assert.equal(out.scarcities.find((s) => s.id === "copper").last_reviewed, "2026-05-31");
  });
  it("rejects invalid enum values (ignores them, keeps current)", () => {
    const out = applyAcceptance(scarcities, { id: "copper", priced_in: "ULTRA", bind_window: "2099" });
    const cu = out.scarcities.find((s) => s.id === "copper");
    assert.equal(cu.priced_in, "high"); assert.equal(cu.bind_window, "2030+"); // both invalid → unchanged
  });
  it("returns the input unchanged when the id isn't found", () => {
    const out = applyAcceptance(scarcities, { id: "ghost", priced_in: "low" });
    assert.deepEqual(out, scarcities);
  });
});
