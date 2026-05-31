import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseProposal, sanitizeEdit, proposeScarcityEdits, ensembleConsensus, dispersion } from "../scripts/lib/research.mjs";

describe("research: ensemble consensus across independent models", () => {
  it("returns the strict-majority priced_in and the agreement ratio", () => {
    const c = ensembleConsensus([{ priced_in: "crowded" }, { priced_in: "crowded" }, { priced_in: "high" }]);
    assert.equal(c.priced_in, "crowded"); assert.equal(c.agreement, +(2 / 3).toFixed(2)); assert.equal(c.n, 3);
  });
  it("returns no consensus on a split (no strict majority)", () => {
    assert.equal(ensembleConsensus([{ priced_in: "crowded" }, { priced_in: "high" }]).priced_in, null);
  });
  it("ignores invalid/missing values", () => {
    const c = ensembleConsensus([{ priced_in: "crowded" }, { priced_in: "ULTRA" }, null]);
    assert.equal(c.priced_in, "crowded"); assert.equal(c.n, 1);
  });
});

describe("research: ensemble GATE in proposeScarcityEdits (multi-model)", () => {
  const scarcities = [{ id: "copper", scarcity: "Copper", priced_in: "high", bind_window: "2030+", non_consensus: false, thesis: "..." }];
  const mk = (pi, conf) => async (p) => p.includes("Reconcile")
    ? `{"priced_in":"${pi}","confidence":${conf},"rationale":"r"}`
    : `{"priced_in":"${pi}","confidence":${conf},"rationale":"r"}`;
  it("surfaces a change when independent models agree, with confidence scaled by agreement", async () => {
    const analysts = [mk("crowded", 0.9), mk("crowded", 0.9), mk("high", 0.9)]; // 2/3 agree crowded
    const { proposals } = await proposeScarcityEdits({ scarcities, analysts, redteam: async () => "", minConfidence: 0.5 });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].priced_in, "crowded");
    assert.ok(proposals[0].confidence < 0.9 && proposals[0].confidence > 0.5); // ×(2/3) ≈ 0.6
    assert.equal(proposals[0].ensemble.agreement, +(2 / 3).toFixed(2));
  });
  it("drops the proposal entirely when models split (no robust majority)", async () => {
    const analysts = [mk("crowded", 0.9), mk("low", 0.9)]; // 1-1 split
    const { proposals } = await proposeScarcityEdits({ scarcities, analysts, redteam: async () => "", minConfidence: 0.5 });
    assert.equal(proposals.length, 0);
  });
});
import { deepDivePrompt, seatPrompt, cioPrompt, RESEARCH_PROMPT_VERSION } from "../scripts/lib/research-prompts.mjs";

describe("research: prompt is calibrated on the MATCHING call type (alpha edge), not just tilts", () => {
  const sc = { hit_rate: 0.7, total: { n: 40 }, by_signal: { underperform: { n: 6, hits: 2 }, outperform: { n: 4, hits: 1 } } };
  it("injects the de-rating/inflecting accuracy when by_signal exists (the call it's actually making)", () => {
    const p = deepDivePrompt({ id: "x", scarcity: "X" }, {}, sc);
    // 3/10 = 30% on the matching priced-in→de-rating call type → prompt must cite THAT, humbly
    assert.match(p, /de-rating\/inflecting|relative call|alpha/i);
    assert.match(p, /30%/);
  });
  it("falls back to the tilt hit-rate when no relative calls have resolved yet", () => {
    const p = deepDivePrompt({ id: "x", scarcity: "X" }, {}, { hit_rate: 0.55, total: { n: 12 } });
    assert.match(p, /55%/);
  });
  it("keeps a modest prior with no track record at all", () => {
    assert.match(deepDivePrompt({ id: "x", scarcity: "X" }, {}, null), /modest|0\.6/i);
  });
  it("prompt version advanced past 1 (prompts improve over time)", () => {
    assert.ok(RESEARCH_PROMPT_VERSION >= 3);
  });
  it("v3 commands grounding in excerpts/filing passages, reports counts, and forbids invention", () => {
    const ev = { evidence_count: { news_with_excerpt: 5, filing_passages: 3 } };
    const p = deepDivePrompt({ id: "x", scarcity: "X" }, ev, null);
    assert.match(p, /5 article excerpts/);
    assert.match(p, /3 filing passages/);
    assert.match(p, /do not invent facts/i);
    assert.match(p, /cite/i);
  });
});

