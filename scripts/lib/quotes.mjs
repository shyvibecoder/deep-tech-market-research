// Free quote fetchers with graceful fallback. No API key required.
// Primary: Stooq CSV. Fallback: Yahoo Finance chart API. Both are keyless and free.
// Runs in GitHub Actions (open network). In a restricted sandbox, fetches fail and
// the scanner degrades gracefully (errors recorded, prior signals preserved).
import { computeTechnicals } from "./technicals.mjs";

// A ticker is tradeable if it isn't a placeholder like "(private: ...)" or cash.
// Shared by the scanner's universe filter and the CI selfcheck so they stay in sync.
export const isTradeable = (t) => !!t && !/[()]/.test(t) && !/^CASH/i.test(t);

const stooqSymbol = (t) => {
  if (/^\^/.test(t)) return t.toLowerCase();        // index like ^VIX -> ^vix (no .us suffix)
  // US tickers -> ".us"; keep exchange-suffixed (e.g. PRY.MI, 6324.T) as-is lowercased.
  if (/[.]/.test(t)) return t.toLowerCase();
  return `${t.toLowerCase()}.us`;
};

// Yahoo symbol overrides: the app keeps the human-facing ticker, but some names need their
// exchange-qualified Yahoo symbol to resolve (TSX/ASX, dual-class units). Easily extended.
const YAHOO_OVERRIDES = {
  IVN: "IVN.TO",      // Ivanhoe Mines (Toronto)
  LYC: "LYC.AX",      // Lynas Rare Earths (ASX)
  "U.UN": "U-UN.TO",  // Sprott Physical Uranium Trust units (Toronto; Yahoo uses "-" + .TO)
};
export const yahooSymbol = (t) => YAHOO_OVERRIDES[t] || t;

// Parse one Stooq `l/` CSV quote row (header sd2t2ohlcv) -> { ticker, price, asof, source }.
// Pure + testable, mirroring parseStooqHistory. Maps Stooq's dated bar to `asof` so a Stooq-only
// quote gets the SAME staleness check as a Yahoo one (Stooq d2 is YYYY-MM-DD; guard junk like "N/D").
export function parseStooqQuote(ticker, csv) {
  const [, row] = String(csv || "").trim().split("\n");
  if (!row) throw new Error("no data");
  const [, date, , , , , close] = row.split(","); // sym, date, time, open, high, low, close, vol
  const price = parseFloat(close);
  if (!isFinite(price) || !(price > 0)) throw new Error(`bad close: ${close}`);
  const asof = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null; // real dated bar -> staleness-checkable
  return { ticker, price, asof, source: "stooq", currency: null }; // currency unknown from Stooq
}

export async function fetchStooq(ticker) {
  const url = `https://stooq.com/q/l/?s=${stooqSymbol(ticker)}&f=sd2t2ohlcv&h&e=csv`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  return parseStooqQuote(ticker, await r.text());
}

// Full DAILY history from Stooq (keyless) — a second deep source for the price-history backfill,
// so we don't depend solely on Yahoo's range=max. Pure parser + thin fetcher.
export function parseStooqHistory(ticker, csv) {
  const lines = String(csv || "").trim().split("\n");
  if (lines.length < 2 || !/date.*close/i.test(lines[0])) return { ticker, dates: [], closes: [] };
  const dates = [], closes = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const d = cols[0], close = parseFloat(cols[4]); // Date,Open,High,Low,Close,Volume
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(close) && close > 0) { dates.push(d); closes.push(close); }
  }
  return { ticker, dates, closes };
}

export async function fetchStooqHistory(ticker) {
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol(ticker)}&i=d`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const out = parseStooqHistory(ticker, await r.text());
  if (!out.closes.length) throw new Error("no stooq history");
  if (!isDailySeries(out.dates)) throw new Error("stooq returned non-daily — rejected");
  return out;
}

// Tiingo daily history (deep, decades; free key). Uses splitAdjusted close ('adjClose' when
// present, else 'close'). Pure parser + thin fetcher. Key from env TIINGO_API_KEY.
export function parseTiingoHistory(ticker, json) {
  if (!Array.isArray(json)) return { ticker, dates: [], closes: [] };
  const dates = [], closes = [];
  for (const row of json) {
    const d = typeof row?.date === "string" ? row.date.slice(0, 10) : null;
    const close = Number(row?.adjClose ?? row?.close);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(close) && close > 0) { dates.push(d); closes.push(close); }
  }
  return { ticker, dates, closes };
}

export async function fetchTiingoHistory(ticker, { key = process.env.TIINGO_API_KEY, start = "1995-01-01" } = {}) {
  if (!key) throw new Error("no tiingo key");
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${start}&token=${key}`;
  const r = await fetch(url, { headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`tiingo ${r.status}`);
  const out = parseTiingoHistory(ticker, await r.json());
  if (!out.closes.length) throw new Error("no tiingo history");
  return out;
}

