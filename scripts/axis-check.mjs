#!/usr/bin/env node
// G2 data-driven axis pick. A 2nd scarcity axis must (a) be UNcorrelated to the AI-capex complex AND
// (b) EARN its capital on its own — low correlation to a loser is worthless. So we measure BOTH, over a
// long (~15-20yr) window. Long-lived pure-plays (not young ETFs) so history isn't truncated to ~2yr.
// Run with network (GitHub Actions, or local): node scripts/axis-check.mjs
import { fetchSeries } from "./lib/quotes.mjs";
import { axisCorrelation, basketStats } from "./lib/axis.mjs";

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
    try { const s = await fetchSeries(t, "max"); if (s?.closes?.length > 250) out[t] = { dates: s.dates, closes: s.closes }; else console.error(`  (thin/none: ${t} — ${s?.closes?.length || 0} pts)`); }
    catch (e) { console.error(`  (fetch failed: ${t} — ${e.message.slice(0, 60)})`); }
    await new Promise((r) => setTimeout(r, 150)); // be polite to Yahoo
  }
  return out;
}

const pct = (x) => (x == null ? "  —  " : (x * 100).toFixed(1) + "%");

(async () => {
  console.log("Fetching AI-capex complex (long-history proxy):", COMPLEX.join(", "));
  const complexSeries = await loadSeries(COMPLEX);
  const complexTk = Object.keys(complexSeries);
  if (complexTk.length < 2) { console.error("Not enough complex series — need network."); process.exit(1); }
  const cx = basketStats(complexSeries, complexTk);
  console.log(`  complex window: ${cx?.start}..${cx?.end} (${cx?.years}yr)  CAGR ${pct(cx?.cagr)}  maxDD ${pct(cx?.maxDD)}  Sharpe ${cx?.sharpe}`);

  const rows = [];
  for (const [axis, tickers] of Object.entries(CANDIDATES)) {
    console.log(`\nFetching candidate "${axis}":`, tickers.join(", "));
    const cand = await loadSeries(tickers);
    const candTk = Object.keys(cand);
    const stats = candTk.length >= 2 ? basketStats(cand, candTk) : null;
    const corr = candTk.length >= 2 ? axisCorrelation({ ...complexSeries, ...cand }, candTk, complexTk, { corrMax: 0.5, betaMax: 0.7 }) : null;
    rows.push({ axis, candTk, stats, corr });
  }

  // Rank: must qualify on correlation AND reward return. Simple score = Sharpe penalised by correlation.
  const score = (r) => (r.stats && r.corr ? r.stats.sharpe - Math.abs(r.corr.corr) : -99);
  rows.sort((a, b) => score(b) - score(a));

  console.log("\n" + "=".repeat(104));
  console.log("SECOND-AXIS SCREEN — uncorrelated AND must earn its capital (long history)\n");
  console.log("axis".padEnd(38), "yrs".padStart(5), "CAGR".padStart(7), "maxDD".padStart(7), "Shrp".padStart(6), "corr".padStart(6), "beta".padStart(6), "  gate");
  for (const { axis, candTk, stats, corr } of rows) {
    if (!stats || !corr) { console.log(axis.padEnd(38), "  (insufficient data)", candTk.join(",")); continue; }
    console.log(
      axis.padEnd(38), String(stats.years).padStart(5), pct(stats.cagr).padStart(7), pct(stats.maxDD).padStart(7),
      String(stats.sharpe).padStart(6), String(corr.corr).padStart(6), String(corr.beta).padStart(6),
      corr.qualifies ? "  ✅ uncorr" : "  ❌ too corr"
    );
  }
  console.log("\nWinner = uncorrelated (✅) AND strong standalone return (high CAGR/Sharpe, contained maxDD).");
  console.log("Correlation windows differ by basket's own history (yrs column) — all are long (~15-25yr).");

  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import("node:fs");
    let md = "## G2 — second-axis screen (long history: uncorrelated **and** earns its capital)\n\n";
    md += `_AI-capex complex proxy: ${COMPLEX.join(" + ")} — ${cx?.start}..${cx?.end} (${cx?.years}yr), CAGR ${pct(cx?.cagr)}, maxDD ${pct(cx?.maxDD)}, Sharpe ${cx?.sharpe}._\n\n`;
    md += "| Axis | yrs | CAGR | maxDD | Sharpe | corr | beta | Gate |\n|---|--:|--:|--:|--:|--:|--:|:--|\n";
    for (const { axis, candTk, stats, corr } of rows) {
      md += stats && corr
        ? `| ${axis} | ${stats.years} | ${pct(stats.cagr)} | ${pct(stats.maxDD)} | ${stats.sharpe} | ${corr.corr} | ${corr.beta} | ${corr.qualifies ? "✅ uncorr" : "❌ too corr"} |\n`
        : `| ${axis} | — | — | — | — | — | — | ⚠️ insufficient data (${candTk.join(",")}) |\n`;
    }
    md += "\n**Winner** = passes the correlation gate (✅) **and** earns its capital (high CAGR/Sharpe, contained maxDD). ";
    md += "Climate/water is a **control** (overlaps held FIW). Correlation windows differ by each basket's own history (yrs).\n";
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
})();