describe("research: parse + F9 ownership enforcement", () => {
  it("parses JSON embedded in model text", () => {
    assert.equal(parseProposal('sure: {"priced_in":"high","confidence":0.8} done').priced_in, "high");
    assert.equal(parseProposal("no json"), null);
  });
  it("sanitizeEdit DROPS non-owned fields (thesis/tickers) and validates enums", () => {
    const e = sanitizeEdit({ priced_in: "low" }, { priced_in: "crowded", bind_window: "now", thesis: "HACKED", tickers: ["EVIL"], confidence: 2 });
    assert.equal(e.priced_in, "crowded"); assert.equal(e.bind_window, "now");
    assert.ok(!("thesis" in e) && !("tickers" in e));
    assert.equal(e.confidence, 1); // clamped
  });
  it("rejects invalid enum values", () => {
    const e = sanitizeEdit({}, { priced_in: "ULTRA", bind_window: "2099", confidence: 0.9 });
    assert.ok(!("priced_in" in e) && !("bind_window" in e));
  });
});

describe("research Phase 1: falsifiability — variant view + dated kill-criterion ride on the edit", () => {
  it("keeps a non-empty variant_view (trimmed/capped) and drops a blank one", () => {
    const e = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, variant_view: "  Street models a glut; backlog says otherwise.  " });
    assert.equal(e.variant_view, "Street models a glut; backlog says otherwise.");
    const e2 = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, variant_view: "   " });
    assert.ok(!("variant_view" in e2));
    const e3 = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, variant_view: "x".repeat(900) });
    assert.ok(e3.variant_view.length <= 600);
  });
  it("keeps a kill_criterion ONLY when it has both a condition and a sane by_date (YYYY or YYYY-MM[-DD])", () => {
    const ok = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, kill_criterion: { condition: "spot price falls 20%", by_date: "2027-06" } });
    assert.deepEqual(ok.kill_criterion, { condition: "spot price falls 20%", by_date: "2027-06" });
    const noDate = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, kill_criterion: { condition: "x" } });
    assert.ok(!("kill_criterion" in noDate));
    const badDate = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, kill_criterion: { condition: "x", by_date: "someday" } });
    assert.ok(!("kill_criterion" in badDate));
    const noCond = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, kill_criterion: { by_date: "2027" } });
    assert.ok(!("kill_criterion" in noCond));
  });
  it("keeps a steelmanned bear_case string (capped), drops non-strings", () => {
    const e = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, bear_case: "Supply responds by 2028; this de-rates first." });
    assert.match(e.bear_case, /Supply responds/);
    const e2 = sanitizeEdit({}, { priced_in: "high", confidence: 0.7, bear_case: { not: "a string" } });
    assert.ok(!("bear_case" in e2));
  });
  it("never lets these descriptive fields smuggle in a thesis/ticker change (still F9)", () => {
    const e = sanitizeEdit({ id: "x" }, { priced_in: "high", confidence: 0.7, variant_view: "v", thesis: "HACK", tickers: ["EVIL"] });
    assert.ok(!("thesis" in e) && !("tickers" in e));
  });
});

