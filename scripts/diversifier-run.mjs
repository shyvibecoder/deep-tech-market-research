#!/usr/bin/env node
// DIVERSIFIER scout + funding runner (Stages 1–3) — productionizes the retired axis-check screen.
// Pipeline: fetch deep daily history → SCREEN the candidate universe BOOK-AWARE (against the current plan)
// → score per-name CONVICTION via the committee (llm.mjs; falls back to equal conviction with no key) →
// SIZE a sleeve at DIVERSIFIER_SLEEVE_PCT (default 15%) by conviction × inverse-vol around what's already
// planned → write a funding proposal to web/data/diversifier-candidates.json for HUMAN PR approval.
// It NEVER writes portfolio.json or scarcities.json — the human merges the proposal (F9). The computed
// metrics it emits are the machine-generated diversifier evidence (no more hand-typed numbers → no drift).
import { readFileSync, writeFileSync } from "node:fs";
import { fetchSeries, fetchStooqHistory, fetchTiingoHistory } from "./lib/quotes.mjs";
import { reconcileSeries } from "./lib/history-reconcile.mjs";
import { basketStats } from "./lib/axis.mjs";
import { isDiversifierHolding } from "./lib/sizing.mjs"; // canonical diversifier predicate (audit C4 — single source)
import { DIVERSIFIER_UNIVERSE, screenDiversifiers, convictionCommittee, fundSleeve } from "./lib/diversifier.mjs";
import { availableProviders, planCommittee, seatCaller } from "./lib/llm.mjs";

const MARKET = ["SPY"];            // broad market factor (strip generic beta)
const COMPLEX = ["QQQ", "SMH"];    // long-lived deep-tech build-out complex proxy (orthogonalized from MARKET)
const SLEEVE_PCT = Number(process.env.DIVERSIFIER_SLEEVE_PCT || 0.15);
const MAX_NAMES = Number(process.env.DIVERSIFIER_MAX_NAMES || 6); // fund only the top-N by conviction (focused sleeve, not dust)
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deep daily history the SAME way the backfill / old axis-check built it: Yahoo + Stooq (keyless, deep) +
// Tiingo (if keyed), cross-provider reconciled (no synthetic data).
async function deepSeries(ticker) {
  const sources = {};
  try { sources.yahoo = await fetchSeries(ticker, "max"); } catch { /* skip */ }
  await sleep(200);
  try { sources.stooq = await fetchStooqHistory(ticker); } catch { /* skip */ }
  await sleep(200);
  if (process.env.TIINGO_API_KEY) { try { sources.tiingo = await fetchTiingoHistory(ticker); } catch { /* skip */ } await sleep(300); }
  const { rows } = reconcileSeries(ticker, sources);
  if (rows.length < 250) return null;
  return { dates: rows.map((r) => r.d), closes: rows.map((r) => r.close) };
}
async function loadSeries(tickers) {
  const out = {};
  for (const t of tickers) {
    try { const s = await deepSeries(t); if (s) out[t] = s; else console.error(`  (thin/none: ${t})`); }
    catch (e) { console.error(`  (fetch failed: ${t} — ${e.message.slice(0, 60)})`); }
  }
  return out;
}

(async () => {
  const portfolio = JSON.parse(readFileSync(new URL("../web/data/portfolio.json", import.meta.url)));
  const planTickers = (portfolio.holdings || []).map((h) => h.ticker);
  const existingDiversifierTickers = (portfolio.holdings || []).filter(isDiversifierHolding).map((h) => h.ticker);
  const sleeveUsd = portfolio.sleeve_usd || 0;

  console.log(`Fetching market ${MARKET.join(",")} | complex ${COMPLEX.join(",")} | ${DIVERSIFIER_UNIVERSE.length} candidate sleeves | ${planTickers.length} plan tickers`);
  const market = await loadSeries(MARKET);
  const complex = await loadSeries(COMPLEX);
  if (!Object.keys(market).length || Object.keys(complex).length < 2) { console.error("Not enough market/complex history — need network."); process.exit(1); }
  const universeTickers = [...new Set(DIVERSIFIER_UNIVERSE.flatMap((c) => c.tickers))];
  const cand = await loadSeries(universeTickers);
  const plan = await loadSeries(planTickers);
  const series = { ...market, ...complex, ...cand, ...plan };

  // Stage 1 — book-aware screen (ddReduction measured vs the actual plan).
  const ranked = screenDiversifiers(series, DIVERSIFIER_UNIVERSE, Object.keys(market), Object.keys(complex), { planTickers: Object.keys(plan), buildoutBetaMax: 0.3, betaMax: 0.95, maxDDCap: 0.5 });
  const qualifiers = ranked.filter((r) => r.qualifies);
  console.log(`Screen: ${qualifiers.length}/${ranked.length} sleeves qualify — ${qualifiers.map((q) => q.id).join(", ") || "none"}`);

  // Stage 2 — committee conviction for the names in qualifying sleeves (excluding already-held).
  const tickers = [...new Set(qualifiers.flatMap((c) => c.tickers))].filter((t) => !planTickers.includes(t));
  const evidence = {};
  for (const q of qualifiers) for (const t of q.tickers) evidence[t] = { sleeve: q.scarcity, maxDD: q.maxDD, mktBeta: q.marketBeta, buildoutBeta: q.buildoutBeta, sharpe: q.sharpe };
  const seats = (planCommittee(availableProviders(), {}).seats || []).map((s) => seatCaller(s.provider, s.model));
  const convictions = await convictionCommittee(tickers, evidence, seats, { fallback: 0.6 });
  console.log(`Conviction (${seats.length ? seats.length + " model(s)" : "offline → equal fallback"}): ${tickers.map((t) => `${t} ${convictions[t]}`).join(", ") || "—"}`);

  // Stage 3 — size the sleeve (conviction × inverse-vol, around what's planned).
  const vols = {}; for (const t of tickers) vols[t] = basketStats(series, [t])?.vol ?? 0.25;
  const funding = fundSleeve({ candidates: qualifiers, currentHoldings: portfolio.holdings || [], existingDiversifierTickers, sleevePct: SLEEVE_PCT, sleeveUsd, convictions, vols, maxNames: MAX_NAMES });
  console.log(`Funding: top ${funding.newHoldings.length} by conviction (cap ${MAX_NAMES}) into a ${(SLEEVE_PCT * 100).toFixed(0)}% sleeve (FIW etc. already ${(funding.existingDivWeight * 100).toFixed(1)}%); deep-tech build-out scaled ×${funding.buildoutScale}`);

  // Write the proposal (a SEPARATE feed; never the plan). Computed metrics = the machine-generated evidence.
  const out = {
    schema_version: 1, generated: today, sleeve_pct: SLEEVE_PCT, market: MARKET, complex: COMPLEX,
    note: "Proposed diversifier (2nd-axis) sleeve. Advisory — review and open a PR into portfolio.json to fund it; the bot never edits your plan or trades.",
    candidates: ranked, funding,
  };
  writeFileSync(new URL("../web/data/diversifier-candidates.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log(`diversifier: wrote web/data/diversifier-candidates.json (${ranked.length} screened, ${funding.newHoldings.length} proposed)`);
})();
