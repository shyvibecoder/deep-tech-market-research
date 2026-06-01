import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { draftScarcity, legibilityTag, scoutSeenUpdate } from "../scripts/lib/scout.mjs";

// Step 2 (SCOUT-DESIGN): turn a raw lead into a committee-ingestible DRAFT scarcity object. The
// committee then CORRECTS the draft fields — so the draft just needs the SHAPE runCommittee expects
// (id, scarcity, tickers, thesis, first-guess bind_window/priced_in/durability/substitution_risk),
// never asserting conviction it hasn't earned. Pure → testable without network/LLM.
describe("scout: draftScarcity (lead → committee-ingestible draft)", () => {
  const lead = { ticker: "AAA", company: "Alpha Inc", phraseCount: 3, phrases: ["lead times extended", "on allocation", "single source of supply"], mentions: 6 };

  it("produces the field shape the committee needs, flagged draft + scout-sourced", () => {
    const d = draftScarcity(lead, { proxies: ["AAA", "BBB"], subject: "specialty fasteners" });
    for (const k of ["id", "scarcity", "tickers", "thesis", "bind_window", "priced_in", "durability", "substitution_risk", "non_consensus"]) {
      assert.ok(k in d, `draft missing ${k}`);
    }
    assert.equal(d.draft, true);            // never confused with a curated scarcity
    assert.equal(d.source, "scout");
    assert.deepEqual(d.tickers, ["AAA", "BBB"]);
    assert.match(d.thesis, /specialty fasteners/);
  });

  it("seeds CONSERVATIVE first-guess fields (the committee owns the real call)", () => {
    const d = draftScarcity(lead, { proxies: ["AAA"], subject: "x" });
    // Unknown-until-debated → priced_in starts 'low' (so the committee must EARN a crowded read),
    // non_consensus defaults true (it's by definition not-yet-on-the-list), bind unknown → 2027.
    assert.equal(d.priced_in, "low");
    assert.equal(d.non_consensus, true);
    assert.ok(["now", "2027", "2028-29", "2030+"].includes(d.bind_window));
  });

  it("derives a stable, slug-safe id from the subject (committee/report key)", () => {
    assert.equal(draftScarcity(lead, { proxies: ["AAA"], subject: "ABF Substrate Resin!" }).id, "scout-abf-substrate-resin");
    // deterministic
    assert.equal(draftScarcity(lead, { proxies: ["AAA"], subject: "ABF Substrate Resin!" }).id, "scout-abf-substrate-resin");
  });

  it("carries the constraint evidence (complaining filers + phrases) for the reviewer", () => {
    const d = draftScarcity(lead, { proxies: ["AAA"], subject: "x" });
    assert.deepEqual(d.constraint_phrases, lead.phrases);
    assert.equal(d.complaining_filer, "AAA");
  });
});

describe("scout: legibilityTag (soft anti-consensus signal, D-gate)", () => {
  it("tags a candidate with heavy mainstream coverage as already-legible (downweight, not drop)", () => {
    const t = legibilityTag({ financialCoverage: 40, primaryCoverage: 2 });
    assert.equal(t.tag, "already-legible");
    assert.ok(t.penalty > 0);               // soft penalty, not a hard drop
  });
  it("tags a primarily-filing-sourced candidate as early/contrarian (no penalty)", () => {
    const t = legibilityTag({ financialCoverage: 0, primaryCoverage: 9 });
    assert.equal(t.tag, "early-contrarian");
    assert.equal(t.penalty, 0);
  });
});

describe("scout: scoutSeenUpdate (D2 memory — proposed + rejected, with re-entry)", () => {
  const prev = { seen: { "scout-foo": { status: "rejected", evidence_hash: "h1" } } };
  it("suppresses a previously-rejected candidate when evidence is unchanged", () => {
    const { suppressed } = scoutSeenUpdate(prev, [{ id: "scout-foo", evidence_hash: "h1" }]);
    assert.deepEqual(suppressed, ["scout-foo"]);
  });
  it("RE-ENTERS a rejected candidate when evidence materially changed (new hash)", () => {
    const { suppressed, fresh } = scoutSeenUpdate(prev, [{ id: "scout-foo", evidence_hash: "h2-new" }]);
    assert.deepEqual(suppressed, []);
    assert.deepEqual(fresh, ["scout-foo"]);
  });
  it("treats a brand-new candidate as fresh", () => {
    const { fresh } = scoutSeenUpdate(prev, [{ id: "scout-bar", evidence_hash: "x" }]);
    assert.ok(fresh.includes("scout-bar"));
  });
});

import { cleanName } from "../scripts/lib/scout.mjs";
// Security (audit S1): the scout subject derives from attacker-controllable filing text and becomes
// the scarcity DISPLAY NAME. cleanName neuters HTML at the data layer so scarcities.json can't carry
// markup even before the UI escapes it.
describe("scout: cleanName (data-layer XSS guard on the scarcity name)", () => {
  it("strips HTML-significant chars and tags", () => {
    assert.equal(cleanName("<img src=x onerror=alert(1)>"), "img src x onerror alert(1)");
    assert.equal(cleanName('a"><script>evil()</script>'), "a script evil() /script");
  });
  it("preserves legitimate chokepoint names", () => {
    assert.equal(cleanName("grain-oriented electrical steel"), "grain-oriented electrical steel");
    assert.equal(cleanName("ABF substrate (GOES)"), "ABF substrate (GOES)");
  });
  it("caps length and handles null", () => {
    assert.equal(cleanName(null), "");
    assert.ok(cleanName("x".repeat(500)).length <= 120);
  });
});
