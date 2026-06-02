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
