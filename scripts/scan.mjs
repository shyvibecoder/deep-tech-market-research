#!/usr/bin/env node
// Scarcity radar scanner. Runs in GitHub Actions (free) on a schedule.
// - Pulls free quotes (no key) for all portfolio + watchlist tickers
// - Computes crowding proxy (% off 52w high, YTD) and auto-trigger status
// - Optionally runs a free-LLM analyst+red-team digest (if GEMINI/GROQ key set)
// - Writes web/data/signals.json (committed by the workflow)
// Usage: node scripts/scan.mjs [--offline]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { isTradeable, fetchYahoo, fetchSeries, fetchStooqHistory, fetchTiingoHistory } from "./lib/quotes.mjs";
import { technicalsFromHistory } from "./lib/technicals.mjs";
import { reconcileSeries } from "./lib/history-reconcile.mjs";
import { basketIndex, portfolioMetrics } from "./lib/metrics.mjs";
import { backtestRegime } from "./lib/backtest.mjs";
import { returns, alignByDate, factorAttribution, benchmarkRelative, alphaEdgeLabel } from "./lib/factor.mjs";
import { crossSectionalBacktest } from "./lib/xsbacktest.mjs";
import { getQuotes, providerKeys, dataQualityGate, plausibleNextBar } from "./lib/marketdata.mjs";
import { macroStress } from "./lib/macro.mjs";
import { toUsd, fetchRates } from "./lib/fx.mjs";
import { newlyFired, confirmFired } from "./lib/alerts.mjs";
import { fetchAtmIv } from "./lib/iv.mjs";
import { analystRedteamDigest, llmAvailable, availableProviders, seatCaller } from "./lib/llm.mjs";
import { runCatalystWatch } from "./lib/catalyst.mjs";
import { validateInputs, validateSignals, validatePositions, validateSecurities, assertValid, SCHEMA_VERSION } from "./lib/schema.mjs";
import { watchFilings, loadTickerMap, searchFilings } from "./lib/edgar.mjs";
import { getValuation, valuationLabel } from "./lib/valuation.mjs";
import { watchNews } from "./lib/news.mjs";
import { getForwardPEs } from "./lib/fundamentals.mjs";
import { computeRegime } from "./lib/regime.mjs";
import { updateScarcityHistory, applySeenState } from "./lib/history.mjs";
import { writeDcaPlan } from "./lib/dca.mjs";
import { makeForecasts, resolveDue, updateScorecard, makeScarcityForecasts, makeSizingForecast } from "./lib/forecast.mjs";
import { relativeStrength, deRatingSignal, tickerRelStrength } from "./lib/derating.mjs";
import { newsForQuery } from "./lib/news.mjs";
import { chokepointHeat } from "./lib/chokepoints.mjs";
import { rankOpportunities, opportunityScore, buildoutOnly } from "./lib/opportunity.mjs";
import { forcedFlowSignal, reconcileWithTiming } from "./lib/forced-flow.mjs";
import { rebalanceBoth } from "./lib/sizing.mjs";
import { v23State, dislocationEntryWindow, compositeStress } from "./lib/v23.mjs";
import { supabaseConfigured, seriesToRows, upsertPriceHistory, sanitizePriceRows, dedupePriceRows, readSeries } from "./lib/supabase.mjs";
import { discoverProxies, rankProxies, proxyGraph } from "./lib/edgar-fts.mjs";

