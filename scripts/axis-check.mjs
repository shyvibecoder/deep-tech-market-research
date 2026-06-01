#!/usr/bin/env node
// G2 data-driven axis pick: fetch candidate 2nd-axis baskets + the AI-capex complex, measure each
// candidate's correlation + beta to the complex on history, and print a ranked verdict. Run with network:
//   node scripts/axis-check.mjs
// The lower the |corr| and beta, the more genuine RISK BREADTH the axis adds (vs just more AI-capex beta).
// This is the same gate the scout should apply to reject correlated "breadth" candidates.
import { fetchSeries } from "./lib/quotes.mjs";
import { axisCorrelation } from "./lib/axis.mjs";

// AI-capex complex proxy (what we want to be UNcorrelated to): held theme ETFs + QQQ.
const COMPLEX = ["QQQ", "SMH", "PAVE", "GRID", "COPX", "NUKZ"];

// Candidate second axes (ETF + pure-play proxies; tune freely). Edge-2 names buried in filings come later.
const CANDIDATES = {
  "Food / ag-input security": ["MOO", "NTR", "MOS", "CF", "CTVA", "ADM"],
  "Health-system / demographic": ["XBI", "IHI", "PPH", "WST", "RVTY"],
  "Defense / munitions": ["ITA", "PPA", "NOC", "GD", "LHX"],
  "Climate-adaptation / water": ["FIW", "PHO", "AWK"], // expected MORE correlated (overlaps the book) — a control
};

async function loadSeries(tickers) {
  const out = {};
  for (const t of tickers) {
    try { const s = await fetchSeries(t, "max"); if (s?.closes?.length > 120) out[t] = { dates: s.dates, closes: s.closes }; else console.error(`  (thin/none: ${t})`); }
    catch (e) { console.error(`  (fetch failed: ${t} — ${e.message.slice(0, 60)})`); }
    await new Promise((r) => setTimeout(r, 150)); // be polite to Yahoo
  }
  return out;
}

(async () => {
  console.log("Fetching AI-capex complex:", COMPLEX.join(", "));
  const complexSeries = await loadSeries(COMPLEX);
  const complexTk = Object.keys(complexSeries);
  if (complexTk.length < 2) { console.error("Not enough complex series — need network."); process.exit(1); }

  const rows = [];
  for (const [axis, tickers] of Object.entries(CANDIDATES)) {
    console.log(`\nFetching candidate "${axis}":`, tickers.join(", "));
    const s = { ...complexSeries, ...(await loadSeries(tickers)) };
    const candTk = tickers.filter((t) => s[t]);
    const r = candTk.length >= 2 ? axisCorrelation(s, candTk, complexTk, { corrMax: 0.5, betaMax: 0.7 }) : null;
    rows.push({ axis, candTk, r });
  }

  console.log("\n" + "=".repeat(78));
  console.log("AXIS CORRELATION TO THE AI-CAPEX COMPLEX (lower = more genuine breadth)\n");
  console.log("axis".padEnd(34), "corr".padStart(7), "beta".padStart(7), "R²".padStart(6), "n".padStart(6), "  verdict");
  rows.sort((a, b) => (Math.abs(a.r?.corr ?? 9) - Math.abs(b.r?.corr ?? 9)));
  for (const { axis, candTk, r } of rows) {
    if (!r) { console.log(axis.padEnd(34), "  (insufficient data)", candTk.join(",")); continue; }
    console.log(axis.padEnd(34), String(r.corr).padStart(7), String(r.beta).padStart(7), String(r.r2).padStart(6), String(r.n).padStart(6), r.qualifies ? "  ✅ adds breadth" : "  ❌ too correlated");
  }
  console.log("\nPick the axis with the LOWEST |corr|+beta that also passes the four-edges/objective check.");
  console.log("(Climate/water is a CONTROL — expected to be more correlated since it overlaps the held book.)");

  // When run in GitHub Actions, also emit a phone-readable markdown table to the run summary page.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import("node:fs");
    let md = "## G2 — second-axis correlation to the AI-capex complex\n\n";
    md += "_Lower |corr| + beta = more genuine **risk breadth** (vs just more AI-capex beta)._\n\n";
    md += "| Axis | corr | beta | R² | n | Verdict |\n|---|---:|---:|---:|---:|:--|\n";
    for (const { axis, candTk, r } of rows) {
      md += r
        ? `| ${axis} | ${r.corr} | ${r.beta} | ${r.r2} | ${r.n} | ${r.qualifies ? "✅ adds breadth" : "❌ too correlated"} |\n`
        : `| ${axis} | — | — | — | — | ⚠️ insufficient data (${candTk.join(",")}) |\n`;
    }
    md += "\n**Pick** the lowest-|corr| axis that also passes the four-edges/objective check. ";
    md += "Climate/water is a **control** — expected to be more correlated (it overlaps names already held).\n";
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
})();
