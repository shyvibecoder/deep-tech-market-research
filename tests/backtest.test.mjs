import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backtestRegime, brakeProof, fastReentryProof, fcThrustBacktest } from "../scripts/lib/backtest.mjs";

// fcThrustBacktest runs the EXACT live F+C Thrust ladder (v23.mjs) over a price series. Build a long
// uptrend → sharp crash → recovery; the ladder (TREND/CRASH_OFF/THRUST/cash) should cut the crash.
describe("fcThrustBacktest: the canonical F+C Thrust rule vs buy-&-hold", () => {
  const dates = [], closes = []; const start = Date.UTC(2000, 0, 1);
  let p = 100;
  for (let i = 0; i < 240; i++) { p *= 1.002; dates.push(new Date(start + dates.length * 864e5).toISOString().slice(0, 10)); closes.push(p); } // uptrend (TREND)
  for (let i = 0; i < 50; i++) { p *= (i % 2 ? 0.95 : 1.0); dates.push(new Date(start + dates.length * 864e5).toISOString().slice(0, 10)); closes.push(p); } // volatile crash (CRASH_OFF)
  for (let i = 0; i < 120; i++) { p *= 1.003; dates.push(new Date(start + dates.length * 864e5).toISOString().slice(0, 10)); closes.push(p); } // recovery (THRUST then TREND)
  const r = fcThrustBacktest(closes, { dates });
  it("returns the 3-way verdicts + −35% mandate flags", () => {
    assert.ok(r && r.buyhold && r.fc_thrust);
    assert.ok(r.breach_35 && typeof r.breach_35.buyhold === "boolean" && typeof r.breach_35.fc_thrust === "boolean");
    assert.equal(r.rule.startsWith("F+C Thrust"), true);
  });
  it("the ladder does not have a DEEPER drawdown than buy-&-hold (it brakes the crash)", () => {
    assert.ok(r.fc_thrust.max_drawdown <= r.buyhold.max_drawdown + 1e-9, `${r.fc_thrust.max_drawdown} <= ${r.buyhold.max_drawdown}`);
    assert.equal(r.reduces_tail, r.fc_thrust.max_drawdown < r.buyhold.max_drawdown);
  });
  it("returns null when the series is too short to warm up (needs ≥211 bars)", () => {
    assert.equal(fcThrustBacktest(closes.slice(0, 150)), null);
  });
});

// Build a series: smooth uptrend, then a sharp crash. A trend brake (exit below the
// moving average) should avoid most of the crash → smaller max drawdown.
function upThenCrash() {
  const v = [];
  for (let i = 0; i < 50; i++) v.push(100 * (1 + 0.005 * i)); // ~100 → 124.5
  const top = v[v.length - 1];
  for (let i = 1; i <= 21; i++) v.push(top * (1 - 0.03 * i)); // crash ~ -60%
  return v;
}

describe("backtest: trend brake reduces drawdown (evidence for the dial)", () => {
  const r = backtestRegime(upThenCrash(), { maPeriod: 20, periodsPerYear: 252 });
  it("returns braked vs unbraked metrics", () => {
    assert.ok(r && r.braked && r.unbraked);
  });
  it("braked max drawdown is smaller than buy-and-hold", () => {
    assert.ok(r.braked.max_drawdown < r.unbraked.max_drawdown, `${r.braked.max_drawdown} < ${r.unbraked.max_drawdown}`);
    assert.ok(r.dd_reduction > 0);
  });
  it("switches to cash at least once and reports time-in-market", () => {
    assert.ok(r.whipsaws >= 1);
    assert.ok(r.time_in_market > 0 && r.time_in_market <= 1);
  });
  it("returns null for too-short series", () => {
    assert.equal(backtestRegime([1, 2, 3], { maPeriod: 20 }), null);
  });
});