describe("research prompt hardening (v5): targets the real committee failure modes", () => {
  const optical = { id: "optical", scarcity: "Optical", priced_in: "crowded", bind_window: "2027", non_consensus: false, thesis: "ran 5x" };
  const evWithPrices = { quotes: { COHR: { ytd: 0.86, vs200: 0.3 }, LITE: { ytd: 1.21 } }, evidence_count: { news_with_excerpt: 4, filing_passages: 2 } };

  it("seat prompt SURFACES explicit price levels (YTD / vs-200DMA) so a model can't call an up-86% name cheap", () => {
    const p = seatPrompt("bull", optical, evWithPrices, null);
    assert.match(p, /PRICE CONTEXT|already up|YTD/i);
    assert.match(p, /86%|0\.86/); // the actual number must reach the model
  });
  it("seat prompt SEPARATES 'binds now' (timing) from 'cheap now' (valuation) so they aren't conflated", () => {
    const p = seatPrompt("bull", optical, evWithPrices, null);
    assert.match(p, /binds now.*(≠|is not|not the same).*cheap|timing.*valuation|do not conflate/i);
  });
  it("seat prompt warns that a name already up a lot is LESS likely under-priced (anti-momentum-trap)", () => {
    const p = seatPrompt("bull", optical, evWithPrices, null);
    assert.match(p, /up (a lot|sharply|big)|rallied|extended/i);
  });
  it("CIO prompt FORBIDS moving bind_window earlier without dated, concrete evidence", () => {
    const p = cioPrompt(optical, { bull: {}, bear: {}, skeptic: {} }, { level: "wide", agreement: 0.33 });
    assert.match(p, /bind_window.*earlier|do not.*accelerat|pull.*forward/i);
    assert.match(p, /dated|concrete evidence|specific/i);
  });
  it("CIO prompt REWARDS leaving fields unchanged when the evidence doesn't clearly justify a change (anchor to current)", () => {
    const p = cioPrompt(optical, { bull: {}, bear: {}, skeptic: {} }, { level: "wide", agreement: 0.33 });
    assert.match(p, /default.*(no change|unchanged)|when in doubt|leave.*unchanged|burden of proof/i);
  });
  it("prompt version advanced to >=5 (hardening is a real version bump)", () => {
    assert.ok(RESEARCH_PROMPT_VERSION >= 5);
  });
});

describe("research Phase 1: report renders variant view + kill-criterion on a proposal", () => {
  const scarcities = [{ id: "copper", scarcity: "Copper", priced_in: "high", bind_window: "2030+", non_consensus: false, thesis: "..." }];
  it("a proposed change shows its variant_view and dated kill-criterion in the report", async () => {
    const analyst = async () => JSON.stringify({
      priced_in: "crowded", confidence: 0.8, rationale: "de-rating",
      variant_view: "Street prices a glut; grades say deficit holds.",
      bear_case: "New mines land 2028.", kill_criterion: { condition: "LME stocks +30%", by_date: "2027-12" },
    });
    const { proposals, report } = await proposeScarcityEdits({ scarcities, analyst, redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 1);
    assert.match(report, /Variant:/);
    assert.match(report, /Street prices a glut/);
    assert.match(report, /Wrong if:/);
    assert.match(report, /LME stocks \+30%.*2027-12|2027-12/);
  });
});

describe("research Phase 1: dispersion (conviction proxy across seat reads)", () => {
  it("unanimous reads → tight, agreement 1", () => {
    const d = dispersion(["high", "high", "high"]);
    assert.equal(d.level, "tight"); assert.equal(d.agreement, 1);
  });
  it("strict majority → moderate", () => {
    const d = dispersion(["high", "high", "crowded"]);
    assert.equal(d.level, "moderate"); assert.equal(d.agreement, +(2 / 3).toFixed(2));
  });
  it("no majority → wide (low conviction)", () => {
    const d = dispersion(["low", "high", "crowded"]);
    assert.equal(d.level, "wide");
  });
  it("ignores invalid/missing reads and is safe on empty", () => {
    const d = dispersion(["high", null, "ULTRA", undefined]);
    assert.equal(d.level, "tight"); assert.equal(d.n, 1);
    assert.equal(dispersion([]).level, "wide");
    assert.equal(dispersion(null).n, 0);
  });
});

describe("research: orchestration with injected LLMs (no network)", () => {
  const scarcities = [{ id: "copper", scarcity: "Copper", priced_in: "high", bind_window: "2030+", non_consensus: false, thesis: "..." }];
  it("proposes a change only when confident, and never beyond bot-owned fields", async () => {
    const analyst = async (p) => p.includes("Reconcile")
      ? '{"priced_in":"crowded","confidence":0.75,"rationale":"de-rating","thesis":"X"}'
      : '{"priced_in":"crowded","confidence":0.8,"rationale":"strong relative weakness","thesis":"X"}';
    const redteam = async () => "- maybe already priced";
    const { proposals, report } = await proposeScarcityEdits({ scarcities, analyst, redteam, minConfidence: 0.6 });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].priced_in, "crowded");
    assert.ok(!("thesis" in proposals[0]));
    assert.match(report, /copper/);
  });
  it("drops low-confidence proposals", async () => {
    const analyst = async () => '{"priced_in":"crowded","confidence":0.3}';
    const { proposals } = await proposeScarcityEdits({ scarcities, analyst, redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 0);
  });
});

