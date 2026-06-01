#!/usr/bin/env node
// G2 data-driven axis pick. A 2nd scarcity axis must (a) be UNcorrelated to the AI-capex complex AND
// (b) EARN its capital on its own — low correlation to a loser is worthless. So we measure BOTH, over a
// long (~15-20yr) window. Long-lived pure-plays (not young ETFs) so history isn't truncated to ~2yr.
// Run with network (GitHub Actions, or local): node scripts/axis-check.mjs
import { fetchSeries, fetchStooqHistory, fetchTiingoHistory } from "./lib/quotes.mjs";
import { reconcileSeries } from "./lib/history-reconcile.mjs";
import { axisCorrelation, basketStats, aiCapexLoading } from "./lib/axis.mjs";

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

// Broad MARKET factor (long-lived) — used to strip generic market beta out of the AI-capex signal.
const MARKET = ["SPY"];
// AI-capex complex proxy — long-lived so the window is ~25yr: QQQ (1999) + SMH semis (2000). Orthogonalized
// from MARKET (above) to form the AI-capex-SPECIFIC factor. (Held ETFs like NUKZ/PAVE are too young.)
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

// Rank by risk-adjusted return, penalising ONLY positive AI-capex loading (negative aiβ is a hedge, not a
// risk — see axis.mjs). In practice all liquid sectors have ~zero/negative aiβ, so this ranks on Sharpe.
const score = (r) => (r.stats && r.load ? r.stats.sharpe - Math.max(0, r.load.aiBeta) : -99);

function buildRows(marketSeries, complexSeries, candByAxis) {
  const complexTk = Object.keys(complexSeries), marketTk = Object.keys(marketSeries);
  const rows = [];
  for (const [axis, cand] of Object.entries(candByAxis)) {
    const candTk = Object.keys(cand).filter((t) => cand[t]?.closes?.length);
    const merged = { ...marketSeries, ...complexSeries, ...cand };
    const stats = candTk.length >= 2 ? basketStats(cand, candTk) : null;
    const corr = candTk.length >= 2 ? axisCorrelation(merged, candTk, complexTk, { corrMax: 0.5, betaMax: 0.7 }) : null;
    const load = candTk.length >= 2 ? aiCapexLoading(merged, candTk, marketTk, complexTk, { aiBetaMax: 0.3 }) : null;
    rows.push({ axis, candTk, stats, corr, load });
  }
  return rows.sort((a, b) => score(b) - score(a));
}

function printTable(title, cx, rows) {
  console.log("\n" + "=".repeat(112));
  console.log(title + "\n");
  console.log(`  complex: ${cx?.start}..${cx?.end} (${cx?.years}yr)  CAGR ${pct(cx?.cagr)}  maxDD ${pct(cx?.maxDD)}  Sharpe ${cx?.sharpe}\n`);
  console.log("axis".padEnd(38), "yrs".padStart(5), "CAGR".padStart(7), "maxDD".padStart(7), "Shrp".padStart(6), "mktβ".padStart(6), "aiβ".padStart(6), "aiT".padStart(6), "rawρ".padStart(6), "  gate(aiβ)");
  for (const { axis, candTk, stats, corr, load } of rows) {
    if (!stats || !load) { console.log(axis.padEnd(38), "  (insufficient data)", candTk.join(",")); continue; }
    console.log(axis.padEnd(38), String(stats.years).padStart(5), pct(stats.cagr).padStart(7), pct(stats.maxDD).padStart(7),
      String(stats.sharpe).padStart(6), String(load.marketBeta).padStart(6), String(load.aiBeta).padStart(6),
      String(load.aiT ?? "—").padStart(6), String(corr?.corr ?? "—").padStart(6), load.qualifies ? "  ✅ no +aiβ" : "  ❌ +AI-loaded");
  }
}