// Turnover is not free (TODO.md:133): charging a per-switch cost must lower the braked
// path's return vs. a zero-cost run, and the charge must scale with the number of switches.
describe("backtest: whipsaw/turnover cost is charged (de-biases Calmar)", () => {
  const s = upThenCrash();
  it("reports cost params and total turnover charged", () => {
    const r = backtestRegime(s, { maPeriod: 20, costPerSwitchBps: 25 });
    assert.equal(r.cost_per_switch_bps, 25);
    assert.equal(r.turnover_cost_bps, r.whipsaws * 25);
  });
  it("a higher per-switch cost yields a (weakly) lower braked CAGR", () => {
    const free = backtestRegime(s, { maPeriod: 20, costPerSwitchBps: 0 });
    const paid = backtestRegime(s, { maPeriod: 20, costPerSwitchBps: 50 });
    assert.ok(paid.whipsaws >= 1, "need at least one switch to test the charge");
    assert.ok(paid.braked.cagr <= free.braked.cagr, `${paid.braked.cagr} <= ${free.braked.cagr}`);
  });
});

// brakeProof: the SAME brake on a long-history proxy, tested against real deep drawdowns.
// Build dates + a long series with a slow ~ -55% crash (trend-following's home turf, brake
// should help) and a later sharp crash. Verify the falsifiable verdicts + per-crash episodes.
function longSeriesWithCrashes() {
  const dates = [], v = [];
  const start = Date.UTC(2000, 0, 1);
  const push = (val) => { dates.push(new Date(start + dates.length * 86400000).toISOString().slice(0, 10)); v.push(val); };
  let p = 100;
  for (let i = 0; i < 250; i++) { p *= 1.003; push(p); }          // slow uptrend ~100→210
  for (let i = 0; i < 90; i++) { p *= 0.990; push(p); }           // slow crash ~ -59% (brake exits)
  for (let i = 0; i < 160; i++) { p *= 1.004; push(p); }          // recovery
  const top = p;
  for (let i = 0; i < 8; i++) { p = top * (1 - 0.045 * (i + 1)); push(p); } // sharp ~ -33% (whipsaw)
  for (let i = 0; i < 40; i++) { p *= 1.002; push(p); }
  return { dates, values: v };
}

describe("brakeProof: 200/MA brake tested on a long multi-crash proxy", () => {
  const { dates, values } = longSeriesWithCrashes();
  const r = brakeProof(dates, values, { maPeriod: 50, minEpisodeDd: 0.20 });
  it("returns a result with both falsifiable verdicts", () => {
    assert.ok(r && typeof r.reduces_tail === "boolean" && typeof r.improves_calmar === "boolean");
  });
  it("the slow crash is captured and the brake cuts full-period max drawdown", () => {
    assert.ok(r.buyhold.max_drawdown > 0.5, `buyhold maxDD ${r.buyhold.max_drawdown}`);
    assert.ok(r.braked.max_drawdown < r.buyhold.max_drawdown, `${r.braked.max_drawdown} < ${r.buyhold.max_drawdown}`);
    assert.equal(r.reduces_tail, true);
    assert.ok(r.max_dd_reduction > 0);
  });
  it("finds ≥20% drawdown episodes and marks at least one as helped", () => {
    assert.ok(r.episodes.length >= 1);
    assert.ok(r.episodes.some((e) => e.helped), "the slow crash should be cut by the brake");
    for (const e of r.episodes) assert.ok(e.from && e.to && e.buyhold_dd >= 0.20);
  });
  it("returns null for a series too short to warm up the MA", () => {
    assert.equal(brakeProof(dates.slice(0, 60), values.slice(0, 60), { maPeriod: 50 }), null);
    assert.equal(brakeProof(["2020-01-01"], [100], { maPeriod: 50 }), null);
  });
});

