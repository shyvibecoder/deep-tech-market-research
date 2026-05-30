#!/usr/bin/env node
// Scarcity radar scanner. Runs in GitHub Actions (free) on a schedule.
// - Pulls free quotes (no key) for all portfolio + watchlist tickers
// - Computes crowding proxy (% off 52w high, YTD) and auto-trigger status
// - Optionally runs a free-LLM analyst+red-team digest (if GEMINI/GROQ key set)
// - Writes web/data/signals.json (committed by the workflow)
// Usage: node scripts/scan.mjs [--offline]

import { readFileSync, writeFileSync } from "node:fs";
import { getQuotes, isTradeable } from "./lib/quotes.mjs";
import { analystRedteamDigest, llmAvailable } from "./lib/llm.mjs";
import { validateInputs, validateSignals, validatePositions, assertValid, SCHEMA_VERSION } from "./lib/schema.mjs";
import { watchFilings } from "./lib/edgar.mjs";
import { watchNews } from "./lib/news.mjs";
import { getForwardPEs } from "./lib/fundamentals.mjs";
import { computeRegime } from "./lib/regime.mjs";
import { updateScarcityHistory, applySeenState } from "./lib/history.mjs";

const OFFLINE = process.argv.includes("--offline");
const read = (p) => JSON.parse(readFileSync(new URL(`../web/data/${p}`, import.meta.url)));

const dataUrl = (p) => new URL(`../web/data/${p}`, import.meta.url);
const portfolio = read("portfolio.json");
const scarcities = read("scarcities.json");
const triggers = read("triggers.json");
const securities = (() => { try { return read("securities.json").securities || {}; } catch { return {}; } })();
const TODAY = new Date().toISOString().slice(0, 10);

// Fail loudly on malformed input data before doing any work.
assertValid("input data", validateInputs({ portfolio, scarcities, triggers }));

// Build ticker universe from holdings + scarcity tickers (skip placeholders).
const fromHoldings = portfolio.holdings.map((h) => h.ticker);
const fromScarcities = scarcities.scarcities.flatMap((s) => s.tickers);
const universe = [...new Set([...fromHoldings, ...fromScarcities])].filter(isTradeable);

console.log(`Scanning ${universe.length} tickers (offline=${OFFLINE})...`);

let quotes = {};
const errors = [];
if (!OFFLINE) {
  try { quotes = await getQuotes(universe); }
  catch (e) { errors.push(`getQuotes: ${e.message}`); }
} else {
  errors.push("offline mode: no live quotes fetched");
}

// Crowding score 0-100 from YTD + distance from 52w high (higher = more crowded/priced-in).
function crowding(q) {
  if (!q || q.error || q.ytd == null) return null;
  const ytdScore = Math.max(0, Math.min(60, (q.ytd ?? 0) * 100)); // +60% ytd -> ~60
  const nearHigh = q.pct_off_high == null ? 0 : Math.max(0, 40 * (1 + q.pct_off_high / 0.25)); // at high -> 40
  return Math.round(Math.max(0, Math.min(100, ytdScore + nearHigh)));
}

const enriched = {};
let drops = [];
for (const t of universe) {
  const q = quotes[t];
  if (q && !q.error) {
    enriched[t] = { ...q, crowding: crowding(q) };
    if (q.pct_off_high != null) drops.push(q.pct_off_high);
  } else {
    enriched[t] = q || { ticker: t, error: "no quote" };
    if (q?.error) errors.push(`${t}: ${q.error}`);
  }
}

// --- SEC EDGAR filings watch (free, keyless): recent 8-K/10-Q/etc per holding ---
let filings = [];
if (!OFFLINE) {
  const watchTickers = portfolio.holdings.map((h) => h.ticker).filter(isTradeable);
  const r = await watchFilings(watchTickers, { sinceDays: 21 });
  filings = r.filings;
  errors.push(...r.errors);
  if (r.skipped.length) console.log(`EDGAR: skipped ${r.skipped.length} non-EDGAR tickers (${r.skipped.join(", ")})`);
  console.log(`EDGAR: ${filings.length} recent filings across ${watchTickers.length - r.skipped.length} companies`);
}

// --- News RSS per scarcity (free, keyless), deduped, fed into the digest ---
let news = [];
if (!OFFLINE) {
  const r = await watchNews(scarcities.scarcities, { perScarcity: 2, maxTotal: 24 });
  news = r.news;
  errors.push(...r.errors);
  console.log(`News: ${news.length} deduped headlines`);
}

// --- Forward P/E (best-effort, free) for holdings: "went up a lot" != "expensive" ---
if (!OFFLINE) {
  // F3: forward P/E is meaningless for ETFs — only fetch for single stocks/ADRs.
  const holdTickers = portfolio.holdings.map((h) => h.ticker)
    .filter((t) => isTradeable(t) && securities[t]?.type !== "etf");
  try {
    const fpes = await getForwardPEs(holdTickers);
    let got = 0;
    for (const [t, fpe] of Object.entries(fpes)) {
      if (fpe != null && enriched[t] && !enriched[t].error) { enriched[t].forward_pe = +fpe.toFixed(1); got++; }
    }
    console.log(`Forward P/E: ${got}/${holdTickers.length} resolved`);
  } catch (e) { errors.push(`fwdpe: ${e.message}`); }
}

// --- Optional local positions (gitignored): real cost basis + shares ---
let positions = null;
try {
  positions = read("positions.local.json");
  assertValid("positions.local.json", validatePositions(positions));
} catch (e) {
  if (!/ENOENT|no such file/i.test(e.message)) errors.push(`positions.local.json: ${e.message}`);
}

