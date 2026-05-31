import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { croReview, proposeScarcityEdits } from "../scripts/lib/research.mjs";
import { croPrompt } from "../scripts/lib/research-prompts.mjs";

const copper = { id: "copper", scarcity: "Copper", priced_in: "high", bind_window: "2030+", non_consensus: false, thesis: "deficit", tickers: ["FCX"] };
const edit = { priced_in: "crowded", confidence: 0.7, rationale: "de-rating", variant_view: "glut wrong", kill_criterion: { condition: "stocks +30%", by_date: "2027-12" } };

describe("croPrompt: the Chief-Risk-Officer review brief", () => {
  it("asks the reviewer to check the fuzzy things code can't: hallucinated tickers, illogical thesis, momentum-chasing", () => {
    const p = croPrompt(copper, edit, {});
    assert.match(p, /hallucinat|made[- ]up|not a real|misattribut/i);
    assert.match(p, /momentum|chasing|already up/i);
    assert.match(p, /VETO|reject|approve/i);
  });
  it("includes the proposal + the scarcity so the reviewer has context", () => {
    const p = croPrompt(copper, edit, {});
    assert.match(p, /crowded/);
    assert.match(p, /Copper/);
  });
});

describe("croReview: applies the reviewer verdict (injected model, no network)", () => {
  it("APPROVE → passes through unchanged", async () => {
    const cro = async () => '{"verdict":"approve","confidence_adj":0,"reason":"sound"}';
    const r = await croReview({ scarcity: copper, edit, evidence: {}, cro });
    assert.equal(r.veto, false);
    assert.equal(r.edit.confidence, 0.7);
  });
  it("VETO → flags veto with the reviewer's reason (caller drops the proposal)", async () => {
    const cro = async () => '{"verdict":"veto","reason":"ADNT is an auto-seating company, not a robotics-data play"}';
    const r = await croReview({ scarcity: copper, edit, evidence: {}, cro });
    assert.equal(r.veto, true);
    assert.match(r.reason, /ADNT|auto-seating/);
  });
  it("REVISE → docks confidence by the adjustment (kept, but less certain)", async () => {
    const cro = async () => '{"verdict":"revise","confidence_adj":-0.2,"reason":"momentum risk"}';
    const r = await croReview({ scarcity: copper, edit, evidence: {}, cro });
    assert.equal(r.veto, false);
    assert.ok(Math.abs(r.edit.confidence - 0.5) < 1e-9);
    assert.match(r.edit.cro_note || "", /momentum/);
  });
  it("a CRO failure is FAIL-OPEN (keeps the proposal; never silently drops on an API error)", async () => {
    const cro = async () => { throw new Error("anthropic 529 overloaded"); };
    const r = await croReview({ scarcity: copper, edit, evidence: {}, cro });
    assert.equal(r.veto, false);
    assert.equal(r.edit.confidence, 0.7);
    assert.match(r.error || "", /529/);
  });
  it("an unparseable verdict is treated as approve (fail-open, not a crash)", async () => {
    const cro = async () => "the proposal looks fine to me";
    const r = await croReview({ scarcity: copper, edit, evidence: {}, cro });
    assert.equal(r.veto, false);
  });
});

describe("proposeScarcityEdits: CRO veto removes a proposal end-to-end", () => {
  const manip = { id: "manipulation-data", scarcity: "Manipulation data", priced_in: "low", bind_window: "2027", non_consensus: true, thesis: "moat", tickers: ["(private)"] };
  const seatFn = (byRole) => async (prompt) => {
    const role = /CIO chairing/.test(prompt) ? "cio" : /the BULL/.test(prompt) ? "bull" : /the BEAR/.test(prompt) ? "bear" : "skeptic";
    return byRole[role] ?? "";
  };
  it("a committee proposal vetoed by the CRO lands in 'considered' as cro-vetoed, not in proposals", async () => {
    // CIO proposes a clean priced_in change (no bind acceleration) at solid confidence so it clears
    // the deterministic gate and actually reaches the CRO — which then vetoes on the hallucination.
    const seats = [
      seatFn({ bull: '{"priced_read":"medium","confidence":0.75}', cio: '{"priced_in":"medium","confidence":0.75,"rationale":"ADNT moat","variant_view":"Consensus undervalues ADNT"}' }),
      seatFn({ bear: '{"priced_read":"medium","confidence":0.7}' }),
      seatFn({ skeptic: '{"priced_read":"medium","confidence":0.7}' }),
    ];
    const cro = async () => '{"verdict":"veto","reason":"ADNT is Adient (auto seating), not a manipulation-data company — hallucinated fit"}';
    const ev = { "manipulation-data": { evidence_count: { news_with_excerpt: 3, filing_passages: 2 } } };
    const { proposals, considered } = await proposeScarcityEdits({ scarcities: [manip], evidence: ev, seats, cro, minConfidence: 0.5 });
    assert.equal(proposals.length, 0);
    assert.equal(considered[0].reason, "cro-vetoed");
    assert.match(considered[0].rationale, /Adient|hallucinat/i);
  });
  it("without a CRO provided, behaviour is unchanged (optional layer)", async () => {
    const seats = [
      seatFn({ bull: '{"priced_read":"medium","confidence":0.6}', cio: '{"priced_in":"medium","confidence":0.6,"rationale":"r","variant_view":"v"}' }),
      seatFn({ bear: '{"priced_read":"medium","confidence":0.6}' }),
      seatFn({ skeptic: '{"priced_read":"medium","confidence":0.6}' }),
    ];
    const ev = { "manipulation-data": { evidence_count: { news_with_excerpt: 3, filing_passages: 2 } } };
    const { proposals } = await proposeScarcityEdits({ scarcities: [manip], evidence: ev, seats, minConfidence: 0.5 });
    assert.equal(proposals.length, 1);
  });
});
