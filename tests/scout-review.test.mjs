import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoutCandidateView, appendScoutScarcity } from "../web/scout-review.mjs";

// Front-end review model for the SEPARATE scout feed (D3). Unlike research-review (which diffs
// bot-owned fields on EXISTING scarcities), scout candidates are proposed NEW scarcities → the model
// surfaces the constraint evidence + committee read for a higher-scrutiny "admit to watchlist?"
// decision, and drops any candidate whose id already exists (no accidental duplicates).
const scarDoc = { scarcities: [{ id: "hbm", scarcity: "HBM", tickers: ["MU"] }] };
const feed = {
  generated: "2026-06-02", chair: "anthropic",
  candidates: [
    { id: "scout-abf-substrate", scarcity: "ABF substrate", tickers: ["AAA"], priced_in: "low", bind_window: "2027",
      confidence: 0.64, dispersion: { level: "moderate", agreement: 0.67 }, complaining_filer: "AAA",
      constraint_phrases: ["lead times extended", "on allocation"], rationale: "broad allocation stress" },
    { id: "hbm", scarcity: "HBM dup", tickers: ["MU"], confidence: 0.8 },   // collides with known → drop
  ],
  considered: [{ id: "scout-foo", reason: "bear: substitution imminent" }],
};

describe("scout-review: scoutCandidateView", () => {
  it("builds a review row per NEW candidate with its scout evidence", () => {
    const v = scoutCandidateView(feed, scarDoc);
    assert.equal(v.length, 1);
    const c = v[0];
    assert.equal(c.id, "scout-abf-substrate");
    assert.equal(c.scarcity, "ABF substrate");
    assert.deepEqual(c.tickers, ["AAA"]);
    assert.equal(c.confidence, 0.64);
    assert.equal(c.complaining_filer, "AAA");
    assert.deepEqual(c.constraint_phrases, ["lead times extended", "on allocation"]);
    assert.equal(c.dispersion.level, "moderate");
  });

  it("DROPS a candidate whose id already exists in scarcities (no duplicate admission)", () => {
    const v = scoutCandidateView(feed, scarDoc);
    assert.ok(!v.some((c) => c.id === "hbm"));
  });

  it("handles an empty / missing feed without throwing", () => {
    assert.deepEqual(scoutCandidateView(null, scarDoc), []);
    assert.deepEqual(scoutCandidateView({ candidates: [] }, scarDoc), []);
  });
});

describe("scout-review: appendScoutScarcity (admit a NEW scarcity, F9-safe shape)", () => {
  it("appends a NEW scarcity with only safe, schema-valid fields + an audit stamp", () => {
    const next = appendScoutScarcity(scarDoc, feed.candidates[0], { today: "2026-06-02" });
    assert.equal(next.scarcities.length, 2);
    const added = next.scarcities.find((s) => s.id === "scout-abf-substrate");
    assert.equal(added.priced_in, "low");
    assert.equal(added.bind_window, "2027");
    assert.equal(added.last_reviewed, "2026-06-02");
    assert.equal(added.source, "scout");            // provenance retained
    assert.ok(!("confidence" in added) || typeof added.confidence === "number");
  });

  it("never mutates the input doc and is a no-op on a colliding id", () => {
    const before = JSON.stringify(scarDoc);
    const dup = appendScoutScarcity(scarDoc, { id: "hbm", scarcity: "x" });
    assert.equal(dup.scarcities.length, 1);          // hbm already exists → not added again
    assert.equal(JSON.stringify(scarDoc), before);   // input untouched
  });

  it("rejects a candidate with invalid bot-owned field values (schema guard)", () => {
    const bad = appendScoutScarcity(scarDoc, { id: "scout-bad", scarcity: "Bad", priced_in: "WILD", bind_window: "nope" }, { today: "2026-06-02" });
    const added = bad.scarcities.find((s) => s.id === "scout-bad");
    assert.ok(added, "still admits the scarcity");
    assert.ok(!("priced_in" in added) || ["low", "medium", "high", "crowded"].includes(added.priced_in)); // invalid dropped
    assert.ok(!("bind_window" in added) || ["now", "2027", "2028-29", "2030+", "physics-floor"].includes(added.bind_window));
  });
});
