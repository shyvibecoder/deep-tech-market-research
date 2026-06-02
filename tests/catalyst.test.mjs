import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalystConsensus, catalystFires, suggestedActionFallback, watchableTriggers } from "../scripts/lib/catalyst.mjs";

describe("catalyst: consensus (corroboration + 2-run confirmation, like the auto triggers)", () => {
  const metBoth = [{ met: true, confidence: 0.8, citations: ["sec:8-K", "reuters"] }, { met: true, confidence: 0.7, citations: ["reuters"] }];
  it("two corroborated met seats → likely-met (first run), not yet fired", () => {
    const c = catalystConsensus(metBoth, null);
    assert.equal(c.status, "likely-met");
    assert.equal(c.met, true);
    assert.equal(c.confidence, 0.75);
    assert.deepEqual(c.citations.sort(), ["reuters", "sec:8-K"]);
  });
  it("a SECOND consecutive elevated run confirms → fired", () => {
    const c = catalystConsensus(metBoth, { status: "likely-met" });
    assert.equal(c.status, "fired");
    assert.ok(catalystFires(c));
  });
  it("met but only ONE source → not corroborated → approaching, never fires on one headline", () => {
    const c = catalystConsensus([{ met: true, confidence: 0.9, citations: ["x"] }, { met: true, confidence: 0.9, citations: ["x"] }], { status: "likely-met" });
    assert.equal(c.corroborated, false);
    assert.equal(c.met, false);
    assert.equal(c.status, "approaching");
    assert.ok(!catalystFires(c));
  });
  it("high corroboration but low confidence → approaching (below the bar)", () => {
    const c = catalystConsensus([{ met: true, confidence: 0.45, citations: ["a", "b"] }, { met: false, confidence: 0.2, citations: ["c"] }], { status: "likely-met" });
    assert.ok(c.confidence < 0.6 || c.status !== "fired");
    assert.notEqual(c.status, "fired");
  });
  it("minority met → not met", () => {
    const c = catalystConsensus([{ met: true, confidence: 0.9, citations: ["a", "b"] }, { met: false, confidence: 0.1, citations: [] }, { met: false, confidence: 0.1, citations: [] }]);
    assert.equal(c.met, false);
  });
  it("no verdicts → monitoring (no crash)", () => assert.equal(catalystConsensus([], null).status, "monitoring"));
});

describe("catalyst: suggested-action fallback + watchable filter", () => {
  it("enriches the canned action with live position context", () => {
    const s = suggestedActionFallback({ action: "Cut MP." }, { weightPct: 0.043, regime: "risk-on" });
    assert.match(s, /Cut MP\./);
    assert.match(s, /~4\.3%/);
    assert.match(s, /risk-on/);
  });
  it("only manual triggers with a non-empty watch.queries are evaluated", () => {
    const triggers = [
      { id: "mp_policy", type: "manual", watch: { queries: ["China rare earth export control"] } },
      { id: "leu_policy", type: "manual" },                       // no watch → skipped
      { id: "drawdown", type: "auto", watch: { queries: ["x"] } }, // auto → skipped
      { id: "empty", type: "manual", watch: { queries: [] } },     // empty → skipped
    ];
    assert.deepEqual(watchableTriggers(triggers).map((t) => t.id), ["mp_policy"]);
  });
});
