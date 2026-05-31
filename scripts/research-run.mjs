#!/usr/bin/env node
// The v3 research engine entry: runs the versioned research prompts on the free LLMs
// (deep-dive → red-team → synthesis), gated + sanitized to bot-owned fields, and writes
// a dated proposal report. The workflow opens a PR for HUMAN approval (F9). Best-effort:
// no-op (writes a stub) when no LLM key is set or evidence is missing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { llm, availableProviders } from "./lib/llm.mjs";
import { proposeScarcityEdits } from "./lib/research.mjs";
import { newsForQuery } from "./lib/news.mjs";
import { thesisQueries, extractExcerpt, dedupeByDomain, buildEvidenceBundle } from "./lib/research-sources.mjs";
import { searchFilings, fetchFilingPassages } from "./lib/edgar.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Thesis keywords for filing full-text search + passage extraction (multi-word phrases first).
const thesisKeywords = (s) => {
  const subj = (s.news_query || s.scarcity || "").toLowerCase();
  const words = subj.split(/\s+/).filter((w) => w.length > 3);
  return [...new Set([subj.split(/\s+/).slice(0, 2).join(" "), ...words])].filter(Boolean).slice(0, 6);
};

const read = (p) => { try { return JSON.parse(readFileSync(new URL(`../web/data/${p}`, import.meta.url))); } catch { return null; } };
const date = new Date().toISOString().slice(0, 10);
const dir = new URL("../research/auto/", import.meta.url);
mkdirSync(dir, { recursive: true });
const write = (name, txt) => writeFileSync(new URL(name, dir), txt);

const scar = read("scarcities.json"); const sig = read("signals.json") || {};
const providers = availableProviders();
if (!scar || !providers.length) {
  write(`${date}.md`, `# Auto-research ${date}\n\nSkipped: ${!providers.length ? "no LLM key set" : "no scarcities"}.\n`);
  console.log("research: skipped (no key or data)"); process.exit(0);
}

// DEEP multi-source evidence per scarcity: multi-angle news WITH article excerpts (domain-
// deduped for source diversity), SEC filing PASSAGES read from full-text search, the live
// signals (de-rating / forced-flow / opportunity) the LLM previously couldn't see, and the
// quote snapshot — all real, cited, never fabricated. Best-effort: each fetch degrades to the
// committed signals.json data on failure, so the loop still runs offline / rate-limited.
const OFFLINE = process.argv.includes("--offline") || process.env.RESEARCH_OFFLINE === "1";
const evidence = {};
for (const s of scar.scarcities) {
  // 1) Multi-angle news + excerpts (fall back to the scan's committed headlines on failure).
  let news = [];
  if (!OFFLINE) {
    for (const q of thesisQueries(s).slice(0, 4)) {
      try {
        const items = await newsForQuery(q, { limit: 4 });
        for (const it of items) {
          let excerpt = null;
          try { const r = await fetch(it.link, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) }); if (r.ok) excerpt = extractExcerpt(await r.text(), { maxChars: 500 }); } catch { /* headline only */ }
          news.push({ ...it, excerpt });
          await sleep(120);
        }
      } catch { /* skip angle */ }
      await sleep(150);
    }
    news = dedupeByDomain(news, { perDomain: 2 }).slice(0, 10);
  }
  if (!news.length) news = (sig.news || []).filter((n) => n.scarcity === s.id).map((n) => ({ title: n.title, date: n.date, link: n.link }));

  // 2) SEC filing passages from thesis full-text search. Search SHORT high-signal phrases (the
  // 1–2 word key terms that actually appear in filings) — NOT the whole long news_query as one
  // exact phrase (no 10-K contains "merchant power IPP electricity demand data center"). Try the
  // top terms until one returns hits.
  const filings = [];
  if (!OFFLINE) {
    const kws = thesisKeywords(s);
    const searchTerms = [...new Set([kws[0], kws.slice(1, 3).join(" "), ...kws.slice(1, 4)].filter((t) => t && t.length >= 3))];
    let hits = [];
    for (const term of searchTerms) {
      try { hits = await searchFilings(term, { limit: 4 }); } catch { hits = []; }
      await sleep(200);
      if (hits.length) break; // first term that finds filings wins
    }
    for (const f of hits) {
      try { const passages = await fetchFilingPassages(f, kws, { window: 240, max: 2 }); if (passages.length) filings.push({ ticker: f.ticker, form: f.form, date: f.date, url: f.url, passages }); }
      catch { /* skip filing */ }
      await sleep(200);
    }
  }

  // 3) Signals the LLM previously couldn't see + quotes.
  const ss = sig.scarcity_signals?.[s.id] || {};
  evidence[s.id] = buildEvidenceBundle({
    scarcity: s,
    signals: { de_rating: ss.flag || null, rs: ss.rs ?? null, opportunity: ss.score ?? null, forced_flow: ss.forced_flow?.flag || null },
    news, filings,
    quotes: Object.fromEntries(s.tickers.filter((t) => sig.quotes?.[t] && !sig.quotes[t].error)
      .map((t) => [t, { ytd: sig.quotes[t].ytd, vs200: sig.quotes[t].pct_vs_ma200, mom_1m: sig.quotes[t].mom_1m }])),
  });
}
const totalPassages = Object.values(evidence).reduce((a, e) => a + (e.evidence_count?.filing_passages || 0), 0);
const totalExcerpts = Object.values(evidence).reduce((a, e) => a + (e.evidence_count?.news_with_excerpt || 0), 0);
console.log(`research evidence: ${totalExcerpts} news excerpts, ${totalPassages} filing passages across ${scar.scarcities.length} scarcities`);

