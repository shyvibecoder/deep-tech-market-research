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
  if (!isFinite(price)) throw new Error(`bad close: ${close}`);
  return { ticker, price, date, source: "stooq" };
}

export async function fetchYahoo(ticker) {
  // 1y daily history -> price + 52w high + YTD return.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const closes = (res?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const ts = res?.timestamp || [];
  if (!closes.length) throw new Error("no closes");
  const price = closes[closes.length - 1];
  const high52 = Math.max(...closes);
  // YTD: first close on/after Jan 1 of current year
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
  let ytdBase = closes[0];
  for (let i = 0; i < ts.length; i++) { if (ts[i] >= yearStart) { ytdBase = closes[i]; break; } }
  return {
    ticker, price, high52,
    pct_off_high: high52 ? (price - high52) / high52 : null,
    ytd: ytdBase ? (price - ytdBase) / ytdBase : null,
    source: "yahoo",
  };
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