describe("research: audit trail — 'considered' records WHY each scarcity wasn't proposed", () => {
  const scarcities = [{ id: "copper", scarcity: "Copper", priced_in: "high", bind_window: "2030+", non_consensus: false, thesis: "..." }];

  it("records a below-threshold call with its confidence + reasoning, and reports it", async () => {
    const analyst = async () => '{"priced_in":"crowded","confidence":0.3,"rationale":"weakening but unsure"}';
    const { proposals, considered, report } = await proposeScarcityEdits({ scarcities, analyst, redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 0);
    assert.equal(considered.length, 1);
    assert.equal(considered[0].id, "copper");
    assert.equal(considered[0].reason, "below-confidence");
    assert.equal(considered[0].confidence, 0.3);
    assert.equal(considered[0].priced_in, "crowded");          // what it WOULD have said
    assert.match(report, /Considered but not proposed/i);
    assert.match(report, /copper/);
    assert.match(report, /below confidence bar/);
  });

  it("records a high-confidence NO-CHANGE call (the discipline case) as 'no-change'", async () => {
    const analyst = async () => '{"priced_in":"high","confidence":0.9,"rationale":"correctly priced, no change"}';
    const { proposals, considered } = await proposeScarcityEdits({ scarcities, analyst, redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 0);
    assert.equal(considered[0].reason, "no-change");
    assert.equal(considered[0].confidence, 0.9);
  });

  it("records an ensemble split (no priced_in majority) as 'no-majority'", async () => {
    const analysts = [async () => '{"priced_in":"crowded","confidence":0.8}', async () => '{"priced_in":"medium","confidence":0.8}'];
    const { proposals, considered } = await proposeScarcityEdits({ scarcities, analysts, redteam: async () => "", minConfidence: 0.5 });
    assert.equal(proposals.length, 0);
    assert.equal(considered[0].reason, "no-majority");
  });

  it("does NOT add a 'considered' entry for a scarcity that IS proposed (no double-count)", async () => {
    const analyst = async () => '{"priced_in":"crowded","confidence":0.8,"rationale":"de-rating"}';
    const { proposals, considered } = await proposeScarcityEdits({ scarcities, analyst, redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 1);
    assert.equal(considered.length, 0);
  });

  it("survives ONE dead provider: if model A returns nothing but B gives a confident call, still proposes (single-model fallback, not a zeroed run)", async () => {
    const dead = async () => "";                                  // e.g. a retired/blocked model → empty
    const live = async () => '{"priced_in":"crowded","confidence":0.8,"rationale":"de-rating"}';
    const { proposals, considered } = await proposeScarcityEdits({ scarcities, analysts: [dead, live], redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].priced_in, "crowded");
    assert.equal(considered.length, 0);
  });

  it("captures the underlying ERROR when a model call throws, so 'no-response' says WHY", async () => {
    const boom = async () => { throw new Error("gemini 404: model gemini-x is not found"); };
    const { proposals, considered } = await proposeScarcityEdits({ scarcities, analysts: [boom], redteam: async () => "", minConfidence: 0.6 });
    assert.equal(proposals.length, 0);
    assert.equal(considered[0].reason, "no-response");
    assert.match(considered[0].error || "", /gemini 404/);
  });

  it("report lists the discipline trail even when zero proposals (so '0 proposals' is auditable)", async () => {
    const analyst = async () => '{"priced_in":"high","confidence":0.88,"rationale":"already fairly priced"}';
    const { report } = await proposeScarcityEdits({ scarcities, analyst, redteam: async () => "", minConfidence: 0.6 });
    assert.match(report, /No changes proposed/i);
    assert.match(report, /Considered but not proposed/i);
    assert.match(report, /already fairly priced/);
  });
});