const OFFLINE = process.argv.includes("--offline");
const BACKFILL = process.argv.includes("--backfill"); // one-time deep history seed into Supabase
const read = (p) => JSON.parse(readFileSync(new URL(`../web/data/${p}`, import.meta.url)));
const v23LatestBars = []; // today's bars for the non-universe V2.3 tickers, collected during the cross-check
const V23_TICKERS = ["QQQ", "^VIX", "^VIX3M", "HYG", "QLD", "SGOV"]; // V2.3 cross-check + execution instruments

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
// (these tickers aren't in the universe, so this is how the DB stays fed for them via the top-off).
async function v23Series(ticker) {
  let s = null;
  try { s = await seriesFor(ticker, { liveRange: "2y", years: 6 }); } catch { /* may be unavailable */ }
  try {
    const q = await fetchYahoo(ticker); // light fetch; latest bar makes the cross-check current
    // P2 glitch guard: a single bad print on ^VIX/QQQ etc. must not flip the regime or poison history.
    if (q && q.price > 0 && q.asof && plausibleNextBar(q.price, s?.closes?.[s.closes.length - 1])) {
      if (!s) s = { ticker, dates: [], closes: [], src: "live" };
      if (s.dates[s.dates.length - 1] !== q.asof) { s.dates.push(q.asof); s.closes.push(q.price); }
      v23LatestBars.push({ ticker, d: q.asof, close: q.price, source: q.source || "yahoo" }); // fed to the single top-off
    } else if (q && q.price > 0 && q.asof) {
      console.log(`v23: rejected glitch bar ${ticker} ${q.price} (prev ${s?.closes?.[s.closes.length - 1]})`);
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

// deep-tech build-out sleeve only — the Opportunity Score / de-rating / forced-flow / opportunity-weighted sizing
// machinery models duration mispricing in the BUILD-OUT and must not rank or size diversifiers (the
// second axis earns its place by lowering drawdown, judged separately by the deep-tech build-out gate). Their
// tickers DO stay in the price/news universe below so the dashboard still tracks and reports them.
const buildoutScarcities = buildoutOnly(scarcities.scarcities);

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

// DB-FIRST TECHNICALS: when Supabase is configured, derive each ticker's technicals (200-DMA,
// 12m/1m momentum, vol, 52w-high, YTD) from the DEEP, adjusted, cross-checked DB series + today's
// already-corroborated price — instead of the live 1-year quote. Deep + consistent with the
// backtest basis. The live quote still provides today's PRICE (corroboration intact) and is the
// graceful FALLBACK when the DB lacks or is shallow on a ticker. Anti-synthetic: only real prints.
async function dbTechnicals(ticker, q) {
  if (!supabaseConfigured() || !q || q.error || !(q.price > 0)) return null;
  try {
    const s = await readSeries(ticker, { minDate: new Date(Date.now() - 2.2 * 365.25 * 86400000).toISOString().slice(0, 10) });
    if (!s) return null;
    const t = technicalsFromHistory(s, { date: q.asof || TODAY, price: q.price }, { currency: q.currency ?? null, source: "db+today" });
    return t ? { ...t, price: q.price } : null; // keep the corroborated price
  } catch { return null; }
}

const enriched = {};
let drops = [];
let _dbTech = 0;
for (const t of universe) {
  const q = quotes[t];
  if (q && !q.error) {
    const dbt = await dbTechnicals(t, q);
    // Merge DB technicals over the live quote (preserve price/asof/currency/source/corroboration/flags).
    const merged = dbt ? { ...q, ...dbt, price: q.price, asof: q.asof ?? dbt.asof, source: q.source, corroboration: q.corroboration, flags: q.flags, technicals_src: "db" } : q;
    if (dbt) _dbTech++;
    enriched[t] = { ...merged, crowding: crowding(merged) };
    // P7: a BAD-DATA quote (cross-source divergence / >35% jump) must not feed the drawdown trigger —
    // its pct_off_high may be wrong. The flag was previously cosmetic (recorded but still counted).
    const badData = merged.flags?.some((f) => /divergence|jump|consensus/.test(f));
    if (merged.pct_off_high != null && !badData) drops.push(merged.pct_off_high);
  } else {
    enriched[t] = q || { ticker: t, error: "no quote" };
    if (q?.error) errors.push(`${t}: ${q.error}`);
  }
}
if (!OFFLINE && supabaseConfigured()) console.log(`Technicals: ${_dbTech}/${Object.keys(enriched).length} from deep DB history (rest live)`);

// Data-quality summary across the universe (drives fail-safe trigger gating below). Pure + tested in
// marketdata.dataQualityGate: degraded trips on bad-data/anomaly or a corroboration-coverage COLLAPSE,
// not on a few legitimately-foreign single-source tickers (audit P3).
const data_quality = dataQualityGate(enriched, { offline: OFFLINE });
const degraded = data_quality.degraded;
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

// --- Trailing valuation (EDGAR XBRL + Tiingo, corroborated) for the per-name ENTRY read ("is it expensive?") ---
if (!OFFLINE) {
  const valTickers = portfolio.holdings.map((h) => h.ticker)
    .filter((t) => isTradeable(t) && securities[t]?.type !== "etf");
  try {
    const cikMap = await loadTickerMap().catch(() => ({}));
    let got = 0;
    for (const t of valTickers) {
      if (!enriched[t] || enriched[t].error) continue;
      const v = await getValuation(t, { cik: cikMap[t.toUpperCase()] || null, price: enriched[t].price, tiingoKey: process.env.TIINGO_API_KEY });
      if (v) { enriched[t].valuation = v; if (Number.isFinite(v.pe)) got++; }
      await new Promise((r) => setTimeout(r, 120)); // be polite to SEC/Tiingo
    }
    // Peer-median P/E across the resolved names → label each cheap/fair/rich relative to its peers.
    const pes = valTickers.map((t) => enriched[t]?.valuation?.pe).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    const peerMed = pes.length ? pes[Math.floor((pes.length - 1) / 2)] : null;
    for (const t of valTickers) {
      const v = enriched[t]?.valuation; if (!v?.pe) continue;
      const lab = valuationLabel(v, { peerMedianPe: peerMed }); v.tag = lab.tag; v.label = lab.label;
    }
    console.log(`Valuation: ${got}/${valTickers.length} P/E corroborated (peer median ${peerMed ?? "–"}x)`);
  } catch (e) { errors.push(`valuation: ${e.message}`); }
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
let attribution = null; // G1: factor attribution — is the basket return alpha or just factor/beta?
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
      // G1: regress the basket on tradeable factors — MARKET (SPY), MOMENTUM (MTUM), and crucially a
      // THEME proxy (QQQ). The intercept is residual alpha BEYOND market+momentum+theme exposure — the
      // test that can actually fail (without the theme leg, this deep-tech build-out book's beta would look like alpha).
      try {
        const fseries = {};
        for (const [nm, tk] of Object.entries({ MKT: "SPY", MOM: "MTUM", THEME: "QQQ" })) {
          try { const s = await seriesFor(tk, { liveRange: "2y", years: 3 }); if (s?.closes?.length > 60) fseries[nm] = { dates: s.dates, values: s.closes }; } catch { /* skip a missing factor */ }
        }
        if (Object.keys(fseries).length >= 2) {
          const aligned = alignByDate({ ASSET: { dates: idx.dates, values: idx.values }, ...fseries });
          if (aligned.dates.length > 80) {
            const facRet = {}; for (const nm of Object.keys(fseries)) facRet[nm] = returns(aligned.cols[nm]);
            const attr = factorAttribution(returns(aligned.cols.ASSET), facRet);
            if (attr) {
              attribution = { ...attr, window: `${aligned.dates[0]}..${aligned.dates[aligned.dates.length - 1]}`, factors: Object.keys(facRet), benchmark_qqq: aligned.cols.THEME ? benchmarkRelative(aligned.cols.ASSET, aligned.cols.THEME) : null };
              console.log(`Attribution: alpha ${(attr.alpha_annual * 100).toFixed(1)}%/yr (t=${attr.alpha_t}, R²=${attr.r2}, n=${attr.n}) → ${attr.verdict}`);
            }
          }
        }
      } catch (e) { errors.push(`attribution: ${e.message}`); }
    }
  } catch (e) { errors.push(`metrics: ${e.message}`); }
}

// --- G6: cross-sectional signal backtest on accumulated history (statistical power NOW, not in 5y) ---
// Does trailing relative strength predict FORWARD relative return across the scarcity baskets? Warehouse-
// gated (needs deep history for many tickers — cheap from Supabase, too heavy to live-fetch each scan).
// HONEST: current-membership universe → IC is an UPPER BOUND (survivorship); the live ledger is unbiased.
let signal_backtest = null;
if (!OFFLINE && supabaseConfigured()) {
  try {
    const groups = buildoutScarcities.map((s) => ({ id: s.id, tickers: (s.tickers || []).filter(isTradeable) })).filter((g) => g.tickers.length);
    const complexT = portfolio.holdings.filter((h) => securities[h.ticker]?.type === "etf").map((h) => h.ticker);
    const allTk = [...new Set([...groups.flatMap((g) => g.tickers), ...complexT])];
    const sbt = {};
    for (const t of allTk) { try { const s = await readSeries(t, { minDate: new Date(Date.now() - 8 * 365.25 * 86400000).toISOString().slice(0, 10) }); if (s?.closes?.length > 120) sbt[t] = { dates: s.dates, closes: s.closes }; } catch { /* skip */ } }
    signal_backtest = crossSectionalBacktest(sbt, groups, complexT, { lookback: 63, horizon: 42, step: 21 });
    if (signal_backtest) console.log(`Signal backtest: IC ${signal_backtest.ic}, hit-rate ${signal_backtest.hit_rate} over ${signal_backtest.n} pairs (UPPER BOUND — survivorship)`);
  } catch (e) { errors.push(`signal_backtest: ${e.message}`); }
}

// --- Macro-stress overlay inputs (free, keyless): VIX term-structure + HY credit velocity ---
let macro = null;
if (!OFFLINE) {
  try {
    const [vix, vix3m, hyg, vixSer, vix3mSer] = await Promise.all([
      fetchYahoo("^VIX").catch(() => null),
      fetchYahoo("^VIX3M").catch(() => null),
      fetchYahoo("HYG").catch(() => null),
      fetchSeries("^VIX", "1mo").catch(() => null),
      fetchSeries("^VIX3M", "1mo").catch(() => null),
    ]);
    // Helm #2: trailing VIX/VIX3M ratios (recency-aligned) for the 3-day term-structure persistence check.
    let termRatios = null;
    if (vixSer?.closes?.length && vix3mSer?.closes?.length) {
      const n = Math.min(vixSer.closes.length, vix3mSer.closes.length, 6);
      const a = vixSer.closes.slice(-n), b = vix3mSer.closes.slice(-n);
      termRatios = a.map((v, i) => (b[i] > 0 ? v / b[i] : 0));
    }
    const m = macroStress({ vix: vix?.price, vix3m: vix3m?.price, hygMom1m: hyg?.mom_1m, termRatios });
    // Helm #1: the brake needs ALL inputs. If ANY is missing it's SUPPRESSED — leave macro=null so the
    // regime marks the exit-only overlay UNAVAILABLE instead of silently showing "calm" (a missing VIX
    // would otherwise make the term-structure leg false → fake "calm"). Was: only caught BOTH missing.
    if (!m.available) errors.push(`macro: overlay suppressed — missing ${m.missing.join("/")} this run`);
    else { macro = m; console.log(`Macro: ${m.stressed ? "STRESSED" : "calm"} (vix_term ${m.vix_term}, hy_1m ${m.hy_mom_1m})`); }
  } catch (e) { errors.push(`macro: ${e.message}`); }
}

// --- Timing layer: trend/momentum/vol/drawdown + 20-DMA re-entry + macro overlay ---
const regime = computeRegime(enriched, portfolio.holdings, { macro, securities });
console.log(`Regime: ${regime.posture}${regime.risk_score != null ? ` (risk ${regime.risk_score}/100)` : ""}`);

// Regime instruments panel: QQQ (the regime's reference underlying) + TQQQ/SQQQ (the 3× long/short proxies)
// with full daily technicals incl RSI-14 — so the dashboard can show, daily, the signals the regime reads.
let regime_instruments = {};
if (!OFFLINE) {
  try {
    regime_instruments = await getQuotes(["QQQ", "TQQQ", "SQQQ"], { keys: providerKeys() });
    console.log(`Regime instruments: ${Object.values(regime_instruments).filter((q) => q && !q.error).length}/3 resolved (QQQ/TQQQ/SQQQ)`);
  } catch (e) { errors.push(`regime_instruments: ${e.message}`); }
}

// --- F4: append scarcity history + surface drift; F7: mark new filings/news ---
// P6: a corrupt append-only history file now THROWS (rather than silently wiping). Capture it so the
// scan continues (prices/regime/triggers still update) but the corrupt file is preserved + flagged.
let scarcity_drift = {}, newFilings = 0, newNews = 0;
try { ({ drift: scarcity_drift } = updateScarcityHistory(dataUrl("scarcity-history.json"), scarcities.scarcities, TODAY)); }
catch (e) { errors.push(`scarcity-history: ${e.message}`); }
try { ({ newFilings, newNews } = applySeenState(dataUrl("seen.state.json"), { filings, news, triggerStatus: trigger_status, today: TODAY })); }
catch (e) { errors.push(`seen-state: ${e.message}`); }
console.log(`History: ${Object.keys(scarcity_drift).length} scarcities drifted; ${newFilings} new filings, ${newNews} new headlines`);

// F6: regenerate the machine-readable DCA plan from the tier rules (deterministic).
writeDcaPlan(dataUrl("dca.json"), portfolio, TODAY);

// --- Alpha signal: per-scarcity relative strength vs the deep-tech build-out complex →
// de-rating (crowded rolling over) / inflecting (under-priced gaining) flags ---
// Mean live crowding per scarcity (price-derived priced-in proxy) → refines the Opportunity gate.
const crowdingById = {};
for (const s of scarcities.scarcities) {
  const cz = s.tickers.map((t) => enriched[t]?.crowding).filter((x) => typeof x === "number");
  crowdingById[s.id] = cz.length ? cz.reduce((a, b) => a + b, 0) / cz.length : null;
}
const scarcity_signals = {};
// C2: the "deep-tech build-out complex" 1-month momentum baseline — computed ONCE here and reused by both the
// de-rating/inflecting alpha signal (below) and the chokepoint-heat baseline, so the two references
// can't silently diverge (they were separately inlined before).
const complexMom = (() => {
  const moms = portfolio.holdings.filter((h) => securities[h.ticker]?.type === "etf")
    .map((h) => enriched[h.ticker]?.mom_1m).filter((x) => typeof x === "number");
  return moms.length ? moms.reduce((a, b) => a + b, 0) / moms.length : null;
})();
{
  for (const s of buildoutScarcities) {
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
const opportunities = rankOpportunities(buildoutScarcities, crowdingById);

// --- Forced-flow / neglect (ALPHA.md Edge 3): mechanical de-rating into an INTACT thesis =
// "buy what others are forced to sell"; into a weak thesis = broken (avoid). Read from the
// tape's footprint (no paid event feed needed) + a tax-loss-season overlay. ---
// Overlay composition (philosophy "alpha → timing → cash"): the forced-flow signal governs
// SELECTION (what to deploy into), the regime/macro overlay governs PACE (whether to deploy
// now). They must never contradict on screen — so when the timing overlay has the brakes on
// (defensive/caution or macro-stress), an "accumulate" is reframed as a deploy-on-the-trigger
// PRIORITY, not a buy-now instruction. This keeps the overlays one coherent system.
for (const s of buildoutScarcities) {
  const ff = forcedFlowSignal({ quotes: enriched, tickers: s.tickers, opportunity: scarcity_signals[s.id]?.score ?? null, today: TODAY });
  scarcity_signals[s.id].forced_flow = reconcileWithTiming(ff, regime);
}
const anyDislocation = Object.values(scarcity_signals).some((x) => x.forced_flow?.flag === "accumulate");
if (!OFFLINE) console.log(`Forced-flow: ${Object.values(scarcity_signals).filter((x) => x.forced_flow?.flag === "accumulate").length} thesis-intact dislocation(s) (accumulate)`);
// Per-name relative strength (de-rating −/inflecting +) → the entry read's relStrength leg.
const relByTicker = tickerRelStrength(scarcities.scarcities, scarcity_signals);
for (const t in relByTicker) if (enriched[t] && !enriched[t].error) enriched[t].rel_strength = relByTicker[t];

// CATALYST WATCH (F11): automate the MANUAL triggers from evidence (news + EDGAR FTS), judged by the
// committee, with an LLM-drafted advisory action on a confirmed fire. ADVISORY — never trades/edits the book.
let catalyst_watch = {};
if (!OFFLINE && llmAvailable()) {
  try {
    const callers = availableProviders().slice(0, 2).map((p) => seatCaller(p));
    const wByTicker = Object.fromEntries(portfolio.holdings.map((h) => [h.ticker, h.weight]));
    const primary = { mp_policy: "MP", leu_policy: "LEU", turbine_rollover: "GEV", memory_rollover: "MU", capex_upguides: "GEV" };
    const actionContext = {};
    for (const t of triggers.triggers) if (t.watch) actionContext[t.id] = { weightPct: wByTicker[primary[t.id]] ?? null, regime: regime.posture };
    catalyst_watch = await runCatalystWatch({ triggers: triggers.triggers, news, prevWatch: prevSig.catalyst_watch || {}, callers, searchFilings, actionContext, today: TODAY });
    alerts.catalyst_fired = Object.entries(catalyst_watch).filter(([, c]) => c.status === "fired").map(([k]) => k);
    alerts.catalyst_newly_fired = alerts.catalyst_fired.filter((k) => (prevSig.catalyst_watch?.[k]?.status !== "fired"));
    const elevated = Object.values(catalyst_watch).filter((c) => c.status !== "monitoring").length;
    console.log(`Catalyst watch: ${alerts.catalyst_fired.length} fired, ${elevated} elevated of ${Object.keys(catalyst_watch).length} manual triggers`);
  } catch (e) { errors.push(`catalyst: ${e.message}`); }
}
if (!OFFLINE) console.log(`Opportunity Score: top = ${opportunities.slice(0, 3).map((o) => `${o.id} ${o.score}`).join(", ")}`);

// --- G3: risk-aware target weights + an account-aware rebalance plan (analysis → allocation) ---
// Two columns: RESEARCH (your portfolio.json weights + a LIGHT ±15% inverse-vol tilt) and SIGNAL
// (also moved by the live Opportunity Score + regime tilt — so a committee "crowded" downgrade
// shrinks the weight HERE and surfaces a trim, closing the thesis→allocation link). Advisory: it
// never edits portfolio.json or trades (F9). Funding: IRA self-funds (trims pay for buys); a TAXABLE
// trim only ACTIONS above a higher bar (broken thesis or the cost-basis trim rule).
let rebalance = null;
try {
  const reHoldings = portfolio.holdings.filter((h) => isTradeable(h.ticker) && h.target_usd > 0);
  const vols = {};
  for (const h of reHoldings) { const v = enriched[h.ticker]?.vol_1y; if (Number.isFinite(v)) vols[h.ticker] = v; }
  // HIGH-3 (no momentum double-count): sizing uses the STATIC (thesis-only) Opportunity — human
  // priced_in label (static_gate) × quality × contrarian — NOT the blended `score`, whose live gate
  // folds in price-derived crowding (YTD + distance-to-52w-high). Momentum therefore enters the weight
  // exactly ONCE, via the regime TSMOM tilt. A committee "crowded" downgrade still lowers static_gate →
  // shrinks the weight, so the thesis→allocation link is preserved. Per ticker = best (max) across its
  // scarcities. (LOW-9: a ticker in no scarcity gets no entry → opportunityFactor defaults neutral 1.0.)
  const oppByTicker = {};
  for (const s of buildoutScarcities) {
    const ss = scarcity_signals[s.id];
    if (!ss || !Number.isFinite(ss.static_gate) || !Number.isFinite(ss.quality)) continue;
    const staticOpp = Math.min(100, 100 * ss.static_gate * ss.quality * (ss.contrarian ? 1.15 : 1));
    for (const t of s.tickers || []) if (!Number.isFinite(oppByTicker[t]) || staticOpp > oppByTicker[t]) oppByTicker[t] = staticOpp;
  }
  // Live $ per holding (USD) from the optional local positions; when present, sleeve totals follow
  // the actual market value so the plan rebalances what you hold (else it shows ideal vs the plan).
  const currentUsd = {};
  if (positions?.positions) {
    for (const h of reHoldings) {
      const p = positions.positions[h.ticker], q = enriched[h.ticker];
      if (p?.shares && q?.price) {
        const usd = toUsd(q.price * p.shares, q.currency || (securities[h.ticker]?.foreign ? "UNKNOWN" : "USD"), fxRates);
        if (usd != null) currentUsd[h.ticker] = usd;
      }
    }
  }
  const haveCur = Object.keys(currentUsd).length > 0;
  // Higher bar for a TAXABLE sell = the cost-basis trim rule ONLY (>2x cost AND >50x forward — a
  // deliberate valuation/profit-taking trim). A signal-derived "broken" flag is single-scan + tape-
  // driven and would authorize selling INTO a dislocation (inverting ALPHA.md Edge 3) with permanent
  // tax cost — so it does NOT qualify; signal-driven taxable sells need a human/committee decision.
  const taxableTrimOk = new Set(trimHits.map((t) => t.ticker));
  // HIGH-5: available dry powder per sleeve = DRY-tier (cash) holdings + any local cash_usd (treated as
  // taxable). Lets the plan flag "needs new cash" instead of implying taxable buys fund themselves.
  const cashBySleeve = {};
  for (const h of portfolio.holdings) {
    if (h.tier === "DRY" || /^CASH/i.test(h.ticker)) cashBySleeve[h.account] = (cashBySleeve[h.account] || 0) + (h.target_usd || 0);
  }
  if (typeof positions?.cash_usd === "number") cashBySleeve.taxable = (cashBySleeve.taxable || 0) + positions.cash_usd;
  rebalance = rebalanceBoth(reHoldings, {
    vols, perName: regime?.per_name || [], posture: regime?.posture, oppByTicker,
    currentUsd: haveCur ? currentUsd : undefined, cashBySleeve,
    taxableTrimOk: [...taxableTrimOk], riskCap: 0.15,
  });
  rebalance.basis = haveCur ? "live positions (positions.local.json)" : "static plan (portfolio.json targets)";
  rebalance.taxable_trim_ok = [...taxableTrimOk];
  rebalance.graded = false; // ADVISORY + UNGRADED: not yet scored by the forecast ledger (G3 follow-up). Do not auto-execute.
  if (!OFFLINE) console.log(`Rebalance(${rebalance.basis}): signal buys $${Math.round(rebalance.signal.summary.buy_usd / 1e3)}k / sells $${Math.round(rebalance.signal.summary.sell_usd / 1e3)}k` + (rebalance.signal.summary.blocked_trim_usd ? `, $${Math.round(rebalance.signal.summary.blocked_trim_usd / 1e3)}k anchor-trim blocked` : ""));
} catch (e) { errors.push(`rebalance: ${e.message}`); }

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
      try { const q = await fetchYahoo(t); if (q && q.price > 0 && q.asof) v23LatestBars.push({ ticker: t, d: q.asof, close: q.price, source: q.source || "yahoo" }); } catch { /* ignore */ }
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
  let store, forecastsCorrupt = false;
  try { store = JSON.parse(readFileSync(fpath)); }
  catch (e) {
    // P6: distinguish "first run / no file" (empty store is correct) from "file EXISTS but is corrupt"
    // — in the latter case do NOT silently reset to empty and overwrite, which permanently wipes the
    // scorecard track record (the "moat"). Preserve the committed file (skip the write) + fail loud.
    if (existsSync(fpath)) { forecastsCorrupt = true; errors.push(`forecasts.json corrupt — PRESERVED (not overwritten): ${e.message}`); }
    store = { schema_version: SCHEMA_VERSION, open: [], scorecard: updateScorecard(null, []) };
  }
  const { resolved, stillOpen } = resolveDue(store.open, enriched, TODAY);
  store.scorecard = updateScorecard(store.scorecard, resolved);
  // The deep-tech build-out "complex" = the diversified theme ETFs we hold; the de-rating/inflecting
  // alpha calls are graded RELATIVE to it (does the flagged basket really under/out-perform?).
  const complexTickers = portfolio.holdings
    .filter((h) => securities[h.ticker]?.type === "etf").map((h) => h.ticker);
  const fresh = [
    ...makeForecasts({ regime, quotes: enriched }, TODAY),
    ...makeScarcityForecasts(buildoutScarcities, { quotes: enriched, scarcity_signals }, TODAY, 42, complexTickers),
    ...makeSizingForecast(rebalance, enriched, TODAY), // CRITICAL-2: grade the G3 tilt vs the research baseline
  ];
  const openIds = new Set(stillOpen.map((f) => f.id));
  store.open = [...stillOpen, ...fresh.filter((f) => !openIds.has(f.id))];
  store.updated = TODAY;
  if (forecastsCorrupt) {
    console.log("Forecasts: store CORRUPT — preserved last committed version, skipped write (recover from git history).");
  } else {
    writeFileSync(fpath, JSON.stringify(store, null, 2) + "\n");
    console.log(`Forecasts: ${resolved.length} resolved, ${store.open.length} open, hit-rate ${store.scorecard.hit_rate}`);
  }
  // G1 follow-up: AUTO-RELABEL the alpha edge from this run's factor-attribution verdict, on a COPY so the
  // derived field never pollutes the persisted forecasts.json store. The scorecard's alpha edge now carries
  // the factor-adjusted verdict instead of needing a human to eyeball the attribution line next to it.
  scorecard = { ...store.scorecard, alpha_label: alphaEdgeLabel(attribution, store.scorecard?.by_signal) };
}
// CRITICAL-2: surface the tilt's accruing grade on the rebalance block (graded flips true once any
// sizing_tilt forecast has resolved over its horizon; until then it's recorded-but-not-yet-scored).
if (rebalance) {
  const tg = scorecard?.by_signal?.sizing_tilt || null;
  rebalance.graded = !!(tg && tg.n > 0);
  rebalance.tilt_grade = tg ? { n: tg.n, hits: tg.hits, hit_rate: tg.n ? +(tg.hits / tg.n).toFixed(3) : null } : null;
}

// --- Optional free-LLM analyst + red-team digest ---
let digest = "(no LLM key set — set GROQ_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in repo secrets to enable the agent digest)";
if (llmAvailable() && !OFFLINE) {
  try {
    const slim = buildoutScarcities.map((s) => ({ id: s.id, scarcity: s.scarcity, bind: s.bind_window, priced: s.priced_in, tickers: s.tickers }));
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
  catalyst_watch,
  alerts,
  regime,
  regime_instruments,
  metrics,
  attribution,
  signal_backtest,
  scorecard,
  scarcity_signals,
  opportunities,
  rebalance,
  v23,
  dislocation_entry,
  chokepoints,
  proxy_hubs,
  data_quality,
  scarcity_drift,
  digest,
  errors,
};

// --- THE SINGLE DAILY TOP-OFF: one place that writes to the DB. Everything else only READS.
// Gathers today's real bars from three sources already computed above — (1) the universe quotes
// (corroborated), (2) the non-universe V2.3 tickers' latest bars — plus, when --backfill is set,
// (3) the one-time deep reconciled history — then de-dupes, runs the anti-synthetic guard, and
// does ONE upsert. No-ops without the DB; non-fatal on error so the scan never breaks. ---
if (!OFFLINE && supabaseConfigured()) {
  try {
    const bars = [];
    // (1) Universe: each ticker's latest real bar (real `asof` date, cross-source-corroborated price).
    for (const [t, q] of Object.entries(enriched)) {
      if (q && !q.error && q.price > 0 && q.source) {
        const corroborated = (q.corroboration?.sources?.length || 0) >= 2;
        bars.push({ ticker: t, d: q.asof || TODAY, close: q.price, source: corroborated ? "consensus" : q.source });
      }
    }
    // (2) Non-universe V2.3 tickers (QQQ/^VIX/^VIX3M/HYG/QLD/SGOV) collected during the cross-check.
    bars.push(...v23LatestBars);
    // (3) One-time deep seed.
    if (BACKFILL) {
      const all = [...new Set([...universe, ...V23_TICKERS])];
      // Yahoo adjclose + Tiingo adjClose are the ADJUSTED corroborating pair; Stooq is a KEYLESS
      // fallback so rate-limiting can't zero a ticker (outvoted when the adjusted pair is present).
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
        for (const r of rows) bars.push({ ticker: r.ticker, d: r.d, close: r.close, source: r.source });
        if (rows.length) { tally.tickers++; tally.kept += stats.kept; tally.conflict += stats.dropped_conflict; tally.weekend += stats.dropped_weekend; tally.holiday += stats.dropped_holiday_fill; tally.jump += stats.dropped_jump; tally.single += stats.single_source; tally.corr += stats.corroborated; }
        console.log(`  ${t}: ${stats.kept} bars (${stats.corroborated} corroborated, ${stats.single_source} single)${rows.length ? ` ${rows[0].d}..${rows[rows.length - 1].d}` : ""}${stats.dropped_conflict + stats.dropped_weekend + stats.dropped_holiday_fill + stats.dropped_jump ? ` · dropped ${stats.dropped_conflict}conf/${stats.dropped_weekend}wknd/${stats.dropped_holiday_fill}hol/${stats.dropped_jump}jump` : ""}`);
      }
      console.log(`Backfill reconciliation: ${tally.tickers} tickers, ${tally.kept} bars kept (${tally.corr} corroborated, ${tally.single} single-source); dropped ${tally.conflict} conflict / ${tally.weekend} weekend / ${tally.holiday} holiday-fill / ${tally.jump} jump.`);
    }
    // Higher-trust bars first so de-dupe keeps them (consensus > single-source); then guard + ONE upsert.
    const ordered = bars.slice().sort((a, b) => (a.source === "consensus" ? 0 : 1) - (b.source === "consensus" ? 0 : 1));
    const dedup = dedupePriceRows(ordered);
    const clean = sanitizePriceRows(dedup);
    const dropped = dedup.length - clean.length;
    const { written, skipped } = await upsertPriceHistory(clean);
    console.log(`Top-off: ${skipped ? "skipped" : `wrote ${written}`} bars → DB (${dedup.length} candidates${dropped ? `, ${dropped} dropped by anti-synthetic guard` : ""})`);
  } catch (e) { errors.push(`top-off: ${e.message}`); console.error(`Top-off failed (non-fatal): ${e.message}`); }
} else if (!OFFLINE) {
  console.log("Top-off: Supabase not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY to persist history)");
}

// Validate our own output before writing — never commit a malformed signals.json.
assertValid("generated signals.json", validateSignals(out));

writeFileSync(new URL("../web/data/signals.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote signals.json — ${Object.values(enriched).filter((q) => q && !q.error).length}/${universe.length} quotes OK, ${errors.length} errors, drawdown fired=${drawdownFired}`);
