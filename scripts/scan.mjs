#!/usr/bin/env node
// Scarcity radar scanner. Runs in GitHub Actions (free) on a schedule.
// - Pulls free quotes (no key) for all portfolio + watchlist tickers
// - Computes crowding proxy (% off 52w high, YTD) and auto-trigger status
// - Optionally runs a free-LLM analyst+red-team digest (if GEMINI/GROQ key set)
// - Writes web/data/signals.json (committed by the workflow)
// Usage: node scripts/scan.mjs [--offline]

import { readFileSync, writeFileSync } from "node:fs";
import { isTradeable, fetchYahoo, fetchSeries, fetchStooqHistory, fetchTiingoHistory } from "./lib/quotes.mjs";
import { reconcileSeries } from "./lib/history-reconcile.mjs";
import { basketIndex, portfolioMetrics } from "./lib/metrics.mjs";
import { backtestRegime } from "./lib/backtest.mjs";
import { getQuotes, providerKeys } from "./lib/marketdata.mjs";
import { macroStress } from "./lib/macro.mjs";
import { toUsd, fetchRates } from "./lib/fx.mjs";
import { newlyFired, confirmFired } from "./lib/alerts.mjs";
import { fetchAtmIv } from "./lib/iv.mjs";
import { analystRedteamDigest, llmAvailable } from "./lib/llm.mjs";
import { validateInputs, validateSignals, validatePositions, validateSecurities, assertValid, SCHEMA_VERSION } from "./lib/schema.mjs";
import { watchFilings } from "./lib/edgar.mjs";
import { watchNews } from "./lib/news.mjs";
import { getForwardPEs } from "./lib/fundamentals.mjs";
import { computeRegime } from "./lib/regime.mjs";
import { updateScarcityHistory, applySeenState } from "./lib/history.mjs";
import { writeDcaPlan } from "./lib/dca.mjs";
import { makeForecasts, resolveDue, updateScorecard, makeScarcityForecasts } from "./lib/forecast.mjs";
import { relativeStrength, deRatingSignal } from "./lib/derating.mjs";
import { newsForQuery } from "./lib/news.mjs";
import { chokepointHeat } from "./lib/chokepoints.mjs";
import { rankOpportunities, opportunityScore } from "./lib/opportunity.mjs";
import { forcedFlowSignal, reconcileWithTiming } from "./lib/forced-flow.mjs";
import { v23State, dislocationEntryWindow, compositeStress } from "./lib/v23.mjs";
import { supabaseConfigured, seriesToRows, upsertPriceHistory, sanitizePriceRows, dedupePriceRows, readSeries } from "./lib/supabase.mjs";
import { discoverProxies, rankProxies, proxyGraph } from "./lib/edgar-fts.mjs";

const OFFLINE = process.argv.includes("--offline");
const BACKFILL = process.argv.includes("--backfill"); // one-time deep history seed into Supabase
const read = (p) => JSON.parse(readFileSync(new URL(`../web/data/${p}`, import.meta.url)));
const priceRows = []; // accumulated daily closes (ticker,d,close) → upserted to Supabase if configured

const dataUrl = (p) => new URL(`../web/data/${p}`, import.meta.url);

// Series source for metrics/backtest/V2.3: prefer the ACCUMULATED, cross-checked, adjusted DB
// history (deep → meaningful multi-year metrics, resilient to Yahoo outages); fall back to a live
// fetch when the DB isn't configured or lacks the ticker. Returns { ticker, dates, closes, src }.
let _dbHits = 0, _liveHits = 0;
async function seriesFor(ticker, { liveRange = "1y", years } = {}) {
  if (supabaseConfigured()) {
    try {
      const minDate = years ? new Date(Date.now() - years * 365.25 * 86400000).toISOString().slice(0, 10) : undefined;
      const s = await readSeries(ticker, { minDate });
      if (s && s.closes.length >= 60) { _dbHits++; return { ...s, src: "db" }; }
    } catch { /* fall through to live */ }
  }
  const s = await fetchSeries(ticker, liveRange);
  _liveHits++;
  return { ...s, src: "live" };
}