// --- Auto triggers ---
const avgDrawdown = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null;
const dd = triggers.triggers.find((x) => x.id === "drawdown");
const drawdownFired = avgDrawdown != null && Math.abs(avgDrawdown) >= (dd?.threshold ?? 0.2);

// Sleeve-cap + cost-basis trim rule (need positions.local.json for live values).
const sleeveCapUsd = triggers.triggers.find((x) => x.id === "sleeve_cap")?.threshold ?? 1720000;
let sleeveValue = null, sleeveFired = false;
let sleeveNote = "add web/data/positions.local.json (gitignored) for the live sleeve value";
let trimHits = [], trimNote = "add positions.local.json with cost basis to evaluate";

if (positions?.positions) {
  let sum = 0, priced = 0; const missing = [], nonUsd = [];
  for (const [t, p] of Object.entries(positions.positions)) {
    const q = enriched[t];
    const price = q?.price;
    if (price && p.shares) {
      // F2: don't sum non-USD-denominated quotes into a USD cap (no FX yet).
      if (q.currency && q.currency !== "USD") { nonUsd.push(`${t}(${q.currency})`); continue; }
      sum += price * p.shares; priced++;
    } else if (p.shares) missing.push(t);
  }
  if (typeof positions.cash_usd === "number") sum += positions.cash_usd;
  if (priced) {
    sleeveValue = Math.round(sum);
    sleeveFired = sleeveValue >= sleeveCapUsd;
    sleeveNote = `sleeve ≈ $${(sleeveValue / 1e6).toFixed(2)}mm vs $${(sleeveCapUsd / 1e6).toFixed(2)}mm cap` +
      (missing.length ? ` (no price for ${missing.join(", ")})` : "") +
      (nonUsd.length ? ` (excluded non-USD: ${nonUsd.join(", ")} — FX conversion not yet implemented)` : "");
  }
  for (const h of portfolio.holdings) {
    const p = positions.positions[h.ticker];
    const price = enriched[h.ticker]?.price;
    if (!p || !p.cost_basis || !price) continue;
    const gain = price / p.cost_basis;
    const fpe = p.forward_pe ?? enriched[h.ticker]?.forward_pe ?? null;
    if (gain >= 2 && fpe != null && fpe > 50) {
      trimHits.push({ ticker: h.ticker, gain: +gain.toFixed(2), forward_pe: +Number(fpe).toFixed(1), action: "trim ~1/3 (tax-free in IRA)" });
    }
  }
  trimNote = trimHits.length ? `${trimHits.length} name(s) > 2x cost AND > 50x forward` : "no name > 2x cost AND > 50x forward";
}

const trigger_status = {
  drawdown: {
    fired: drawdownFired,
    value: avgDrawdown == null ? null : +(avgDrawdown * 100).toFixed(1),
    note: avgDrawdown == null ? "no data" : `avg ${(avgDrawdown * 100).toFixed(1)}% from 52w highs`,
  },
  sleeve_cap: { fired: sleeveFired, value: sleeveValue, note: sleeveNote },
  trim_rule: { fired: trimHits.length > 0, hits: trimHits, note: trimNote },
};

// --- Timing layer: trend/breadth/drawdown -> risk posture (when to deploy vs. brake) ---
const regime = computeRegime(enriched, portfolio.holdings);
console.log(`Regime: ${regime.posture}${regime.risk_score != null ? ` (risk ${regime.risk_score}/100)` : ""}`);

// --- F4: append scarcity history + surface drift; F7: mark new filings/news ---
const { drift: scarcity_drift } = updateScarcityHistory(dataUrl("scarcity-history.json"), scarcities.scarcities, TODAY);
const { newFilings, newNews } = applySeenState(dataUrl("seen.state.json"), { filings, news, triggerStatus: trigger_status, today: TODAY });
console.log(`History: ${Object.keys(scarcity_drift).length} scarcities drifted; ${newFilings} new filings, ${newNews} new headlines`);

// --- Optional free-LLM analyst + red-team digest ---
let digest = "(no LLM key set — set GEMINI_API_KEY or GROQ_API_KEY in repo secrets to enable the agent digest)";
if (llmAvailable() && !OFFLINE) {
  try {
    const slim = scarcities.scarcities.map((s) => ({ id: s.id, scarcity: s.scarcity, bind: s.bind_window, priced: s.priced_in, tickers: s.tickers }));
    const slimQ = Object.fromEntries(Object.entries(enriched).map(([k, v]) => [k, v?.error ? null : { ytd: v.ytd, off_high: v.pct_off_high, crowding: v.crowding, fwd_pe: v.forward_pe ?? null }]));
    const slimF = filings.map((f) => ({ ticker: f.ticker, form: f.form, date: f.date, items: f.items }));
    const slimN = news.map((n) => ({ scarcity: n.scarcity, title: n.title, date: n.date }));
    digest = await analystRedteamDigest({ signals: slimQ, filings: slimF, headlines: slimN, scarcities: slim });
  } catch (e) { errors.push(`llm: ${e.message}`); }
}

const out = {
  schema_version: SCHEMA_VERSION,
  scanned_at: new Date().toISOString(),
  source: OFFLINE ? "offline run" : "scripts/scan.mjs",
  universe_count: universe.length,
  quotes: enriched,
  filings,
  news,
  trigger_status,
  regime,
  scarcity_drift,
  digest,
  errors,
};

// Validate our own output before writing — never commit a malformed signals.json.
assertValid("generated signals.json", validateSignals(out));

writeFileSync(new URL("../web/data/signals.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote signals.json — ${Object.values(enriched).filter((q) => q && !q.error).length}/${universe.length} quotes OK, ${errors.length} errors, drawdown fired=${drawdownFired}`);