function mdTable(title, cx, rows) {
  let md = `### ${title}\n\n_Complex ${COMPLEX.join("+")} vs market ${MARKET.join("+")}: ${cx?.start}..${cx?.end} (${cx?.years}yr), CAGR ${pct(cx?.cagr)}, maxDD ${pct(cx?.maxDD)}, Sharpe ${cx?.sharpe}._\n\n`;
  md += "| Axis | yrs | CAGR | maxDD | **Sharpe** | **mktβ** | aiβ | aiT | rawρ | Gate (aiβ) |\n|---|--:|--:|--:|--:|--:|--:|--:|--:|:--|\n";
  for (const { axis, candTk, stats, corr, load } of rows) {
    md += stats && load
      ? `| ${axis} | ${stats.years} | ${pct(stats.cagr)} | ${pct(stats.maxDD)} | **${stats.sharpe}** | **${load.marketBeta}** | ${load.aiBeta} | ${load.aiT ?? "—"} | ${corr?.corr ?? "—"} | ${load.qualifies ? "✅ no +aiβ" : "❌ +AI-loaded"} |\n`
      : `| ${axis} | — | — | — | — | — | — | — | — | ⚠️ insufficient data (${candTk.join(",")}) |\n`;
  }
  return md + "\n";
}

(async () => {
  console.log("Fetching market factor:", MARKET.join(", "), "| AI-capex complex:", COMPLEX.join(", "));
  const marketSeries = await loadSeries(MARKET);
  const complexSeries = await loadSeries(COMPLEX);
  if (!Object.keys(marketSeries).length || Object.keys(complexSeries).length < 2) { console.error("Not enough market/complex series — need network."); process.exit(1); }

  const candByAxis = {};
  for (const [axis, tickers] of Object.entries(CANDIDATES)) {
    console.log(`\nFetching candidate "${axis}":`, tickers.join(", "));
    candByAxis[axis] = await loadSeries(tickers);
  }

  // Table A — each basket over its OWN max history (longest available per basket).
  const cxOwn = basketStats(complexSeries, Object.keys(complexSeries));
  const rowsOwn = buildRows(marketSeries, complexSeries, candByAxis);

  // Table B — APPLES-TO-APPLES: slice every series to the common start (latest IPO across all baskets),
  // so all loadings are measured on the identical window. Controls for the window-length confound that
  // flatters longer-history baskets (their pre-AI-era years are trivially uncorrelated).
  let commonStart = "0000-00-00";
  for (const m of [marketSeries, complexSeries, ...Object.values(candByAxis)]) for (const s of Object.values(m)) if (s.dates?.[0] > commonStart) commonStart = s.dates[0];
  const marketC = sliceMap(marketSeries, commonStart), complexC = sliceMap(complexSeries, commonStart);
  const candByAxisC = Object.fromEntries(Object.entries(candByAxis).map(([a, m]) => [a, sliceMap(m, commonStart)]));
  const cxC = basketStats(complexC, Object.keys(complexC));
  const rowsCommon = buildRows(marketC, complexC, candByAxisC);

  printTable("TABLE A — each basket over its OWN max history (windows differ)", cxOwn, rowsOwn);
  printTable(`TABLE B — APPLES-TO-APPLES, all sliced to common start ${commonStart}`, cxC, rowsCommon);
  console.log("\naiβ = AI-capex loading AFTER market beta. Negative = mild HEDGE (passes); only POSITIVE loading fails.");
  console.log("Finding: raw ρ is almost all market beta (mktβ). aiβ is small/negative for ALL → none amplifies AI-capex");
  console.log("risk, and it does NOT differentiate them. So decide on risk-adjusted return + maxDD + structural thesis,");
  console.log("preferring the LOWEST mktβ. Judge on TABLE B.");

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import("node:fs");
    let md = "## G2 — second-axis screen (2-factor: market beta stripped out)\n\n";
    md += "**Key finding:** raw correlation (rawρ ~0.5) is almost entirely **market beta** (mktβ). The AI-capex-specific ";
    md += "loading (**aiβ**) is small and *negative* for every candidate — so none amplifies the AI concentration, and aiβ ";
    md += "does **not** differentiate them. Decide on **risk-adjusted return + maxDD + lowest mktβ** (Table B, identical window). ";
    md += "aiT (t-stat) shows aiβ is statistically thin. Negative aiβ is a mild hedge → passes; only *positive* AI loading fails.\n\n";
    md += mdTable("Table A — each basket's own max history (windows differ)", cxOwn, rowsOwn);
    md += mdTable(`Table B — apples-to-apples, all from ${commonStart}`, cxC, rowsCommon);
    md += "_Lowest mktβ + lowest maxDD = best diversifier against a concentrated AI book. Climate/water is a control (overlaps held FIW)._\n";
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
})();
