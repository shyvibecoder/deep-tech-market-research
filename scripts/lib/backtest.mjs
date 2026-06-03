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
import { v23Signals, fcThrustLadder } from "./v23.mjs";

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

// Trailing simple moving average (null until warmed up). O(n).
function sma(arr, period) {
  const out = Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= period) s -= arr[i - period];
    if (i >= period - 1) out[i] = s / period;
  }
  return out;
}

// Align {name:{dates,closes}} on the common date intersection. Returns {dates,names,cols} or null.
function alignNames(seriesByName) {
  const names = Object.keys(seriesByName).filter((n) => seriesByName[n]?.dates?.length >= 60);
  if (names.length < 3) return null; // breadth needs a few names to mean anything
  const maps = {};
  let common = null;
  for (const n of names) {
    const m = new Map();
    seriesByName[n].dates.forEach((d, i) => m.set(d, seriesByName[n].closes[i]));
    maps[n] = m;
    const ds = new Set(m.keys());
    common = common == null ? ds : new Set([...common].filter((d) => ds.has(d)));
  }
  const dates = [...common].sort();
  if (dates.length < 60) return null;
  const cols = {};
  for (const n of names) cols[n] = dates.map((d) => maps[n].get(d));
  return { dates, names, cols };
}

// Fast-RE-ENTRY proof: put the live dial's breadth-based "fast entry" overlay (regime.mjs —
// when ≥`breadthThresh` of NAMES reclaim their 20-DMA, re-risk one notch) to a falsifiable test
// on a real multi-name basket. Compares two strategies on the SAME equal-weight basket, both
// no-look-ahead, both turnover-costed:
//   • PLAIN brake — in when the index is above its 200-DMA, else cash; re-enter only when the
//     index itself reclaims the 200-DMA.
//   • Brake + FAST RE-ENTRY — same, but while braked-out it re-risks one notch (`notch`, a
//     partial position) early when breadth ≥ threshold, without waiting for the index to recover.
// The question fast-entry lives or dies on: does re-entering on breadth capture more recovery
// (higher CAGR / time-in-market) WITHOUT giving the drawdown protection back (Calmar)?
export function fastReentryProof(seriesByName, { maPeriod = 200, breadthMa = 20, breadthThresh = 0.6, periodsPerYear = 252, costPerSwitchBps = 10, notch = 0.5, minEpisodeDd = 0.20 } = {}) {
  const A = alignNames(seriesByName);
  if (!A || A.dates.length < maPeriod + 60) return null;
  const { dates, names, cols } = A;
  const N = dates.length;
  // equal-weight index (normalize each name to 1 at the common start), and its 200-DMA
  const idx = [];
  const norm = {};
  for (const n of names) { const base = cols[n][0]; norm[n] = cols[n].map((c) => c / base); }
  for (let i = 0; i < N; i++) { let s = 0; for (const n of names) s += norm[n][i]; idx.push(100 * s / names.length); }
  const ma200 = sma(idx, maPeriod);
  // per-name 20-DMA breadth: fraction of names trading above their own short MA
  const sma20 = {}; for (const n of names) sma20[n] = sma(cols[n], breadthMa);
  const breadth = [];
  for (let i = 0; i < N; i++) {
    let above = 0, tot = 0;
    for (const n of names) if (sma20[n][i] != null) { tot++; if (cols[n][i] > sma20[n][i]) above++; }
    breadth.push(tot ? above / tot : null);
  }
  const cost = Math.max(0, costPerSwitchBps) / 10000;
  const run = (fast) => {
    const eq = [100], pos = [];
    let prev = null;
    for (let i = maPeriod; i < N; i++) {
      const inTrend = ma200[i - 1] != null && idx[i - 1] > ma200[i - 1]; // decide on prior bar
      // fast re-entry requires a CONFIRMED breadth thrust (≥thresh on the last TWO bars) — matches the live
      // 2-scan confirm in regime.mjs, so the backtest tests the actual rule, not a hair-trigger 1-bar version.
      const confirmed = breadth[i - 1] != null && breadth[i - 1] >= breadthThresh && breadth[i - 2] != null && breadth[i - 2] >= breadthThresh;
      let p = inTrend ? 1 : (fast && confirmed ? notch : 0);
      pos.push(p);
      const dPos = prev == null ? 0 : Math.abs(p - prev);
      prev = p;
      const ret = idx[i] / idx[i - 1];
      let e = eq[eq.length - 1] * (1 + p * (ret - 1));
      if (dPos > 0) e *= (1 - cost * dPos); // turnover proportional to the size of the position change
      eq.push(e);
    }
    return { eq: eq.slice(1), pos };
  };
  const plain = run(false), fast = run(true);
  const plainM = portfolioMetrics(plain.eq, { periodsPerYear });
  const fastM = portfolioMetrics(fast.eq, { periodsPerYear });
  const eqDates = dates.slice(maPeriod);
  const bh = []; let h = 100; for (let i = maPeriod; i < N; i++) { h *= idx[i] / idx[i - 1]; bh.push(h); }
  const bhM = portfolioMetrics(bh, { periodsPerYear }); // do-nothing baseline (basket fully invested)
  const episodes = drawdownEpisodes(bh, minEpisodeDd).map((e) => ({
    from: eqDates[e.iPeak], to: eqDates[e.iTrough],
    buyhold_dd: +e.dd.toFixed(4),
    plain_dd: +maxDdWindow(plain.eq, e.iPeak, e.iTrough).toFixed(4),
    fast_dd: +maxDdWindow(fast.eq, e.iPeak, e.iTrough).toFixed(4),
  }));
  const tim = (ps) => +(ps.reduce((a, b) => a + (b > 0 ? 1 : 0), 0) / ps.length).toFixed(2);
  const years = (Date.parse(eqDates[eqDates.length - 1]) - Date.parse(eqDates[0])) / (365.25 * 86400000);
  return {
    window: `${eqDates[0]}..${eqDates[eqDates.length - 1]}`,
    years: +years.toFixed(1),
    names, breadth_threshold: breadthThresh, notch,
    buyhold: bhM, plain: plainM, fast: fastM, // full 3-way: do-nothing vs brake vs brake+fast-reentry
    // −35% mandate check on each strategy over this window (true = breaches the objective):
    breach_35: { buyhold: bhM.breaches_35, brake: plainM.breaches_35, fast: fastM.breaches_35 },
    time_in_market_plain: tim(plain.pos), time_in_market_fast: tim(fast.pos),
    cagr_gain: +((fastM.cagr ?? 0) - (plainM.cagr ?? 0)).toFixed(4),       // >0 ⇒ fast re-entry captured more upside
    maxdd_cost: +(fastM.max_drawdown - plainM.max_drawdown).toFixed(4),     // >0 ⇒ fast re-entry took on more drawdown
    episodes,
    // The two claims fast-entry lives or dies on:
    improves_cagr: (fastM.cagr ?? -Infinity) > (plainM.cagr ?? -Infinity),
    worth_it: (fastM.calmar ?? -Infinity) > (plainM.calmar ?? -Infinity),  // net risk-adjusted improvement
  };
}

