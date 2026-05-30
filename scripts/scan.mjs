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
import { validateInputs, validateSignals, assertValid } from "./lib/schema.mjs";

const OFFLINE = process.argv.includes("--offline");
const read = (p) => JSON.parse(readFileSync(new URL(`../web/data/${p}`, import.meta.url)));

const portfolio = read("portfolio.json");
const scarcities = read("scarcities.json");
const triggers = read("triggers.json");

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

// --- Auto triggers ---
const avgDrawdown = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null;
const dd = triggers.triggers.find((x) => x.id === "drawdown");
const drawdownFired = avgDrawdown != null && Math.abs(avgDrawdown) >= (dd?.threshold ?? 0.2);

const trigger_status = {
  drawdown: {
    fired: drawdownFired,
    value: avgDrawdown == null ? null : +(avgDrawdown * 100).toFixed(1),
    note: avgDrawdown == null ? "no data" : `avg ${(avgDrawdown * 100).toFixed(1)}% from 52w highs`,
  },
  sleeve_cap: { fired: false, value: null, note: "needs live position values (manual for now)" },
  trim_rule: { fired: false, hits: [] }, // needs cost basis -> manual/portfolio-tracker phase
};

// --- Optional free-LLM analyst + red-team digest ---
let digest = "(no LLM key set — set GEMINI_API_KEY or GROQ_API_KEY in repo secrets to enable the agent digest)";
if (llmAvailable() && !OFFLINE) {
  try {
    const slim = scarcities.scarcities.map((s) => ({ id: s.id, scarcity: s.scarcity, bind: s.bind_window, priced: s.priced_in, tickers: s.tickers }));
    const slimQ = Object.fromEntries(Object.entries(enriched).map(([k, v]) => [k, v?.error ? null : { ytd: v.ytd, off_high: v.pct_off_high, crowding: v.crowding }]));
    digest = await analystRedteamDigest({ signals: slimQ, headlines: [], scarcities: slim });
  } catch (e) { errors.push(`llm: ${e.message}`); }
}

const out = {
  scanned_at: new Date().toISOString(),
  source: OFFLINE ? "offline run" : "scripts/scan.mjs",
  universe_count: universe.length,
  quotes: enriched,
  trigger_status,
  digest,
  errors,
};

// Validate our own output before writing — never commit a malformed signals.json.
assertValid("generated signals.json", validateSignals(out));

writeFileSync(new URL("../web/data/signals.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote signals.json — ${Object.values(enriched).filter((q) => q && !q.error).length}/${universe.length} quotes OK, ${errors.length} errors, drawdown fired=${drawdownFired}`);