// fastReentryProof: the breadth-based "fast entry" overlay vs a plain 200-DMA brake. Build a
// multi-name basket that crashes then sharply recovers: breadth (names back above their 20-DMA)
// turns up EARLY in the recovery, while the index reclaims its 200-DMA only much later — exactly
// the case fast re-entry is designed for. It should re-enter sooner → more time in market + CAGR.
function basketCrashThenRecovery() {
  const dates = [], start = Date.UTC(2000, 0, 1);
  const base = [];
  let p = 100;
  for (let i = 0; i < 420; i++) {
    if (i < 200) p *= 1.0024;       // uptrend ~100→161
    else if (i < 240) p *= 0.9866;  // crash ~ -42%
    else if (i < 360) p *= 1.0043;  // sharp recovery
    else p *= 1.0012;               // mild uptrend
    base.push(p);
    dates.push(new Date(start + i * 86400000).toISOString().slice(0, 10));
  }
  const byName = {};
  for (let k = 0; k < 5; k++) byName["N" + k] = { dates, closes: base.map((c, i) => c * (1 + 0.01 * Math.sin((i + k * 7) / 9))) };
  return byName;
}

describe("fastReentryProof: breadth fast-entry overlay vs a plain 200-DMA brake", () => {
  const fr = fastReentryProof(basketCrashThenRecovery(), { maPeriod: 100, breadthMa: 20, breadthThresh: 0.6 });
  it("returns the 3-way (buyhold/brake/fast) + −35% mandate check + both verdicts", () => {
    assert.ok(fr && typeof fr.improves_cagr === "boolean" && typeof fr.worth_it === "boolean");
    assert.ok(fr.buyhold && fr.plain && fr.fast && fr.names.length === 5);
    assert.ok(fr.breach_35 && typeof fr.breach_35.buyhold === "boolean" && typeof fr.breach_35.brake === "boolean" && typeof fr.breach_35.fast === "boolean");
    // the timing overlay must not have a DEEPER drawdown than do-nothing (it brakes)
    assert.ok(fr.fast.max_drawdown <= fr.buyhold.max_drawdown + 1e-9);
  });
  it("fast re-entry spends ≥ time in market and captures ≥ the CAGR of the plain brake", () => {
    assert.ok(fr.time_in_market_fast >= fr.time_in_market_plain, `tim ${fr.time_in_market_fast} >= ${fr.time_in_market_plain}`);
    assert.ok(fr.fast.cagr >= fr.plain.cagr - 1e-9, `cagr ${fr.fast.cagr} >= ${fr.plain.cagr}`);
    assert.ok(fr.cagr_gain >= 0);
    assert.equal(fr.improves_cagr, true);
  });
  it("captures the crash episode for both strategies", () => {
    assert.ok(fr.episodes.length >= 1);
    for (const e of fr.episodes) assert.ok(e.buyhold_dd >= 0.20 && e.plain_dd >= 0 && e.fast_dd >= 0);
  });
  it("returns null with too few names or too little history", () => {
    const b = basketCrashThenRecovery();
    assert.equal(fastReentryProof({ N0: b.N0, N1: b.N1 }, { maPeriod: 100 }), null); // <3 names
    const short = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { dates: v.dates.slice(0, 120), closes: v.closes.slice(0, 120) }]));
    assert.equal(fastReentryProof(short, { maPeriod: 100 }), null); // < maPeriod+60
  });
});

// Helm #5: NO LOOK-AHEAD regression. Each position is decided on the PRIOR close (ma[i-1], values[i-1]).
// Changing ONLY the final bar's value must not change any position decision (only that bar's return) →
// time_in_market + whipsaws are invariant. A look-ahead bug (deciding on values[i]) would break this.
describe("backtest: no look-ahead (positions use only prior bars, Helm #5)", () => {
  const base = Array.from({ length: 12 }, (_, i) => 100 + Math.sin(i) * 5 + i);
  it("changing only the final bar leaves all position decisions unchanged", () => {
    const r1 = backtestRegime(base, { maPeriod: 3 });
    const r2 = backtestRegime([...base.slice(0, -1), base[base.length - 1] * 1.5], { maPeriod: 3 });
    assert.ok(r1 && r2);
    assert.equal(r1.time_in_market, r2.time_in_market);
    assert.equal(r1.whipsaws, r2.whipsaws);
    assert.equal(r1.n, r2.n);
  });
});
