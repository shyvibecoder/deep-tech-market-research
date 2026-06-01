import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArxiv, searchArxiv, arxivLeads } from "../scripts/lib/scout.mjs";

// Engine 3 (SCOUT-DESIGN, earliest + noisiest): elevated TECHNICAL activity can foreshadow a forming
// physical bottleneck before it hits filings. Keyless arXiv. parseArxiv is pure (Atom XML → entries);
// searchArxiv/arxivLeads inject fetch/discover so they're testable offline.
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Cryogenic CMOS for quantum control</title><summary>We present a cryo-CMOS
   approach.</summary><published>2026-05-20T00:00:00Z</published></entry>
  <entry><title>Scaling dilution refrigerators</title><summary>Cooling power limits.</summary><published>2026-05-18T00:00:00Z</published></entry>
</feed>`;

describe("scout engine 3: parseArxiv", () => {
  it("extracts entries (title/summary/published) from an Atom feed, whitespace-collapsed", () => {
    const e = parseArxiv(ATOM);
    assert.equal(e.length, 2);
    assert.equal(e[0].title, "Cryogenic CMOS for quantum control");
    assert.match(e[0].summary, /cryo-CMOS approach/);
    assert.equal(e[0].published, "2026-05-20T00:00:00Z");
  });
  it("returns [] on empty/garbage without throwing", () => {
    assert.deepEqual(parseArxiv(""), []);
    assert.deepEqual(parseArxiv("<feed></feed>"), []);
  });
});

describe("scout engine 3: searchArxiv (injected fetch)", () => {
  it("returns parsed entries from the API", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => ATOM });
    const e = await searchArxiv("cryogenic cmos", { fetchImpl });
    assert.equal(e.length, 2);
  });
  it("retries a transient 5xx then succeeds (F5 parity with searchFts)", async () => {
    let n = 0;
    const fetchImpl = async () => (++n < 2 ? { ok: false, status: 503 } : { ok: true, text: async () => ATOM });
    const e = await searchArxiv("x", { fetchImpl, sleepImpl: async () => {} });
    assert.equal(n, 2);
    assert.equal(e.length, 2);
  });
  it("throws after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => searchArxiv("x", { fetchImpl, sleepImpl: async () => {}, tries: 2 }), /arxiv 503/);
  });
});

describe("scout engine 3: arxivLeads", () => {
  const search = async (q) => q === "cryogenic cmos"
    ? [{ title: "a" }, { title: "b" }, { title: "c" }]   // 3 recent papers → active
    : [{ title: "a" }];                                   // 1 → below minPapers
  const discover = async (subj) => subj === "cryogenic cmos" ? ["CRYO"] : [];

  it("emits a lead only for queries with enough recent activity AND a discoverable proxy", async () => {
    const { leads } = await arxivLeads({ queries: ["cryogenic cmos", "quiet topic"], search, discover, minPapers: 2 });
    assert.equal(leads.length, 1);
    assert.equal(leads[0].engine, "arxiv");
    assert.equal(leads[0].subject, "cryogenic cmos");
    assert.deepEqual(leads[0].tickers, ["CRYO"]);
    assert.equal(leads[0].lead.papers, 3);
  });

  it("drops an active topic with NO public proxy (can't be evaluated)", async () => {
    const { leads } = await arxivLeads({ queries: ["cryogenic cmos"], search, discover: async () => [], minPapers: 2 });
    assert.equal(leads.length, 0);
  });

  it("is resilient: a failing search is recorded, not fatal", async () => {
    const flaky = async (q) => { if (q === "boom") throw new Error("arxiv 500"); return search(q); };
    const { leads, errors } = await arxivLeads({ queries: ["boom", "cryogenic cmos"], search: flaky, discover, minPapers: 2 });
    assert.ok(errors.some((e) => /500/.test(e)));
    assert.equal(leads.length, 1);
  });
});
