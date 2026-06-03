// Regime backtest: does a trend brake (exit when the basket is below its moving
// average) actually cut drawdown and lift Calmar/Sortino vs. buy-and-hold — on THIS
// basket, with no look-ahead (decisions use yesterday's close vs yesterday's MA)?
// Pure; makes the timing dial's premise falsifiable rather than asserted.
//
// Turnover is NOT free: each regime flip (in/out of cash) pays a spread+slippage
// cost, charged on the braked path so the braked Calmar/Sortino aren't overstated
// (TODO.md:133 — a Calmar objective is directly biased by uncosted whipsaws).
// `costPerSwitchBps` is a liquid-ETF estimate; a TAXABLE sleeve pays far more
// (realized cap-gains on every exit) — which is exactly why de-risking is routed
// to the IRA sleeve in docs/DRAWDOWN-DEFENSE.md, not modeled as free here.
import { portfolioMetrics, maxDrawdown } from "./metrics.mjs";

export function backtestRegime(values, { maPeriod = 200, periodsPerYear = 252, costPerSwitchBps = 10 } = {}) {
  if (!Array.isArray(values) || values.length < maPeriod + 2) return null;
  const ma = values.map((_, i) => {
    if (i < maPeriod - 1) return null;
    let s = 0; for (let j = i - maPeriod + 1; j <= i; j++) s += values[j];
    return s / maPeriod;
  });
  const cost = Math.max(0, costPerSwitchBps) / 10000;
  const braked = [100], unb = [100], invested = [];
  let switches = 0, prevPos = null;
  for (let i = maPeriod; i < values.length; i++) {
    const pos = (ma[i - 1] != null && values[i - 1] > ma[i - 1]) ? 1 : 0; // decide on prior close (no look-ahead)
    invested.push(pos);
    const switched = prevPos !== null && pos !== prevPos;
    if (switched) switches++;
    prevPos = pos;
    const ret = values[i] / values[i - 1];
    let b = braked[braked.length - 1] * (pos ? ret : 1);
    if (switched) b *= (1 - cost); // entering/exiting cash costs spread+slippage — charge it
    braked.push(b);
    unb.push(unb[unb.length - 1] * ret);
  }
  if (braked.length < 3) return null;
  return {
    ma_period: maPeriod,
    cost_per_switch_bps: costPerSwitchBps,
    turnover_cost_bps: switches * costPerSwitchBps, // total turnover charged over the window
    braked: portfolioMetrics(braked, { periodsPerYear }),
    unbraked: portfolioMetrics(unb, { periodsPerYear }),
    dd_reduction: +(maxDrawdown(unb) - maxDrawdown(braked)).toFixed(4),
    whipsaws: switches,
    time_in_market: +(invested.reduce((a, b) => a + b, 0) / invested.length).toFixed(2),
    n: invested.length,
  };
}

// Max drawdown (positive fraction) over the inclusive index window [i0, i1].
function maxDdWindow(arr, i0, i1) {
  let peak = arr[i0], mdd = 0;
  for (let i = i0; i <= i1; i++) {
    if (arr[i] > peak) peak = arr[i];
    const dd = (peak - arr[i]) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

// Non-overlapping peak→trough drawdown episodes in `bh` whose depth >= minDd. An episode
// opens at a running peak, deepens to its trough, and closes when price recovers to that
// peak (or at series end). Used to ask, per real crash: did the brake cut THIS one?
function drawdownEpisodes(bh, minDd) {
  const eps = [];
  let peak = bh[0], iPeak = 0, trough = bh[0], iTrough = 0, open = false;
  for (let i = 1; i < bh.length; i++) {
    if (bh[i] >= peak) {
      if (open) { const dd = (peak - trough) / peak; if (dd >= minDd) eps.push({ iPeak, iTrough, dd }); open = false; }
      peak = bh[i]; iPeak = i; trough = bh[i]; iTrough = i;
    } else {
      open = true;
      if (bh[i] < trough) { trough = bh[i]; iTrough = i; }
    }
  }
  if (open) { const dd = (peak - trough) / peak; if (dd >= minDd) eps.push({ iPeak, iTrough, dd }); }
  return eps;
}

// Brake PROOF: run the SAME live 200-DMA brake on a LONG-HISTORY proxy series (decoupled
// from the book's short, intersection-truncated basket) so the timing dial's tail claim is
// TESTED against real ≥20% drawdowns (2000/2008/2020/2022), not asserted. This is evidence
// for the METHODOLOGY (Faber-style trend following) on a proxy — NOT a backtest of this book;
// the UI labels it so. Turnover is charged (same costPerSwitchBps as backtestRegime). Returns
// the two falsifiable verdicts (reduces_tail / improves_calmar) + a per-crash episode table.
export function brakeProof(dates, values, { maPeriod = 200, periodsPerYear = 252, costPerSwitchBps = 10, minEpisodeDd = 0.20 } = {}) {
  if (!Array.isArray(values) || !Array.isArray(dates) || values.length !== dates.length || values.length < maPeriod + 60) return null;
  const ma = values.map((_, i) => {
    if (i < maPeriod - 1) return null;
    let s = 0; for (let j = i - maPeriod + 1; j <= i; j++) s += values[j];
    return s / maPeriod;
  });
  const cost = Math.max(0, costPerSwitchBps) / 10000;
  const eqDates = [], braked = [], bh = [];
  let b = 100, h = 100, prevPos = null, switches = 0;
  for (let i = maPeriod; i < values.length; i++) {
    const pos = (ma[i - 1] != null && values[i - 1] > ma[i - 1]) ? 1 : 0; // prior close (no look-ahead)
    const switched = prevPos !== null && pos !== prevPos;
    if (switched) switches++;
    prevPos = pos;
    const ret = values[i] / values[i - 1];
    h *= ret;
    b *= (pos ? ret : 1);
    if (switched) b *= (1 - cost);
    eqDates.push(dates[i]); braked.push(b); bh.push(h);
  }
  if (bh.length < 60) return null;
  const bhM = portfolioMetrics(bh, { periodsPerYear });
  const brM = portfolioMetrics(braked, { periodsPerYear });
  const episodes = drawdownEpisodes(bh, minEpisodeDd).map((e) => {
    const brakedDd = maxDdWindow(braked, e.iPeak, e.iTrough);
    return {
      from: eqDates[e.iPeak], to: eqDates[e.iTrough],
      buyhold_dd: +e.dd.toFixed(4),
      braked_dd: +brakedDd.toFixed(4),
      helped: brakedDd < e.dd - 0.005, // brake cut this crash by >0.5pt (else it whipsawed/no-help)
    };
  });
  const years = (Date.parse(eqDates[eqDates.length - 1]) - Date.parse(eqDates[0])) / (365.25 * 86400000);
  return {
    ma_period: maPeriod,
    window: `${eqDates[0]}..${eqDates[eqDates.length - 1]}`,
    years: +years.toFixed(1),
    cost_per_switch_bps: costPerSwitchBps,
    switches,
    buyhold: bhM,
    braked: brM,
    max_dd_reduction: +(bhM.max_drawdown - brM.max_drawdown).toFixed(4), // >0 ⇒ brake cut maxDD
    cagr_cost: +((bhM.cagr ?? 0) - (brM.cagr ?? 0)).toFixed(4),           // >0 ⇒ brake gave up CAGR
    episodes,
    // The two claims the dial lives or dies on, over a real multi-tail window:
    reduces_tail: brM.max_drawdown < bhM.max_drawdown,
    improves_calmar: (brM.calmar ?? -Infinity) > (bhM.calmar ?? -Infinity),
  };
}
