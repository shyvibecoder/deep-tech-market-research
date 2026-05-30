// Portfolio performance/risk metrics — the objective function made measurable:
// maximize 10-yr return, keep max drawdown < 35%, best Calmar & Sortino.
// Pure ESM (browser + Node). Inputs are value series (e.g., a target-weighted basket
// index or the user's sleeve value over time).

export function returns(values) {
  const r = [];
  for (let i = 1; i < values.length; i++) if (values[i - 1] > 0) r.push(values[i] / values[i - 1] - 1);
  return r;
}

export function maxDrawdown(values) {
  let peak = -Infinity, mdd = 0;
  for (const v of values) { if (v > peak) peak = v; if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak); }
  return mdd;
}

// CAGR from a value series sampled at `periodsPerYear` (e.g. 252 daily).
export function cagr(values, periodsPerYear = 252) {
  if (values.length < 2 || !(values[0] > 0)) return null;
  const years = (values.length - 1) / periodsPerYear;
  if (years <= 0) return null;
  return Math.pow(values[values.length - 1] / values[0], 1 / years) - 1;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function annualVol(rets, periodsPerYear = 252) {
  if (rets.length < 2) return null;
  const m = mean(rets);
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(periodsPerYear);
}

// Downside deviation: RMS of min(0, r-mar) over ALL periods, annualized.
export function downsideDeviation(rets, periodsPerYear = 252, mar = 0) {
  if (!rets.length) return null;
  const dd = rets.reduce((a, r) => a + Math.min(0, r - mar) ** 2, 0) / rets.length;
  return Math.sqrt(dd) * Math.sqrt(periodsPerYear);
}

export function sharpe(rets, periodsPerYear = 252, rf = 0) {
  const vol = annualVol(rets, periodsPerYear);
  if (!vol) return null;
  return (mean(rets) * periodsPerYear - rf) / vol;
}

export function sortino(rets, periodsPerYear = 252, mar = 0) {
  const dd = downsideDeviation(rets, periodsPerYear, mar);
  if (dd == null || dd === 0) return null; // no downside → undefined (don't fake Infinity)
  return (mean(rets) * periodsPerYear - mar) / dd;
}

export function calmar(values, periodsPerYear = 252) {
  const c = cagr(values, periodsPerYear), mdd = maxDrawdown(values);
  if (c == null || mdd === 0) return null;
  return c / mdd;
}

export function portfolioMetrics(values, { periodsPerYear = 252, maxDdLimit = 0.35 } = {}) {
  const rets = returns(values);
  const mdd = maxDrawdown(values);
  const round = (x) => (x == null ? null : +x.toFixed(4));
  return {
    cagr: round(cagr(values, periodsPerYear)),
    max_drawdown: round(mdd),
    calmar: round(calmar(values, periodsPerYear)),
    sortino: round(sortino(rets, periodsPerYear)),
    sharpe: round(sharpe(rets, periodsPerYear)),
    vol: round(annualVol(rets, periodsPerYear)),
    breaches_35: mdd > maxDdLimit,
    n: values.length,
  };
}

// Build a weight-normalized index series from per-ticker {dates,closes}, aligned on
// common dates and normalized to 100 at the first common bar. Pure + testable.
export function basketIndex(seriesByTicker, weights) {
  const names = Object.keys(seriesByTicker).filter((t) => weights[t] > 0 && seriesByTicker[t]?.dates?.length);
  if (!names.length) return { dates: [], values: [] };
  // intersection of dates across all tickers
  let common = null;
  for (const t of names) {
    const ds = new Set(seriesByTicker[t].dates);
    common = common ? common.filter((d) => ds.has(d)) : seriesByTicker[t].dates.filter((d) => ds.has(d));
  }
  if (!common || common.length < 2) return { dates: [], values: [] };
  const wsum = names.reduce((a, t) => a + weights[t], 0);
  const closeAt = {};
  for (const t of names) { const m = {}; seriesByTicker[t].dates.forEach((d, i) => (m[d] = seriesByTicker[t].closes[i])); closeAt[t] = m; }
  const base = {}; for (const t of names) base[t] = closeAt[t][common[0]];
  const values = common.map((d) => 100 * names.reduce((a, t) => a + (weights[t] / wsum) * (closeAt[t][d] / base[t]), 0));
  return { dates: common, values };
}
