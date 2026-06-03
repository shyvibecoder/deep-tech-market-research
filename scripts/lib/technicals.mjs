// Pure technicals from a daily (dates, closes) series — the literature-grounded inputs to the
// regime/radar layer: 200-DMA trend (Faber 2007), 12-month momentum (Moskowitz-Ooi-Pedersen 2012),
// realized vol for vol-state (Moreira-Muir 2017), plus 52w high / YTD / crowding inputs.
//
// CRITICAL: every long-horizon field is WINDOWED to a fixed number of trailing sessions, so it is
// correct whether the input is a 1-year quote OR a multi-decade DB series. (A naive max()/closes[0]
// over a deep series would use an all-time high / a 1990s base — wrong.) Same numbers as the old
// 1-year fetch when given ~1 year; correct when given more. No network, no throw.

const SESSIONS_1Y = 252;
const SESSIONS_1M = 22;

const sma = (a, n) => (a.length >= n ? a.slice(-n).reduce((x, y) => x + y, 0) / n : null);

// Wilder's RSI over `period` (default 14): seed avg gain/loss with the first `period` changes, then
// Wilder-smooth through the rest. Returns 0..100, or null without enough history. Pure.
export function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  if (!closes.every(Number.isFinite)) return null; // a non-finite close anywhere → don't emit a subtly-wrong RSI
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgL === 0) return 100;            // no losses → maximally overbought
  const rs = avgG / avgL;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

// Annualized realized vol from the last n daily log-returns.
function realizedVol(closes, n) {
  const c = closes.slice(-(n + 1));
  if (c.length < 20) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252);
}

// Read-side helper: combine a deep DB series with TODAY's (already-corroborated) price, then
// compute windowed technicals. Appends today only if it's newer than the series' last bar (so a
// same-day re-run is idempotent and a stale DB can't override today). Returns null if there isn't
// enough history to be meaningful (caller keeps the live-fetched technicals). Pure.
export function technicalsFromHistory(series, today, opts = {}) {
  if (!series || !Array.isArray(series.closes) || !(today?.price > 0) || !today?.date) return null;
  const dates = series.dates.slice(), closes = series.closes.slice();
  const last = dates[dates.length - 1];
  if (last !== today.date) {
    if (last && today.date < last) return null; // today older than the series tail → don't corrupt
    dates.push(today.date); closes.push(today.price);
  } else {
    closes[closes.length - 1] = today.price; // refresh today's bar with the corroborated price
  }
  if (closes.length < 60) return null; // too shallow → let the live path handle it
  return computeTechnicals(dates, closes, opts);
}

export function computeTechnicals(dates, closes, { currency = null, source = "db" } = {}) {
  const empty = {
    price: null, high52: null, pct_off_high: null, ytd: null, ma50: null, ma200: null, ma20: null,
    pct_vs_ma50: null, pct_vs_ma200: null, above_ma200: null, above_ma20: null, asof: null,
    mom_12m: null, mom_1m: null, rsi_14: null, rsi_10: null, vol_3m: null, vol_1y: null, currency, source,
  };
  if (!Array.isArray(closes) || !closes.length) return empty;
  const price = closes[closes.length - 1];
  if (!(price > 0) || !isFinite(price)) return empty;
  const asof = dates?.[dates.length - 1] ?? null;

  // 52-week high over the TRAILING year (not all-time).
  const win1y = closes.slice(-SESSIONS_1Y);
  const high52 = Math.max(...win1y);

  // YTD: first close on/after Jan 1 of the latest bar's year (date-based, robust to deep history).
  let ytdBase = closes[0];
  if (asof && Array.isArray(dates)) {
    const jan1 = `${asof.slice(0, 4)}-01-01`;
    const i = dates.findIndex((d) => d >= jan1);
    if (i >= 0) ytdBase = closes[i];
  }

  const ma50 = sma(closes, 50), ma200 = sma(closes, 200), ma20 = sma(closes, 20);
  // 12-month momentum: price vs ~252 sessions ago (windowed), null if not enough history.
  const mom_12m = closes.length > SESSIONS_1Y ? price / closes[closes.length - 1 - SESSIONS_1Y] - 1 : null;
  const mom_1m = closes.length > SESSIONS_1M ? price / closes[closes.length - 1 - SESSIONS_1M] - 1 : null;

  return {
    price, high52,
    pct_off_high: high52 ? (price - high52) / high52 : null,
    ytd: ytdBase ? (price - ytdBase) / ytdBase : null,
    ma50, ma200, ma20,
    pct_vs_ma50: ma50 ? (price - ma50) / ma50 : null,
    pct_vs_ma200: ma200 ? (price - ma200) / ma200 : null,
    above_ma200: ma200 != null ? price >= ma200 : null,
    above_ma20: ma20 != null ? price >= ma20 : null,
    asof, mom_12m, mom_1m, rsi_14: rsi(closes, 14), rsi_10: rsi(closes, 10),
    vol_3m: realizedVol(closes, 63), vol_1y: realizedVol(closes, 252),
    currency, source,
  };
}
