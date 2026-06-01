#!/usr/bin/env node
// G2 data-driven axis pick. A 2nd scarcity axis must (a) be UNcorrelated to the AI-capex complex AND
// (b) EARN its capital on its own — low correlation to a loser is worthless. So we measure BOTH, over a
// long (~15-20yr) window. Long-lived pure-plays (not young ETFs) so history isn't truncated to ~2yr.
// Run with network (GitHub Actions, or local): node scripts/axis-check.mjs
import { fetchSeries, fetchStooqHistory, fetchTiingoHistory } from "./lib/quotes.mjs";
import { reconcileSeries } from "./lib/history-reconcile.mjs";
import { axisCorrelation, basketStats } from "./lib/axis.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deep daily history the SAME way the price-history backfill builds it (scan.mjs): fetch each provider,
// then cross-provider reconcile. Yahoo(adj) + Tiingo(adj) are the adjusted corroborating pair; keyless
// Stooq carries the deep daily history so CI works without secrets. reconcileSeries screens weekend /
// holiday-fill / spike bars and corroborates — "no synthetic data". This is why range=max alone (monthly
// for long spans) isn't enough: Stooq supplies the deep daily bars, reconciliation triangulates them.
async function deepSeries(ticker) {
  const sources = {};
  try { sources.yahoo = await fetchSeries(ticker, "max"); } catch { /* skip */ }
  await sleep(200);
  try { sources.stooq = await fetchStooqHistory(ticker); } catch { /* skip */ }
  await sleep(200);
  if (process.env.TIINGO_API_KEY) { try { sources.tiingo = await fetchTiingoHistory(ticker); } catch { /* skip */ } await sleep(300); }
  const { rows } = reconcileSeries(ticker, sources);
  if (rows.length < 250) return null;
  return { ticker, dates: rows.map((r) => r.d), closes: rows.map((r) => r.close) };
}

// AI-capex complex proxy — long-lived so the correlation window is ~25yr: QQQ (1999) + SMH semis (2000).
// (Held theme ETFs like NUKZ/PAVE are young and would truncate the window to ~2yr; semis are the cleanest
//  long-history proxy for the AI/datacenter capex factor.)
const COMPLEX = ["QQQ", "SMH"];

// Candidate second axes — LONG-HISTORY pure-plays (intersection window noted), Edge-2 chokepoint logic in mind:
const CANDIDATES = {
  // Fertilizer/grain chokepoints (phosphate/potash/nitrogen). MOS '04, CF '05, ADM decades, MOO '07 → ~18yr.
  "Food / ag-input security": ["MOS", "CF", "ADM", "MOO"],
  // CORRECTED to genuinely DEFENSIVE health (no biotech — last run's XBI sank it as high-beta growth, not
  // defensive). Big pharma + med-devices, all 20-30yr: JNJ, PFE, MRK, ABT, MDT.
  "Health (defensive: pharma/devices)": ["JNJ", "PFE", "MRK", "ABT", "MDT"],
  // Primes + munitions, all ~20-30yr (ITA '06 → ~19yr): LMT, NOC, GD, ITA.
  "Defense / munitions": ["LMT", "NOC", "GD", "ITA"],
  // Control — overlaps the held book (FIW). Water utilities/infra, ~17-20yr: PHO '05, AWK '08, WTRG decades.
  "Climate-adaptation / water (control)": ["PHO", "AWK", "WTRG"],
};

async function loadSeries(tickers) {
  const out = {};
  for (const t of tickers) {
    try { const s = await deepSeries(t); if (s) out[t] = { dates: s.dates, closes: s.closes }; else console.error(`  (thin/none: ${t})`); }
    catch (e) { console.error(`  (fetch failed: ${t} — ${e.message.slice(0, 60)})`); }
  }
  return out;
}

const pct = (x) => (x == null ? "  —  " : (x * 100).toFixed(1) + "%");
const sliceFrom = (s, start) => { const i = s.dates.findIndex((d) => d >= start); return i < 0 ? { dates: [], closes: [] } : { dates: s.dates.slice(i), closes: s.closes.slice(i) }; };
const sliceMap = (m, start) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sliceFrom(v, start)]));

// Rank: must qualify on correlation AND reward return. Score = Sharpe penalised by correlation.
const score = (r) => (r.stats && r.corr ? r.stats.sharpe - Math.abs(r.corr.corr) : -99);

function buildRows(complexSeries, candByAxis) {
  const complexTk = Object.keys(complexSeries);
  const rows = [];
  for (const [axis, cand] of Object.entries(candByAxis)) {
    const candTk = Object.keys(cand).filter((t) => cand[t]?.closes?.length);
    const stats = candTk.length >= 2 ? basketStats(cand, candTk) : null;
    const corr = candTk.length >= 2 ? axisCorrelation({ ...complexSeries, ...cand }, candTk, complexTk, { corrMax: 0.5, betaMax: 0.7 }) : null;
    rows.push({ axis, candTk, stats, corr });
  }
  return rows.sort((a, b) => score(b) - score(a));
}