// Committee mode (Phase 2): each available provider staffs a seat (bull/bear/skeptic → CIO), so
// with 2-3 free keys the seats run on DIFFERENT model families (genuine cognitive diversity); with
// one key the role structure is preserved on a single model. This replaces the deep-dive→red-team
// path in production. The provider pool is preference-ordered (Groq → OpenRouter → Gemini).
const seats = providers.map((pr) => (p) => llm(p, pr));
// Chief-Risk-Officer review (trust lever #3): an independent final pass on the STRONGEST available
// model (providers[0] — frontier-first when a paid key is set) that does the fuzzy checks code
// can't — hallucinated tickers, illogical thesis, momentum-chasing. Only runs on calls that would
// be proposed. Skipped with a single provider (it'd just grade itself).
const cro = providers.length >= 2 ? (p) => llm(p, providers[0]) : null;
// Resilient: a transient LLM/network error must NOT fail the workflow — write a stub + exit 0
// so the run is green and the evidence summary is still visible.
try {
  // concurrency=4: process 4 scarcities at once (seats within each also run in parallel). With the
  // retry/backoff in llm.mjs this stays under the free-tier RPMs while cutting the ~50-min serial
  // run to roughly a third. Lower it if a provider's free limit is tighter.
  const { proposals, report } = await proposeScarcityEdits({ scarcities: scar.scarcities, evidence, seats, cro, scorecard: sig.scorecard, minConfidence: 0.5, concurrency: 4 });
  write(`${date}.md`, report);
  write(`${date}.proposals.json`, JSON.stringify(proposals, null, 2) + "\n");
  // Also publish the latest proposals to the dashboard-readable data tier so the front-end
  // Accept/Reject review can show them (the UI opens a PR via the user's token; F9-guarded).
  writeFileSync(new URL("../web/data/research-proposals.json", import.meta.url),
    JSON.stringify({ schema_version: 1, generated: date, prompt_version: proposals[0]?.prompt_version ?? null, proposals }, null, 2) + "\n");
  console.log(`research: ${proposals.length} proposal(s) written to research/auto/${date}.* + web/data/research-proposals.json`);
} catch (e) {
  write(`${date}.md`, `# Auto-research ${date}\n\nEvidence gathered (${totalExcerpts} news excerpts, ${totalPassages} filing passages) but the LLM step errored: ${e.message}\n`);
  console.log(`research: LLM step errored (non-fatal): ${e.message}`);
}