// F+C THRUST BACKTEST — runs the EXACT canonical production rule (the owner's Faber-Crash-Thrust design)
// over a price series, reusing the live v23.mjs functions so the backtest tests the REAL design, not a
// proxy: TREND (>200-DMA) / CRASH_OFF (252-day return<0 AND 60-day vol>25%) / THRUST (>a RISING 20-DMA —
// the fast re-entry) / else cash. No look-ahead — the ladder decides on closes through the PRIOR bar; the
// next bar's return accrues only when invested. Models 1× the underlying (NOT 2× QLD — leverage would
// breach the −35% mandate) vs cash. Turnover-costed. The composite-stress overlay (VIX/VIX3M/HYG) is
// exit-only and omitted here (it would only ADD defense), so this is a clean test of the ladder itself.
export function fcThrustBacktest(closes, { dates = null, periodsPerYear = 252, costPerSwitchBps = 10, minEpisodeDd = 0.20 } = {}) {
  if (!Array.isArray(closes) || closes.length < 211 + 30) return null; // v23Signals needs ≥211 bars + a usable sample
  const cost = Math.max(0, costPerSwitchBps) / 10000;
  const inv = [], bh = [], eqDates = [];
  let e = 100, h = 100, prevPos = null, switches = 0;
  for (let i = 211; i < closes.length; i++) {
    const sig = v23Signals(closes.slice(0, i)); // PRIOR bars only (decide on yesterday's close) — no look-ahead
    const pos = sig && fcThrustLadder(sig).instrument === "QLD" ? 1 : 0; // invested when the ladder is risk-on, else cash
    const switched = prevPos !== null && pos !== prevPos;
    if (switched) switches++;
    prevPos = pos;
    const ret = closes[i] / closes[i - 1];
    h *= ret;
    let ne = e * (pos ? ret : 1);
    if (switched) ne *= (1 - cost);
    e = ne;
    inv.push(e); bh.push(h); if (dates) eqDates.push(dates[i]);
  }
  if (inv.length < 60) return null;
  const invM = portfolioMetrics(inv, { periodsPerYear });
  const bhM = portfolioMetrics(bh, { periodsPerYear });
  const episodes = dates ? drawdownEpisodes(bh, minEpisodeDd).map((ep) => {
    const fcDd = maxDdWindow(inv, ep.iPeak, ep.iTrough);
    return { from: eqDates[ep.iPeak], to: eqDates[ep.iTrough], buyhold_dd: +ep.dd.toFixed(4), fc_dd: +fcDd.toFixed(4), helped: fcDd < ep.dd - 0.005 };
  }) : [];
  const years = dates ? (Date.parse(eqDates[eqDates.length - 1]) - Date.parse(eqDates[0])) / (365.25 * 86400000) : inv.length / periodsPerYear;
  return {
    rule: "F+C Thrust (Faber + Crash + Thrust, canonical)",
    window: dates ? `${eqDates[0]}..${eqDates[eqDates.length - 1]}` : null,
    years: +years.toFixed(1),
    switches, turnover_cost_bps: switches * costPerSwitchBps,
    buyhold: bhM, fc_thrust: invM,
    max_dd_reduction: +(bhM.max_drawdown - invM.max_drawdown).toFixed(4), // >0 ⇒ the rule cut maxDD
    cagr_cost: +((bhM.cagr ?? 0) - (invM.cagr ?? 0)).toFixed(4),          // >0 ⇒ gave up CAGR for the protection
    breach_35: { buyhold: bhM.breaches_35, fc_thrust: invM.breaches_35 },
    reduces_tail: invM.max_drawdown < bhM.max_drawdown,
    improves_calmar: (invM.calmar ?? -Infinity) > (bhM.calmar ?? -Infinity),
    episodes,
  };
}
