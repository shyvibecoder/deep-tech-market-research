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

// Pure: cross-check a {sourceName: price} map → median + spread + ok flag. Testable.
export function corroborate(prices, divergence = DIVERGENCE) {
  const names = Object.keys(prices).filter((n) => num(prices[n]) != null);
  if (!names.length) return null;
  const vals = names.map((n) => prices[n]).sort((a, b) => a - b);
  const median = vals[Math.floor((vals.length - 1) / 2)];
  const spread = (Math.max(...vals) - Math.min(...vals)) / median;
  return { sources: names, n: names.length, median, spread: +spread.toFixed(4), ok: names.length < 2 ? null : spread <= divergence };
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
  const base = rich?.price ? rich : { ticker, price: corroboration.median, source: corroboration.sources[0], asof: null };
  const flags = [];
  if (corroboration.ok === false) flags.push(`source divergence ${(corroboration.spread * 100).toFixed(1)}% (${corroboration.sources.join("/")})`);
  if (base.asof) { const age = (Date.now() - Date.parse(base.asof)) / 86400000; if (age > STALE_DAYS) flags.push(`stale last bar ${base.asof}`); }
  return { ...base, corroboration, ...(flags.length ? { flags } : {}) };
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
