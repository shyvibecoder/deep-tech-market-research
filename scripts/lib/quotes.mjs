// Free quote fetchers with graceful fallback. No API key required.
// Primary: Stooq CSV. Fallback: Yahoo Finance chart API. Both are keyless and free.
// Runs in GitHub Actions (open network). In a restricted sandbox, fetches fail and
// the scanner degrades gracefully (errors recorded, prior signals preserved).

// A ticker is tradeable if it isn't a placeholder like "(private: ...)" or cash.
// Shared by the scanner's universe filter and the CI selfcheck so they stay in sync.
export const isTradeable = (t) => !!t && !/[()]/.test(t) && !/^CASH/i.test(t);

const stooqSymbol = (t) => {
  // US tickers -> ".us"; keep exchange-suffixed (e.g. PRY.MI, 6324.T) as-is lowercased.
  if (/[.]/.test(t)) return t.toLowerCase();
  return `${t.toLowerCase()}.us`;
};

export async function fetchStooq(ticker) {
  const url = `https://stooq.com/q/l/?s=${stooqSymbol(ticker)}&f=sd2t2ohlcv&h&e=csv`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const txt = (await r.text()).trim();
  const [, row] = txt.split("\n");
  if (!row) throw new Error("no data");
  const [sym, date, time, open, high, low, close, vol] = row.split(",");
  const price = parseFloat(close);
  if (!isFinite(price) || !(price > 0)) throw new Error(`bad close: ${close}`);
  return { ticker, price, date, source: "stooq", currency: null }; // currency unknown from Stooq
}

const sma = (arr, n) => (arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null);
// Annualized realized volatility from daily log returns over the last n sessions.
const realizedVol = (closes, n) => {
  const c = closes.slice(-(n + 1));
  if (c.length < 20) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252);
};

export async function fetchYahoo(ticker) {
  // 1y daily history -> price + 52w high + YTD + moving averages + currency.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const closes = (res?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const ts = res?.timestamp || [];
  if (!closes.length) throw new Error("no closes");
  const price = closes[closes.length - 1];
  if (!(price > 0) || !isFinite(price)) throw new Error(`implausible price: ${price}`); // plausibility guard
  const high52 = Math.max(...closes);
  const asof = ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : null;
  // YTD: first close on/after Jan 1 of current year
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
  let ytdBase = closes[0];
  for (let i = 0; i < ts.length; i++) { if (ts[i] >= yearStart) { ytdBase = closes[i]; break; } }
  // Technicals (literature-grounded; see REGIME.md): 200-DMA trend filter (Faber 2007),
  // 12-month absolute/time-series momentum (Moskowitz-Ooi-Pedersen 2012), and realized
  // volatility for vol-state scaling (Moreira-Muir 2017).
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const ma20 = sma(closes, 20);
  const mom_12m = closes.length >= 200 ? price / closes[0] - 1 : null; // ~1y total return
  const mom_1m = closes.length >= 22 ? price / closes[closes.length - 22] - 1 : null; // ~21 sessions (fast)
  return {
    ticker, price, high52,
    pct_off_high: high52 ? (price - high52) / high52 : null,
    ytd: ytdBase ? (price - ytdBase) / ytdBase : null,
    ma50, ma200, ma20,
    pct_vs_ma50: ma50 ? (price - ma50) / ma50 : null,
    pct_vs_ma200: ma200 ? (price - ma200) / ma200 : null,
    above_ma200: ma200 != null ? price >= ma200 : null,
    above_ma20: ma20 != null ? price >= ma20 : null,
    asof,
    mom_12m, mom_1m,
    vol_3m: realizedVol(closes, 63),
    vol_1y: realizedVol(closes, 252),
    currency: res?.meta?.currency || null,
    source: "yahoo",
  };
}

// Aligned daily close series (date,close) for building a basket index. Throws on thin data.
export async function fetchSeries(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  const res = (await r.json())?.chart?.result?.[0];
  const closes = res?.indicators?.quote?.[0]?.close || [];
  const ts = res?.timestamp || [];
  const dates = [], cl = [];
  for (let i = 0; i < ts.length; i++) if (closes[i] != null && closes[i] > 0) { dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10)); cl.push(closes[i]); }
  if (cl.length < 30) throw new Error("insufficient series");
  return { ticker, dates, closes: cl };
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
