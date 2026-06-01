// G2 harness (also the P1 scout gate): does a CANDIDATE basket actually add UNCORRELATED breadth, or is
// it just more AI-capex beta wearing a different name? Measures a candidate's correlation + beta to the
// AI-capex complex on history. Pure ESM, reuses the G1 OLS core. The whole point of this session's lesson:
// qualify a 2nd axis by MEASURED correlation, not by narrative.
import { alignByDate, ols } from "./factor.mjs";
import { basketIndex, portfolioMetrics } from "../../web/metrics.mjs";

// Return + risk profile of an equal-weight basket over its FULL common-date window. A 2nd axis must
// EARN its capital, not just be uncorrelated — low correlation to a loser is worthless. Returns null on
// thin overlap. `years`/`start`/`end` make the window explicit so a short history can't masquerade as long.
export function basketStats(seriesByTicker, tickers, periodsPerYear = 252) {
  const weights = {};
  for (const t of tickers || []) if (seriesByTicker[t]?.dates?.length) weights[t] = 1;
  const idx = basketIndex(seriesByTicker, weights);
  if (idx.values.length < 60) return null;
  const m = portfolioMetrics(idx.values, { periodsPerYear });
  return {
    start: idx.dates[0], end: idx.dates[idx.dates.length - 1],
    years: +(idx.values.length / periodsPerYear).toFixed(1),
    cagr: m.cagr, vol: m.vol, sharpe: m.sharpe, calmar: m.calmar, maxDD: m.max_drawdown, n: m.n,
  };
}

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

// 2-FACTOR gate (the forward-looking metric). Raw correlation conflates two things: generic market beta
// (everything co-moves in a sell-off, and this only rises as AI permeates the index) and the SPECIFIC
// AI-capex risk we actually carry. So we orthogonalize the AI-capex complex from the broad market to get
// an AI-capex factor that is independent of market beta, then regress the candidate on BOTH. The candidate
// is judged on its RESIDUAL AI-capex beta (`aiBeta`) — its sensitivity to the build-out AFTER controlling
// for market beta. A basket can have high raw correlation (high mktBeta) yet ~zero aiBeta — that's genuine
// breadth against an AI-capex air-pocket. `qualifies` when |aiBeta| < aiBetaMax. Returns null on thin overlap.
export function aiCapexLoading(seriesByTicker, candidateTickers, marketTickers, complexTickers, { aiBetaMax = 0.3, minDays = 60 } = {}) {
  const mkt = basketReturns(seriesByTicker, marketTickers);
  const cpx = basketReturns(seriesByTicker, complexTickers);
  const cand = basketReturns(seriesByTicker, candidateTickers);
  // Step 1: orthogonalize the complex from the market → AI-capex-specific factor (regression residuals).
  const a1 = alignByDate({ M: { dates: mkt.dates, values: mkt.rets }, C: { dates: cpx.dates, values: cpx.rets } });
  if (a1.dates.length < minDays) return null;
  const f1 = ols(a1.cols.C, [a1.cols.M]);
  if (!f1) return null;
  const aiFactor = a1.cols.C.map((c, i) => c - (f1.coef[0] + f1.coef[1] * a1.cols.M[i]));
  // Step 2: regress candidate on [market, AI-capex factor]; the AI-capex factor's slope is the clean loading.
  const a2 = alignByDate({ Y: { dates: cand.dates, values: cand.rets }, M: { dates: a1.dates, values: a1.cols.M }, F: { dates: a1.dates, values: aiFactor } });
  if (a2.dates.length < minDays) return null;
  const fit = ols(a2.cols.Y, [a2.cols.M, a2.cols.F]);
  if (!fit) return null;
  const marketBeta = fit.coef[1], aiBeta = fit.coef[2], aiT = fit.t?.[2] ?? null;
  const qualifies = Math.abs(aiBeta) < aiBetaMax;
  return {
    marketBeta: +marketBeta.toFixed(3), aiBeta: +aiBeta.toFixed(3), aiT: aiT == null ? null : +aiT.toFixed(2),
    r2: +fit.r2.toFixed(3), n: fit.n, qualifies,
    note: qualifies
      ? "low marginal AI-capex loading — genuine breadth vs the build-out (high mktBeta is just market beta)"
      : "loads on the AI-capex factor even AFTER market beta — not real breadth against a capex air-pocket",
  };
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