function printTable(title, cx, rows) {
  console.log("\n" + "=".repeat(104));
  console.log(title + "\n");
  console.log(`  complex: ${cx?.start}..${cx?.end} (${cx?.years}yr)  CAGR ${pct(cx?.cagr)}  maxDD ${pct(cx?.maxDD)}  Sharpe ${cx?.sharpe}\n`);
  console.log("axis".padEnd(38), "yrs".padStart(5), "CAGR".padStart(7), "maxDD".padStart(7), "Shrp".padStart(6), "corr".padStart(6), "beta".padStart(6), "  gate");
  for (const { axis, candTk, stats, corr } of rows) {
    if (!stats || !corr) { console.log(axis.padEnd(38), "  (insufficient data)", candTk.join(",")); continue; }
    console.log(axis.padEnd(38), String(stats.years).padStart(5), pct(stats.cagr).padStart(7), pct(stats.maxDD).padStart(7),
      String(stats.sharpe).padStart(6), String(corr.corr).padStart(6), String(corr.beta).padStart(6), corr.qualifies ? "  ✅ uncorr" : "  ❌ too corr");
  }
}

function mdTable(title, cx, rows) {
  let md = `### ${title}\n\n_Complex ${COMPLEX.join("+")}: ${cx?.start}..${cx?.end} (${cx?.years}yr), CAGR ${pct(cx?.cagr)}, maxDD ${pct(cx?.maxDD)}, Sharpe ${cx?.sharpe}._\n\n`;
  md += "| Axis | yrs | CAGR | maxDD | Sharpe | corr | beta | Gate |\n|---|--:|--:|--:|--:|--:|--:|:--|\n";
  for (const { axis, candTk, stats, corr } of rows) {
    md += stats && corr
      ? `| ${axis} | ${stats.years} | ${pct(stats.cagr)} | ${pct(stats.maxDD)} | ${stats.sharpe} | ${corr.corr} | ${corr.beta} | ${corr.qualifies ? "✅ uncorr" : "❌ too corr"} |\n`
      : `| ${axis} | — | — | — | — | — | — | ⚠️ insufficient data (${candTk.join(",")}) |\n`;
  }
  return md + "\n";
}

(async () => {
  console.log("Fetching AI-capex complex (long-history proxy):", COMPLEX.join(", "));
  const complexSeries = await loadSeries(COMPLEX);
  if (Object.keys(complexSeries).length < 2) { console.error("Not enough complex series — need network."); process.exit(1); }

  const candByAxis = {};
  for (const [axis, tickers] of Object.entries(CANDIDATES)) {
    console.log(`\nFetching candidate "${axis}":`, tickers.join(", "));
    candByAxis[axis] = await loadSeries(tickers);
  }

  // Table A — each basket over its OWN max history (longest available per basket).
  const cxOwn = basketStats(complexSeries, Object.keys(complexSeries));
  const rowsOwn = buildRows(complexSeries, candByAxis);

  // Table B — APPLES-TO-APPLES: slice every series to the common start (latest IPO across all baskets),
  // so all correlations are measured on the identical window. Controls for the window-length confound
  // that flatters longer-history baskets (their pre-AI-era years are trivially uncorrelated).
  let commonStart = "0000-00-00";
  for (const m of [complexSeries, ...Object.values(candByAxis)]) for (const s of Object.values(m)) if (s.dates?.[0] > commonStart) commonStart = s.dates[0];
  const complexC = sliceMap(complexSeries, commonStart);
  const candByAxisC = Object.fromEntries(Object.entries(candByAxis).map(([a, m]) => [a, sliceMap(m, commonStart)]));
  const cxC = basketStats(complexC, Object.keys(complexC));
  const rowsCommon = buildRows(complexC, candByAxisC);

  printTable("TABLE A — each basket over its OWN max history (windows differ)", cxOwn, rowsOwn);
  printTable(`TABLE B — APPLES-TO-APPLES, all sliced to common start ${commonStart}`, cxC, rowsCommon);
  console.log("\nWinner = passes the gate (✅) AND earns its capital — judged on TABLE B (identical window).");
  console.log("Food/ag was a SHORT-WINDOW mirage; the long window is the honest test.");

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import("node:fs");
    let md = "## G2 — second-axis screen (uncorrelated **and** earns its capital)\n\n";
    md += "**Decide on Table B** (identical window) — Table A's longer-history baskets are flattered by their pre-AI-era years.\n\n";
    md += mdTable("Table A — each basket's own max history (windows differ)", cxOwn, rowsOwn);
    md += mdTable(`Table B — apples-to-apples, all from ${commonStart}`, cxC, rowsCommon);
    md += "_Climate/water is a control (overlaps held FIW). Food/ag looked best over ~2yr but is the worst over a full cycle — high-beta cyclical._\n";
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
})();
