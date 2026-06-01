// G2 harness (also the P1 scout gate): does a CANDIDATE basket actually add UNCORRELATED breadth, or is
// it just more AI-capex beta wearing a different name? Measures a candidate's correlation + beta to the
// AI-capex complex on history. Pure ESM, reuses the G1 OLS core. The whole point of this session's lesson:
// qualify a 2nd axis by MEASURED correlation, not by narrative.
import { alignByDate, ols } from "./factor.mjs";

// Equal-weight daily returns of a basket over the common dates of its tickers (fixed membership per day:
// a ticker only contributes on days it has a valid prior+current close, so ragged/IPO histories are fine).
export function basketReturns(seriesByTicker, tickers) {
  const named = {};
  for (const t of tickers || []) { const s = seriesByTicker[t]; if (s?.dates && s?.closes) named[t] = { dates: s.dates, values: s.closes }; }
  const { dates, cols } = alignByDate(named);
  if (dates.length < 30) return { dates: [], rets: [] };
  const tk = Object.keys(cols), rets = [];
  for (let i = 1; i < dates.length; i++) {
    const rs = [];
    for (const t of tk) { const a = cols[t][i - 1], b = cols[t][i]; if (a > 0 && b > 0) rs.push(b / a - 1); }
    rets.push(rs.length ? rs.reduce((x, y) => x + y, 0) / rs.length : 0);
  }
  return { dates: dates.slice(1), rets };
}

// Correlation + beta of a candidate-axis basket vs the AI-capex complex, over aligned daily returns.
// `qualifies` (adds real breadth) when |corr| < corrMax AND |beta| < betaMax. Returns null on thin overlap.
export function axisCorrelation(seriesByTicker, candidateTickers, complexTickers, { corrMax = 0.5, betaMax = 0.7, minDays = 60 } = {}) {
  const cand = basketReturns(seriesByTicker, candidateTickers);
  const comp = basketReturns(seriesByTicker, complexTickers);
  const a = alignByDate({ CAND: { dates: cand.dates, values: cand.rets }, COMP: { dates: comp.dates, values: comp.rets } });
  if (a.dates.length < minDays) return null;
  const fit = ols(a.cols.CAND, [a.cols.COMP]);
  if (!fit) return null;
  const beta = fit.coef[1];
  const corr = Math.sign(beta) * Math.sqrt(Math.max(0, fit.r2)); // single-regressor: |corr| = sqrt(R²)
  const qualifies = Math.abs(corr) < corrMax && Math.abs(beta) < betaMax;
  return {
    corr: +corr.toFixed(3), beta: +beta.toFixed(3), r2: +fit.r2.toFixed(3), n: fit.n, qualifies,
    note: qualifies
      ? "uncorrelated enough to add real risk breadth"
      : "too correlated to the AI-capex complex — adds names, not breadth (scout gate would REJECT)",
  };
}
