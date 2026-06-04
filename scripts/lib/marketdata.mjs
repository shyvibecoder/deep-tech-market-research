// Multi-source market data with cross-source corroboration + plausibility guards.
// Keyless primary: Yahoo (rich history → technicals) + Stooq (EOD validator).
// Optional FREE-KEY corroborators (env or passed in): Finnhub, Twelve Data, Alpha
// Vantage. We don't just *fallback* — when ≥2 sources return, we CROSS-CHECK the
// price and flag divergence, so a single bad/synthetic print can't pass silently.
//
// Free-tier discipline: keyless sources run for the whole universe; rate-limited
// keyed sources run only for a bounded set (holdings) to stay within free quotas.

import { fetchYahoo, fetchStooq, isTradeable } from "./quotes.mjs";

export { isTradeable };

export const num = (x) => { const n = parseFloat(x); return isFinite(n) && n > 0 ? n : null; };
const t = (ms) => AbortSignal.timeout(ms);

const DIVERGENCE = 0.03;     // >3% spread across sources = corroboration warning

const trueMedian = (sorted) => {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

// Pure: cross-check a {sourceName: price} map. Computes a TRUE median, the overall
// spread/ok flag, AND a consensus `used` price that EXCLUDES outliers (>divergence
// from the median) — so a lone bad/synthetic print is dropped, not just flagged.
export function corroborate(prices, divergence = DIVERGENCE) {
  const names = Object.keys(prices).filter((n) => num(prices[n]) != null);
  if (!names.length) return null;
  const vals = names.map((n) => prices[n]).sort((a, b) => a - b);
  const median = trueMedian(vals);
  const spread = median ? (vals[vals.length - 1] - vals[0]) / median : Infinity;
  const kept = vals.filter((v) => median && Math.abs(v / median - 1) <= divergence);
  // `used` must be a REAL observed price, never a fabricated midpoint. With exactly 2 divergent sources
  // the median IS their mean (a price that exists nowhere) and exclusion empties `kept` — so fall back to
  // the PRIMARY source's actual print (names[0] = Yahoo when present) and let getQuote's C2 swap decide
  // which to trust. (Audit M1: averaging a good+bad print 50/50 was silently poisoning `used`.)
  const used = kept.length ? +(kept.reduce((a, b) => a + b, 0) / kept.length).toFixed(4) : +(+prices[names[0]]).toFixed(4);
  return { sources: names, n: names.length, median: +median.toFixed(4), used, spread: +spread.toFixed(4), ok: names.length < 2 ? null : spread <= divergence };
}

// --- Keyed price-only providers (best-effort; return null on any failure) ---
async function finnhub(sym, key) {
  try { const j = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`, { signal: t(8000) })).json(); return num(j?.c); }
  catch { return null; }
}
async function twelvedata(sym, key) {
  try { const j = await (await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(sym)}&apikey=${key}`, { signal: t(8000) })).json(); return num(j?.price); }
  catch { return null; }
}
async function alphavantage(sym, key) {
  try { const j = await (await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${key}`, { signal: t(8000) })).json(); return num(j?.["Global Quote"]?.["05. price"]); }
  catch { return null; }
}

export function providerKeys(env = process.env) {
  return { finnhub: env.FINNHUB_API_KEY || null, twelvedata: env.TWELVE_DATA_API_KEY || null, alphavantage: env.ALPHAVANTAGE_API_KEY || null };
}

const STALE_DAYS = 6;        // a quote whose last bar is older than this is flagged

// One ticker: rich Yahoo quote + cross-checked price across all available sources.
export async function getQuote(ticker, { keys = {}, useKeyed = false } = {}) {
  if (!isTradeable(ticker)) return null;
  const usSymbol = !/[.]/.test(ticker); // keyed providers/US symbols only for un-suffixed tickers
  let rich = null;
  try { rich = await fetchYahoo(ticker); } catch { /* try others for at least a price */ }

  // Gather independent prices (name -> price). Yahoo is the rich/preferred source.
  const prices = {};
  if (rich?.price) prices.yahoo = rich.price;
  try { const s = await fetchStooq(ticker); if (num(s.price)) prices.stooq = s.price; } catch { /* ignore */ }
  if (useKeyed && usSymbol) {
    if (keys.finnhub) { const p = await finnhub(ticker, keys.finnhub); if (p) prices.finnhub = p; }
    if (keys.twelvedata) { const p = await twelvedata(ticker, keys.twelvedata); if (p) prices.twelvedata = p; }
    if (keys.alphavantage) { const p = await alphavantage(ticker, keys.alphavantage); if (p) prices.alphavantage = p; }
  }

  const corroboration = corroborate(prices);
  if (!corroboration) return rich?.error ? rich : { ticker, error: "no quote from any source" };

  // Prefer the rich Yahoo quote (keeps technicals); if Yahoo missing, build a minimal one.
  let base = rich?.price ? rich : { ticker, price: corroboration.used, source: corroboration.sources[0], asof: null, currency: rich?.currency ?? null };
  const flags = [];
  if (corroboration.ok === false) {
    flags.push(`source divergence ${(corroboration.spread * 100).toFixed(1)}% (${corroboration.sources.join("/")})`);
    // If the published (Yahoo) price is itself the outlier, replace it with the
    // cross-source consensus so a poisoned print can't drive triggers (red-team C2).
    if (Math.abs(base.price / corroboration.used - 1) > DIVERGENCE) {
      flags.push(`price ${base.price} → cross-source consensus ${corroboration.used}`);
      base = { ...base, price: corroboration.used };
    }
  }
  flags.push(...integrityFlags(corroboration, base.asof));
  return { ...base, corroboration, ...(flags.length ? { flags } : {}) };
}

// Per-quote integrity flags (pure, testable). Audit P1/P3: a SINGLE-SOURCE quote (corroboration.ok ===
// null — no cross-check possible) was passing unflagged, invisible to data_quality and the trigger
// path. Foreign tickers are *legitimately* single-source, so this flags per-ticker — it does NOT mark
// the run degraded. Stooq-only quotes now carry `asof` (parseStooqQuote maps Stooq's dated bar), so they
// get the real staleness check; a quote with no dated bar at all still falls back to "freshness unknown".
export function integrityFlags(corroboration, asof, { staleDays = STALE_DAYS, now = Date.now() } = {}) {
  const flags = [];
  if (corroboration?.ok === null) flags.push(`single-source (${corroboration.sources?.[0] || "?"}) — uncorroborated`);
  if (!asof) flags.push("freshness unknown (no dated bar)");
  else { const age = (now - Date.parse(asof)) / 86400000; if (age > staleDays) flags.push(`stale last bar ${asof}`); }
  return flags;
}

// Glitch guard for an appended time-series bar (audit P2 — V2.3 macro-brake instruments fetched with
// no anomaly check could flip the regime on a bad print). Rejects a non-finite/≤0 price or a clear
// data glitch (>5x or <0.2x the prior close); a legitimately-sharp but real move (e.g. a +44% VIX day)
// passes. Pure. Accepts when there is no usable prior close (first bar).
export function plausibleNextBar(price, prevClose, { maxRatio = 5 } = {}) {
  if (!(Number.isFinite(price) && price > 0)) return false;
  if (!(Number.isFinite(prevClose) && prevClose > 0)) return true;
  const r = price / prevClose;
  return r <= maxRatio && r >= 1 / maxRatio;
}

// Pure data-quality gate (audit P3). `degraded` (which HOLDS auto-triggers) trips on: a high error
// rate, a high BAD-DATA rate (divergence/anomaly — quotes that are actually wrong), OR a corroboration-
// coverage COLLAPSE (most quotes single-source, e.g. Stooq fully down — the cross-check infra is down).
// It deliberately does NOT trip on a handful of legitimately-foreign single-source tickers, which would
// over-hold triggers. Single-source quotes are surfaced separately (uncorroborated count).
export function dataQualityGate(quotes, { offline = false } = {}) {
  const vals = Object.values(quotes || {});
  const nOk = vals.filter((q) => q && !q.error).length;
  const nErr = vals.filter((q) => q && q.error).length;
  const nFlagged = vals.filter((q) => q && q.flags?.length).length;
  const nBadData = vals.filter((q) => q?.flags?.some((f) => /divergence|jump|consensus/.test(f))).length;
  const corr = vals.filter((q) => q?.corroboration);
  const nCorrob = corr.filter((q) => q.corroboration.ok === true).length;
  const nUncorrob = corr.filter((q) => q.corroboration.ok === null).length;
  const errRate = vals.length ? nErr / vals.length : 1;
  const corrobRate = corr.length ? nCorrob / corr.length : 0;
  // Corroboration-COLLAPSE: most quotes lost their cross-check (e.g. Stooq fully down → single-source
  // everywhere). Threshold lowered 5→3 (audit M2) so a small universe that goes uncorroborated still
  // trips degraded instead of firing auto-triggers off a wholly uncorroborated tape.
  const degraded = offline || errRate > 0.3 || (nOk > 0 && nBadData / nOk > 0.25) || (corr.length >= 3 && corrobRate < 0.5);
  return {
    ok: !degraded, degraded, ok_quotes: nOk, errored: nErr, flagged: nFlagged, bad_data: nBadData,
    uncorroborated: nUncorrob, corroborated: nCorrob, corroborated_of: corr.length,
    note: degraded ? "degraded — auto-triggers held this run"
      : `${nOk} ok, ${nFlagged} flagged (${nUncorrob} single-source), ${nCorrob}/${corr.length} cross-source-corroborated`,
  };
}

export async function getQuotes(tickers, { keys = {}, holdings = [] } = {}) {
  const hold = new Set(holdings);
  const out = {};
  for (const ticker of tickers) {
    out[ticker] = await getQuote(ticker, { keys, useKeyed: hold.has(ticker) });
    await new Promise((r) => setTimeout(r, 150)); // polite to free endpoints
  }
  return out;
}