// V2.3 series: deep history from the DB (no on-demand 2y fetch when seeded) + today's latest REAL
// bar via one light quote — which both makes the cross-check current and appends that bar to the DB
// (these tickers aren't in the universe, so this is how the DB stays fed for them). Pushes to priceRows.
async function v23Series(ticker) {
  let s = null;
  try { s = await seriesFor(ticker, { liveRange: "2y", years: 6 }); } catch { /* may be unavailable */ }
  try {
    const q = await fetchYahoo(ticker); // light 1y fetch; we use only its latest bar
    if (q && q.price > 0 && q.asof) {
      if (!s) s = { ticker, dates: [], closes: [], src: "live" };
      if (s.dates[s.dates.length - 1] !== q.asof) { s.dates.push(q.asof); s.closes.push(q.price); }
      priceRows.push({ ticker, d: q.asof, close: q.price, source: q.source || "yahoo" });
    }
  } catch { /* top-up best-effort */ }
  return s;
}
const portfolio = read("portfolio.json");
const scarcities = read("scarcities.json");
const triggers = read("triggers.json");
const securities = (() => {
  try { const s = read("securities.json"); assertValid("securities.json", validateSecurities(s)); return s.securities || {}; }
  catch (e) { if (!/ENOENT|no such file/i.test(e.message)) throw e; return {}; } // S1: validate, fail loudly
})();
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
const holdTickers = portfolio.holdings.map((h) => h.ticker).filter(isTradeable);
if (!OFFLINE) {
  try { quotes = await getQuotes(universe, { keys: providerKeys(), holdings: holdTickers }); }
  catch (e) { errors.push(`getQuotes: ${e.message}`); }
} else {
  errors.push("offline mode: no live quotes fetched");
}

