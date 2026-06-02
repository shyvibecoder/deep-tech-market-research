import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalystConsensus, catalystFires, suggestedActionFallback, watchableTriggers, matchNews, catalystPrompt, parseCatalystVerdict, runCatalystWatch } from "../scripts/lib/catalyst.mjs";

describe("catalyst: consensus (≥2 seats + evidence-grounded corroboration + 2-run confirm)", () => {
  const metBoth = [{ met: true, confidence: 0.8, citations: ["sec:8-K", "reuters"] }, { met: true, confidence: 0.7, citations: ["reuters"] }];
  const ev = { filings: [{ title: "MP 8-K" }], headlines: [{ title: "h1", link: "u1" }, { title: "h2", link: "u2" }] };
  it("two met seats + real evidence → likely-met (first run), not yet fired", () => {
    const c = catalystConsensus(metBoth, null, { evidence: ev });
    assert.equal(c.status, "likely-met");
    assert.equal(c.met, true);
    assert.equal(c.confidence, 0.75);
  });
  it("a SECOND consecutive elevated run confirms → fired", () => {
    const c = catalystConsensus(metBoth, { status: "likely-met" }, { evidence: ev });
    assert.equal(c.status, "fired");
    assert.ok(catalystFires(c));
  });
  it("[C1] fabricated/extra CITATIONS can't manufacture corroboration — only REAL evidence counts", () => {
    // both seats claim many citations, but no filing and <2 distinct real news sources exist → not corroborated
    const c = catalystConsensus([{ met: true, confidence: 0.9, citations: ["a", "b", "c"] }, { met: true, confidence: 0.9, citations: ["d", "e"] }],
      { status: "likely-met" }, { evidence: { filings: [], headlines: [{ title: "only one", link: "u1" }] } });
    assert.equal(c.corroborated, false);
    assert.equal(c.met, false);
    assert.equal(c.status, "approaching");
  });
  it("[C2] a SINGLE seat cannot self-certify a fire, even with strong evidence", () => {
    const c = catalystConsensus([{ met: true, confidence: 0.95, citations: ["x"] }], { status: "likely-met" }, { evidence: ev });
    assert.equal(c.met_seats, 1);
    assert.equal(c.met, false);
    assert.notEqual(c.status, "fired");
  });
  it("low confidence → not met even with 2 seats + evidence", () => {
    const c = catalystConsensus([{ met: true, confidence: 0.45 }, { met: true, confidence: 0.5 }], { status: "likely-met" }, { evidence: ev });
    assert.equal(c.met, false);
    assert.notEqual(c.status, "fired");
  });
  it("minority met → not met", () => {
    const c = catalystConsensus([{ met: true, confidence: 0.9 }, { met: false, confidence: 0.1 }, { met: false, confidence: 0.1 }], null, { evidence: ev });
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

describe("catalyst: evidence + committee plumbing (pure)", () => {
  const news = [
    { title: "China extends rare earth export control suspension into 2027", link: "u1", date: "2026-06-01" },
    { title: "Neodymium praseodymium NdPr oxide price slides below $80/kg on oversupply", link: "u2", date: "2026-05-30" },
    { title: "Unrelated: data center power demand soars", link: "u3", date: "2026-06-02" },
  ];
  it("matchNews keeps headlines sharing ≥2 significant words with a query, newest-first", () => {
    const m = matchNews(news, ["China rare earth export control suspension extended", "neodymium praseodymium NdPr oxide price per kg"]);
    assert.ok(m.length >= 2);
    assert.ok(!m.some((h) => /Unrelated/.test(h.title)), "spurious headline excluded");
    assert.ok(m[0].date >= m[m.length - 1].date, "newest-first");
  });
  it("parseCatalystVerdict extracts strict JSON and clamps; junk → safe default", () => {
    const v = parseCatalystVerdict('noise {"met": true, "confidence": 1.4, "citations": ["sec:8-K","reuters"], "rationale":"x"} tail');
    assert.equal(v.met, true); assert.equal(v.confidence, 1); assert.equal(v.citations.length, 2);
    assert.deepEqual(parseCatalystVerdict("garbage").met, false);
  });
  it("catalystPrompt embeds the condition + a strict-JSON instruction", () => {
    const p = catalystPrompt({ name: "MP exit ...", action: "Cut MP", watch: { price_leg: "NdPr < $80/kg" } }, { headlines: [] });
    assert.match(p, /STRICT JSON/);
    assert.match(p, /MP exit/);
    assert.match(p, /single headline/);
  });

  it("runCatalystWatch: two corroborated seats → likely-met first run, fired on confirm; drafts an action", async () => {
    const triggers = [{ id: "mp_policy", type: "manual", name: "MP exit", action: "Cut MP.", watch: { queries: ["China rare earth export control suspension", "neodymium NdPr price"] } }];
    let drafted = 0;
    const seat = async (prompt) => /SPECIFIC, advisory/.test(prompt)
      ? (drafted++, "Trim MP ~1/3, realize in the IRA first; keep the taxable lot.")
      : '{"met":true,"confidence":0.8,"citations":["sec:8-K","reuters"],"rationale":"both legs confirmed"}';
    const searchFilings = async () => [{ title: "MP Materials 8-K", date: "2026-06-01" }];
    const first = await runCatalystWatch({ triggers, news, callers: [seat, seat], searchFilings, prevWatch: {}, actionContext: { mp_policy: { weightPct: 0.043 } }, today: "2026-06-02" });
    assert.equal(first.mp_policy.status, "likely-met");
    assert.ok(first.mp_policy.evidence.headlines.length >= 1 && first.mp_policy.evidence.filings.length >= 1);
    assert.match(first.mp_policy.suggested_action, /Trim MP/);
    assert.ok(drafted >= 1, "LLM action draft was called");

    const second = await runCatalystWatch({ triggers, news, callers: [seat, seat], searchFilings, prevWatch: first, today: "2026-06-03" });
    assert.equal(second.mp_policy.status, "fired");
    assert.ok(catalystFires(second.mp_policy));
  });

  it("runCatalystWatch: a single-source 'met' does NOT fire (corroboration gate); no LLM keys → no crash", async () => {
    const triggers = [{ id: "leu_policy", type: "manual", name: "LEU exit", action: "Cut LEU.", watch: { queries: ["Russia uranium enrichment sanctions"] } }];
    const oneSeat = async () => '{"met":true,"confidence":0.9,"citations":["onlyone"]}';
    const r = await runCatalystWatch({ triggers, news: [{ title: "Russia uranium enrichment sanctions eased by US", date: "2026-06-01" }], callers: [oneSeat, oneSeat], today: "2026-06-02" });
    assert.notEqual(r.leu_policy.status, "fired");
    const none = await runCatalystWatch({ triggers, news, callers: [], today: "2026-06-02" }); // no LLM available
    assert.equal(none.leu_policy.status, "monitoring");
  });
});