export async function fetchYahoo(ticker) {
  // 1y daily history -> price + 52w high + YTD + moving averages + currency. Technicals are
  // computed by the shared (windowed, unit-tested) computeTechnicals so the live and DB paths
  // are identical math (see technicals.mjs / REGIME.md for the literature grounding).
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker))}?range=1y&interval=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const rawCloses = res?.indicators?.quote?.[0]?.close || [];
  const dates = [], closes = [];
  for (let i = 0; i < rawCloses.length; i++) if (rawCloses[i] != null) { dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); closes.push(rawCloses[i]); }
  if (!closes.length) throw new Error("no closes");
  const price = closes[closes.length - 1];
  if (!(price > 0) || !isFinite(price)) throw new Error(`implausible price: ${price}`); // plausibility guard
  const t = computeTechnicals(dates, closes, { currency: res?.meta?.currency || null, source: "yahoo" });
  return { ticker, ...t };
}

// Aligned daily ADJUSTED close series (date,close) for backtests / the price-history DB.
// Uses split+dividend-adjusted closes (Yahoo `adjclose`) so the series is internally consistent
// and corroborates with other adjusted providers (Tiingo adjClose) — raw closes have split jumps
// that look like crashes and won't agree across sources. Retries on rate-limit; rejects non-daily.
export async function fetchSeries(ticker, range = "1y") {
  const sym = yahooSymbol(ticker);
  // For deep ranges Yahoo sometimes returns MONTHLY bars (esp. indices like ^VIX). If the result
  // isn't daily, fall back to daily-capable ranges so we still get a daily series.
  const ranges = range === "max" ? ["max", "10y", "5y"] : [range];
  let lastErr = null;
  for (const rng of ranges) {
    try {
      const res = await yahooChart(sym, rng);
      const raw = res?.indicators?.quote?.[0]?.close || [];
      const adj = res?.indicators?.adjclose?.[0]?.adjclose || [];
      const closes = (adj.length === raw.length && adj.some((x) => x != null)) ? adj : raw; // prefer adjusted
      const ts = res?.timestamp || [];
      const dates = [], cl = [];
      for (let i = 0; i < ts.length; i++) if (closes[i] != null && closes[i] > 0) { dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); cl.push(closes[i]); }
      if (cl.length < 30) throw new Error("insufficient series");
      if (!isDailySeries(dates)) throw new Error(`non-daily (${rng})`);
      return { ticker, dates, closes: cl };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no series");
}

// One Yahoo chart fetch with transient-error (429/5xx/timeout) retry + backoff.
async function yahooChart(sym, range) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${encodeURIComponent(range)}&interval=1d`;
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`yahoo ${r.status}`);
      const res = (await r.json())?.chart?.result?.[0];
      if (!res) throw new Error("no chart result");
      return res;
    } catch (e) { lastErr = e; if (attempt < 2) await new Promise((s) => setTimeout(s, 700 * (attempt + 1) * (attempt + 1))); }
  }
  throw lastErr;
}

// Guard against a provider returning monthly/weekly bars where we need daily: the median gap
// between consecutive sessions in a real daily series is ~1 day (≤4 incl. long weekends/holidays).
export function isDailySeries(dates) {
  if (!Array.isArray(dates) || dates.length < 10) return false;
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] <= 4; // median gap; monthly ≈ 30, weekly ≈ 7
}

// Try Yahoo (richer) first, then Stooq (price only). Returns null on total failure.
export async function getQuote(ticker) {
  // skip non-tradeable placeholders like "(private: ...)" or cash
  if (!isTradeable(ticker)) return null;
  try { return await fetchYahoo(ticker); }
  catch (e1) {
    try { const q = await fetchStooq(ticker); return { ...q, pct_off_high: null, ytd: null }; }
    catch (e2) { return { ticker, error: `${e1.message} | ${e2.message}` }; }
  }
}

export async function getQuotes(tickers) {
  const out = {};
  for (const t of tickers) {
    out[t] = await getQuote(t);
    await new Promise((r) => setTimeout(r, 150)); // be polite to free endpoints
  }
  return out;
}