// Previous committed scan (for the anomaly guard + alert state-change detection).
let prevSig = {};
try { prevSig = JSON.parse(readFileSync(new URL("../web/data/signals.json", import.meta.url))) || {}; } catch { /* first run */ }
const prevQuotes = prevSig.quotes || {};
const ANOMALY = 0.35;
for (const [tk, q] of Object.entries(quotes)) {
  const prev = prevQuotes[tk]?.price;
  if (q && !q.error && q.price && prev && Math.abs(q.price / prev - 1) > ANOMALY) {
    q.flags = [...(q.flags || []), `jump ${((q.price / prev - 1) * 100).toFixed(0)}% vs last scan`];
  }
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

// Data-quality summary across the universe (drives fail-safe trigger gating below).
const vals = Object.values(enriched);
const nOk = vals.filter((q) => q && !q.error).length;
const nErr = vals.filter((q) => q && q.error).length;
const nFlagged = vals.filter((q) => q && q.flags?.length).length;
const corr = vals.filter((q) => q?.corroboration);
const nCorrob = corr.filter((q) => q.corroboration.ok === true).length;
const errRate = vals.length ? nErr / vals.length : 1;
const degraded = OFFLINE || errRate > 0.3 || (nOk > 0 && nFlagged / Math.max(nOk, 1) > 0.25);
const data_quality = {
  ok: !degraded, ok_quotes: nOk, errored: nErr, flagged: nFlagged,
  corroborated: nCorrob, corroborated_of: corr.length,
  note: degraded ? "degraded — auto-triggers held this run" : `${nOk} ok, ${nFlagged} flagged, ${nCorrob}/${corr.length} cross-source-corroborated`,
};
if (!OFFLINE) console.log(`Data quality: ${data_quality.note}`);

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

// --- Real ATM implied vol (free, keyless Yahoo options endpoint) for holdings ---
if (!OFFLINE) {
  const ivTickers = portfolio.holdings.map((h) => h.ticker).filter(isTradeable);
  let got = 0;
  for (const t of ivTickers) {
    const iv = await fetchAtmIv(t);
    if (iv != null && enriched[t] && !enriched[t].error) { enriched[t].atm_iv = iv; got++; }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`ATM IV: ${got}/${ivTickers.length} resolved`);
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
// prevMet: was this trigger's raw condition met last scan? (fallback to fired for old files)
const prevMet = (id) => { const p = prevSig.trigger_status?.[id]; return p?.met ?? p?.fired ?? false; };
const avgDrawdown = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null;
const dd = triggers.triggers.find((x) => x.id === "drawdown");
// Fail-safe: `met` is only true on a good (non-degraded) data run. Two-scan
// confirmation: a trigger only FIRES when met now AND met last scan.
const drawdownMet = !degraded && avgDrawdown != null && Math.abs(avgDrawdown) >= (dd?.threshold ?? 0.2);
const drawdownFired = confirmFired(drawdownMet, prevMet("drawdown"));

// Sleeve-cap + cost-basis trim rule (need positions.local.json for live values).
const sleeveCapUsd = triggers.triggers.find((x) => x.id === "sleeve_cap")?.threshold ?? 1720000;
let sleeveValue = null, sleeveMet = false, sleeveFired = false;
let sleeveNote = "add web/data/positions.local.json (gitignored) for the live sleeve value";
let trimHits = [], trimMet = false, trimFired = false, trimNote = "add positions.local.json with cost basis to evaluate";

// F2b: fetch FX rates (free, keyless) for any non-USD position currencies.
let fxRates = { USD: 1 };
if (!OFFLINE && positions?.positions) {
  const curs = Object.keys(positions.positions).map((t) => enriched[t]?.currency).filter((c) => c && c !== "USD");
  if (curs.length) { try { fxRates = await fetchRates(curs); } catch (e) { errors.push(`fx: ${e.message}`); } }
}

if (positions?.positions) {
  let sum = 0, priced = 0; const missing = [], noFx = [];
  for (const [t, p] of Object.entries(positions.positions)) {
    const q = enriched[t];
    const price = q?.price;
    if (price && p.shares) {
      // C3: never assume USD. Use the quote currency; if unknown but the security is
      // flagged foreign, treat as UNKNOWN (no rate → excluded) rather than silently USD.
      const cur = q.currency || (securities[t]?.foreign ? "UNKNOWN" : "USD");
      const usd = toUsd(price * p.shares, cur, fxRates); // converts foreign lots to USD
      if (usd == null) { noFx.push(`${t}(${cur})`); continue; } // no rate → skip + flag
      sum += usd; priced++;
    } else if (p.shares) missing.push(t);
  }
  if (typeof positions.cash_usd === "number") sum += positions.cash_usd;
  if (priced) {
    sleeveValue = Math.round(sum);
    sleeveMet = !degraded && sleeveValue >= sleeveCapUsd;
    sleeveFired = confirmFired(sleeveMet, prevMet("sleeve_cap"));
    sleeveNote = `sleeve ≈ $${(sleeveValue / 1e6).toFixed(2)}mm vs $${(sleeveCapUsd / 1e6).toFixed(2)}mm cap` +
      (missing.length ? ` (no price for ${missing.join(", ")})` : "") +
      (noFx.length ? ` (no FX rate for ${noFx.join(", ")} — excluded)` : "");
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
  trimMet = !degraded && trimHits.length > 0;
  trimFired = confirmFired(trimMet, prevMet("trim_rule"));
  trimNote = trimHits.length ? `${trimHits.length} name(s) > 2x cost AND > 50x forward` : "no name > 2x cost AND > 50x forward";
}

// A trigger is "pending" the first scan its condition is met (awaiting confirmation).
const pend = (met, fired) => (met && !fired ? " (pending — needs a 2nd confirming scan)" : "");
const trigger_status = {
  drawdown: {
    met: drawdownMet, fired: drawdownFired,
    value: avgDrawdown == null ? null : +(avgDrawdown * 100).toFixed(1),
    note: (avgDrawdown == null ? "no data" : `avg ${(avgDrawdown * 100).toFixed(1)}% from 52w highs`) + pend(drawdownMet, drawdownFired),
  },
  sleeve_cap: { met: sleeveMet, fired: sleeveFired, value: sleeveValue, note: sleeveNote + pend(sleeveMet, sleeveFired) },
  trim_rule: { met: trimMet, fired: trimFired, hits: trimHits, note: trimNote + pend(trimMet, trimFired) },
};

// Alerts: which triggers are fired, and which are NEWLY fired vs the last scan
// (email/issue fire on the state change, not every run).
const alerts = {
  fired: Object.entries(trigger_status).filter(([, v]) => v?.fired).map(([k]) => k),
  newly_fired: newlyFired(trigger_status, prevSig.trigger_status),
};
if (alerts.newly_fired.length) console.log(`Alerts: newly fired -> ${alerts.newly_fired.join(", ")}`);

// --- Objective metrics: trailing CAGR / maxDD / Calmar / Sortino on the strategy basket ---
let metrics = null;
if (!OFFLINE) {
  try {
    const etfs = portfolio.holdings.filter((h) => isTradeable(h.ticker) && securities[h.ticker]?.type === "etf");
    const use = etfs.length >= 3 ? etfs : portfolio.holdings.filter((h) => isTradeable(h.ticker));
    const weights = Object.fromEntries(use.map((h) => [h.ticker, h.weight || h.target_usd || 1]));
    const series = {};
    let fromDb = 0;
    for (const h of use) {
      try { const s = await seriesFor(h.ticker, { liveRange: "1y", years: 11 }); series[h.ticker] = s; if (s.src === "db") fromDb++; } catch { /* skip */ }
      if (!supabaseConfigured()) await new Promise((r) => setTimeout(r, 120)); // throttle only when live-fetching
    }
    const idx = basketIndex(series, weights);
    if (idx.values.length > 60) {
      const years = ((Date.parse(idx.dates[idx.dates.length - 1]) - Date.parse(idx.dates[0])) / (365.25 * 86400000)).toFixed(1);
      metrics = { ...portfolioMetrics(idx.values), basis: Object.keys(series), window: `${idx.dates[0]}..${idx.dates[idx.dates.length - 1]}`, source: fromDb ? `accumulated DB (${fromDb}/${Object.keys(series).length} tickers)` : "live", note: `trailing ~${years}y, target-weighted strategy basket${fromDb ? " (from accumulated history)" : ""}` };
      console.log(`Metrics: CAGR ${metrics.cagr}, maxDD ${metrics.max_drawdown} (breaches35=${metrics.breaches_35}), Calmar ${metrics.calmar}, Sortino ${metrics.sortino} [${years}y, ${fromDb} from DB]`);
      // Falsifiable evidence: does a trend brake cut drawdown on this basket vs buy-and-hold?
      if (idx.values.length > 120) {
        const mp = idx.values.length > 220 ? 100 : 50; // ~1y window → shorter trend than the live 200-DMA dial
        const bt = backtestRegime(idx.values, { maPeriod: mp });
        if (bt) { metrics.backtest = bt; console.log(`Backtest(ma${mp}): braked maxDD ${bt.braked.max_drawdown} vs ${bt.unbraked.max_drawdown}, dd_reduction ${bt.dd_reduction}, whipsaws ${bt.whipsaws}`); }
      }
    }
  } catch (e) { errors.push(`metrics: ${e.message}`); }
}

// --- Macro-stress overlay inputs (free, keyless): VIX term-structure + HY credit velocity ---
let macro = null;
if (!OFFLINE) {
  try {
    const [vix, vix3m, hyg] = await Promise.all([
      fetchYahoo("^VIX").catch(() => null),
      fetchYahoo("^VIX3M").catch(() => null),
      fetchYahoo("HYG").catch(() => null),
    ]);
    const m = macroStress({ vix: vix?.price, vix3m: vix3m?.price, hygMom1m: hyg?.mom_1m });
    // R1: if the inputs didn't come back, leave macro=null so the regime marks the
    // exit-only brake UNAVAILABLE instead of silently showing "calm".
    if (m.vix_term == null && m.hy_mom_1m == null) errors.push("macro: VIX/HY feeds unavailable — overlay disabled this run");
    else { macro = m; console.log(`Macro: ${m.stressed ? "STRESSED" : "calm"} (vix_term ${m.vix_term}, hy_1m ${m.hy_mom_1m})`); }
  } catch (e) { errors.push(`macro: ${e.message}`); }
}

// --- Timing layer: trend/momentum/vol/drawdown + 20-DMA re-entry + macro overlay ---
const regime = computeRegime(enriched, portfolio.holdings, { macro, securities });
console.log(`Regime: ${regime.posture}${regime.risk_score != null ? ` (risk ${regime.risk_score}/100)` : ""}`);

// --- F4: append scarcity history + surface drift; F7: mark new filings/news ---
const { drift: scarcity_drift } = updateScarcityHistory(dataUrl("scarcity-history.json"), scarcities.scarcities, TODAY);
const { newFilings, newNews } = applySeenState(dataUrl("seen.state.json"), { filings, news, triggerStatus: trigger_status, today: TODAY });
console.log(`History: ${Object.keys(scarcity_drift).length} scarcities drifted; ${newFilings} new filings, ${newNews} new headlines`);

// F6: regenerate the machine-readable DCA plan from the tier rules (deterministic).
writeDcaPlan(dataUrl("dca.json"), portfolio, TODAY);

// --- Alpha signal: per-scarcity relative strength vs the AI-capex complex →
// de-rating (crowded rolling over) / inflecting (under-priced gaining) flags ---
// Mean live crowding per scarcity (price-derived priced-in proxy) → refines the Opportunity gate.
const crowdingById = {};
for (const s of scarcities.scarcities) {
  const cz = s.tickers.map((t) => enriched[t]?.crowding).filter((x) => typeof x === "number");
  crowdingById[s.id] = cz.length ? cz.reduce((a, b) => a + b, 0) / cz.length : null;
}
const scarcity_signals = {};
{
  const etfMoms = portfolio.holdings
    .filter((h) => securities[h.ticker]?.type === "etf")
    .map((h) => enriched[h.ticker]?.mom_1m).filter((x) => typeof x === "number");
  const complexMom = etfMoms.length ? etfMoms.reduce((a, b) => a + b, 0) / etfMoms.length : null;
  for (const s of scarcities.scarcities) {
    const moms = s.tickers.map((t) => enriched[t]?.mom_1m).filter((x) => typeof x === "number");
    const rs = relativeStrength(moms, complexMom);
    scarcity_signals[s.id] = { ...deRatingSignal(s.priced_in, rs), ...opportunityScore(s, { liveCrowding: crowdingById[s.id] ?? null }) };
  }
  const flagged = Object.values(scarcity_signals).filter((x) => x.flag !== "none").length;
  if (!OFFLINE) console.log(`Alpha signals: ${flagged} scarcities flagged (de-rating/inflecting)`);
}

// --- Opportunity Score: rank the scarcity universe by ALPHA.md Edge 1 (duration mispricing).
// Where the structural edge is BEFORE the tape moves: binds soon + durable + defensible + NOT
// yet priced (the human label refined by LIVE crowding). From source fields, not a backtest. ---
const opportunities = rankOpportunities(scarcities.scarcities, crowdingById);

// --- Forced-flow / neglect (ALPHA.md Edge 3): mechanical de-rating into an INTACT thesis =
// "buy what others are forced to sell"; into a weak thesis = broken (avoid). Read from the
// tape's footprint (no paid event feed needed) + a tax-loss-season overlay. ---
// Overlay composition (philosophy "alpha → timing → cash"): the forced-flow signal governs
// SELECTION (what to deploy into), the regime/macro overlay governs PACE (whether to deploy
// now). They must never contradict on screen — so when the timing overlay has the brakes on
// (defensive/caution or macro-stress), an "accumulate" is reframed as a deploy-on-the-trigger
// PRIORITY, not a buy-now instruction. This keeps the overlays one coherent system.
for (const s of scarcities.scarcities) {
  const ff = forcedFlowSignal({ quotes: enriched, tickers: s.tickers, opportunity: scarcity_signals[s.id]?.score ?? null, today: TODAY });
  scarcity_signals[s.id].forced_flow = reconcileWithTiming(ff, regime);
}
const anyDislocation = Object.values(scarcity_signals).some((x) => x.forced_flow?.flag === "accumulate");
if (!OFFLINE) console.log(`Forced-flow: ${Object.values(scarcity_signals).filter((x) => x.forced_flow?.flag === "accumulate").length} thesis-intact dislocation(s) (accumulate)`);
if (!OFFLINE) console.log(`Opportunity Score: top = ${opportunities.slice(0, 3).map((o) => `${o.id} ${o.score}`).join(", ")}`);

// --- V2.3 cross-check + dislocation-entry timing: a FAITHFUL REPLICA of the owner's F+C Thrust
// rule recomputed on QQQ (200-DMA trend, 252-day/60-day-vol crash, rising-20-DMA thrust + exit-only
// composite-stress overlay), to sanity-check Puck's regime; and the answer to "WHEN do I take
// advantage of a dislocation?" (thesis-intact dislocation present AND timing turned). ---
let v23 = { state: "UNAVAILABLE", reasons: ["offline run"], basis: "needs QQQ/VIX/HYG history" };
if (!OFFLINE) {
  try {
    // Deep history from the accumulated DB (no on-demand 2y fetch) + a light latest-bar top-up so
    // the cross-check is current AND the non-universe V2.3 tickers stay fed in the DB.
    const [qqqS, vixS, vix3mS, hygS] = await Promise.all(
      ["QQQ", "^VIX", "^VIX3M", "HYG"].map((t) => v23Series(t)));
    // Keep the V2.3 execution instruments current in the DB too (not used by the cross-check itself).
    for (const t of ["QLD", "SGOV"]) {
      try { const q = await fetchYahoo(t); if (q && q.price > 0 && q.asof) priceRows.push({ ticker: t, d: q.asof, close: q.price, source: q.source || "yahoo" }); } catch { /* ignore */ }
    }
    const stress = compositeStress({ vixCloses: vixS?.closes, vix3mCloses: vix3mS?.closes, hygCloses: hygS?.closes });
    v23 = v23State(qqqS?.closes || null, { compositeStress: stress });
    console.log(`V2.3 cross-check: ${v23.state} (${v23.rule}${v23.overlay_applied ? "+overlay" : ""}); stress ${stress == null ? "suppressed" : stress}; src qqq=${qqqS?.src || "?"}/hyg=${hygS?.src || "?"}`);
  } catch (e) { errors.push(`v23: ${e.message}`); }
}
const dislocation_entry = dislocationEntryWindow({ v23, regime, drawdownFired, anyDislocation });
if (!OFFLINE) console.log(`Dislocation entry: ${dislocation_entry.window}`);

// --- Inaccessible-chokepoint tracker: DISCOVER public proxies (EDGAR full-text
// mentions) + heat (proxy momentum + news) for un-investable bottlenecks ---
let chokepoints = [];
let proxy_hubs = [];
{
  let cps = []; try { cps = read("chokepoints.json").chokepoints || []; } catch { /* optional */ }
  const etfMoms2 = portfolio.holdings.filter((h) => securities[h.ticker]?.type === "etf")
    .map((h) => enriched[h.ticker]?.mom_1m).filter((x) => typeof x === "number");
  const complexMom = etfMoms2.length ? etfMoms2.reduce((a, b) => a + b, 0) / etfMoms2.length : null;
  for (const c of cps) {
    const moms = (c.proxies || []).map((t) => enriched[t]?.mom_1m).filter((x) => typeof x === "number");
    const proxyMom = moms.length ? moms.reduce((a, b) => a + b, 0) / moms.length : null;
    let newsCount = 0, top = null, discovered = [];
    if (!OFFLINE) {
      try { const items = await newsForQuery(c.news_query, { limit: 5 }); newsCount = items.length; top = items[0] || null; } catch { /* ignore */ }
      try { const d = await discoverProxies(c.search_terms, { max: 6 }); discovered = d.proxies; errors.push(...d.errors.map((e) => `fts ${c.id}: ${e}`)); } catch { /* ignore */ }
    }
    const h = chokepointHeat({ proxyMom, complexMom, newsCount });
    chokepoints.push({
      id: c.id, name: c.name, gates: c.gates, access: c.access, proxies: c.proxies || [],
      how_to_access: c.how_to_access, discovered, top_headline: top, ...h,
    });
  }
  // Re-rank discovered proxies by SPECIFICITY across all chokepoints (TF-IDF): the purest
  // pure-play, not the most-mentioning megacap. Needs the full set, so it runs after the loop.
  chokepoints = rankProxies(chokepoints);
  // Second-order exposure graph: which public names sit across MULTIPLE bottlenecks (hubs) vs.
  // pure plays — the diversified vs. concentrated way to play the inaccessible-chokepoint complex.
  proxy_hubs = proxyGraph(chokepoints).filter((n) => n.degree >= 2).slice(0, 12);
  if (!OFFLINE) console.log(`Chokepoints: ${chokepoints.length} tracked; ${proxy_hubs.filter((h) => h.hub).length} cross-chokepoint hub(s)`);
}

// --- Accountability ledger: resolve matured forecasts, score them, record new ones ---
let scorecard = null;
{
  const fpath = dataUrl("forecasts.json");
  let store;
  try { store = JSON.parse(readFileSync(fpath)); }
  catch { store = { schema_version: SCHEMA_VERSION, open: [], scorecard: updateScorecard(null, []) }; }
  const { resolved, stillOpen } = resolveDue(store.open, enriched, TODAY);
  store.scorecard = updateScorecard(store.scorecard, resolved);
  // The AI-capex "complex" = the diversified theme ETFs we hold; the de-rating/inflecting
  // alpha calls are graded RELATIVE to it (does the flagged basket really under/out-perform?).
  const complexTickers = portfolio.holdings
    .filter((h) => securities[h.ticker]?.type === "etf").map((h) => h.ticker);
  const fresh = [
    ...makeForecasts({ regime, quotes: enriched }, TODAY),
    ...makeScarcityForecasts(scarcities.scarcities, { quotes: enriched, scarcity_signals }, TODAY, 42, complexTickers),
  ];
  const openIds = new Set(stillOpen.map((f) => f.id));
  store.open = [...stillOpen, ...fresh.filter((f) => !openIds.has(f.id))];
  store.updated = TODAY;
  writeFileSync(fpath, JSON.stringify(store, null, 2) + "\n");
  scorecard = store.scorecard;
  console.log(`Forecasts: ${resolved.length} resolved, ${store.open.length} open, hit-rate ${store.scorecard.hit_rate}`);
}

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
  alerts,
  regime,
  metrics,
  scorecard,
  scarcity_signals,
  opportunities,
  v23,
  dislocation_entry,
  chokepoints,
  proxy_hubs,
  data_quality,
  scarcity_drift,
  digest,
  errors,
};

// --- Persist price history to Supabase (phase 1) — only when configured (server-side, the
// scanner's service_role key). No-ops silently otherwise so local/offline runs and forks are
// unaffected. Robustness ("no synthetic data"): the deep --backfill reconciles every bar across
// providers (Yahoo + Stooq + Tiingo) — median consensus, conflict/weekend/holiday/jump screening
// (see history-reconcile.mjs). Daily increments persist each ticker's latest REAL bar (true
// date from `asof`, cross-source-corroborated price). `--backfill` seeds FULL history once. ---
const V23_TICKERS = ["QQQ", "^VIX", "^VIX3M", "HYG", "QLD", "SGOV"]; // V2.3 cross-check + execution instruments
if (!OFFLINE && supabaseConfigured()) {
  try {
    // Daily increment: latest real bar per universe ticker (price already cross-source-corroborated,
    // dated by its real last session via `asof`, not a synthesized "today").
    for (const [t, q] of Object.entries(enriched)) {
      if (q && !q.error && q.price > 0 && q.source) {
        const corroborated = (q.corroboration?.sources?.length || 0) >= 2;
        priceRows.push({ ticker: t, d: q.asof || TODAY, close: q.price, source: corroborated ? "consensus" : q.source });
      }
    }
    if (BACKFILL) {
      // FULL history for EVERY ticker (universe + the V2.3 set), reconciled across all providers.
      const all = [...new Set([...universe, ...V23_TICKERS])];
      // Yahoo adjclose + Tiingo adjClose are the ADJUSTED corroborating pair (same basis → they
      // agree). Stooq is kept as a KEYLESS FALLBACK so that when Yahoo/Tiingo are rate-limited we
      // still get history instead of zero; when the adjusted pair is present, Stooq is simply
      // outvoted (never corrupts). Daily-only guard + retry on each. Idempotent: safe to re-run.
      console.log(`Backfill: deep ADJUSTED history for ${all.length} tickers — Yahoo(adj)+Stooq${process.env.TIINGO_API_KEY ? "+Tiingo(adj)" : ""}, cross-provider reconciled…`);
      const tally = { tickers: 0, kept: 0, conflict: 0, weekend: 0, holiday: 0, jump: 0, single: 0, corr: 0 };
      for (const t of all) {
        const sources = {};
        try { sources.yahoo = await fetchSeries(t, "max"); } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 200));
        try { sources.stooq = await fetchStooqHistory(t); } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 200));
        if (process.env.TIINGO_API_KEY) { try { sources.tiingo = await fetchTiingoHistory(t); } catch { /* skip */ } await new Promise((r) => setTimeout(r, 300)); }
        const { rows, stats } = reconcileSeries(t, sources);
        for (const r of rows) priceRows.push({ ticker: r.ticker, d: r.d, close: r.close, source: r.source }); // drop the corroborated flag (encoded in source)
        if (rows.length) { tally.tickers++; tally.kept += stats.kept; tally.conflict += stats.dropped_conflict; tally.weekend += stats.dropped_weekend; tally.holiday += stats.dropped_holiday_fill; tally.jump += stats.dropped_jump; tally.single += stats.single_source; tally.corr += stats.corroborated; }
        console.log(`  ${t}: ${stats.kept} bars (${stats.corroborated} corroborated, ${stats.single_source} single)${rows.length ? ` ${rows[0].d}..${rows[rows.length - 1].d}` : ""}${stats.dropped_conflict + stats.dropped_weekend + stats.dropped_holiday_fill + stats.dropped_jump ? ` · dropped ${stats.dropped_conflict}conf/${stats.dropped_weekend}wknd/${stats.dropped_holiday_fill}hol/${stats.dropped_jump}jump` : ""}`);
      }
      console.log(`Backfill reconciliation: ${tally.tickers} tickers, ${tally.kept} bars kept (${tally.corr} corroborated, ${tally.single} single-source); dropped ${tally.conflict} conflict / ${tally.weekend} weekend / ${tally.holiday} holiday-fill / ${tally.jump} jump.`);
    }
    // Higher-trust bars first so de-dupe keeps them: consensus > single-source.
    const ordered = priceRows.slice().sort((a, b) => (a.source === "consensus" ? 0 : 1) - (b.source === "consensus" ? 0 : 1));
    const dedup = dedupePriceRows(ordered);
    const clean = sanitizePriceRows(dedup); // anti-synthetic guard: only real, trusted, valid prints
    const dropped = dedup.length - clean.length;
    const { written, skipped } = await upsertPriceHistory(clean);
    console.log(`Supabase: ${skipped ? "skipped" : `upserted ${written}`} price-history rows (${dedup.length} candidates${dropped ? `, ${dropped} dropped by anti-synthetic guard` : ""})`);
  } catch (e) { errors.push(`supabase: ${e.message}`); console.error(`Supabase upsert failed (non-fatal): ${e.message}`); }
} else if (!OFFLINE) {
  console.log("Supabase: not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY to persist history)");
}

// Validate our own output before writing — never commit a malformed signals.json.
assertValid("generated signals.json", validateSignals(out));

writeFileSync(new URL("../web/data/signals.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote signals.json — ${Object.values(enriched).filter((q) => q && !q.error).length}/${universe.length} quotes OK, ${errors.length} errors, drawdown fired=${drawdownFired}`);
