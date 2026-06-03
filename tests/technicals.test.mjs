import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTechnicals, technicalsFromHistory, rsi } from "../scripts/lib/technicals.mjs";

describe("technicals: Wilder RSI-14", () => {
  it("all-up → 100, all-down → 0, too-short → null", () => {
    assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
    assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 - i)), 0);
    assert.equal(rsi([1, 2, 3]), null);
  });
  it("a non-finite close → null (not NaN leaking to the UI)", () => {
    const c = Array.from({ length: 30 }, (_, i) => 100 + i); c[20] = NaN;
    assert.equal(rsi(c), null);
  });
  it("a balanced oscillation sits near the midline (≈ 30–70)", () => {
    const c = []; for (let i = 0; i < 60; i++) c.push(100 + (i % 2 === 0 ? 1 : -1));
    const r = rsi(c);
    assert.ok(r > 30 && r < 70, `RSI ${r} should be mid-range`);
  });
  it("computeTechnicals surfaces rsi_14 and rsi_10", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);
    const dates = closes.map((_, i) => `2025-${String(1 + (i % 12)).padStart(2, "0")}-01`);
    const t = computeTechnicals(dates, closes);
    assert.ok(Number.isFinite(t.rsi_14) && Number.isFinite(t.rsi_10));
    // shorter lookback is more responsive: on a steady uptrend both are high (100 here)
    assert.equal(t.rsi_10, rsi(closes, 10));
  });
});

describe("technicals: technicalsFromHistory (DB series + today's price)", () => {
  const base = { dates: [], closes: [] };
  let d = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < 400; i++) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) { base.dates.push(d.toISOString().slice(0, 10)); base.closes.push(100); } d = new Date(d.getTime() + 86400000); }

  it("appends a newer today bar and computes from the combined series", () => {
    const today = { date: "2026-01-02", price: 130 };
    const t = technicalsFromHistory(base, today);
    assert.equal(t.price, 130);
    assert.equal(t.asof, "2026-01-02");
    assert.ok(t.above_ma200); // 130 > the 100 plateau
  });
  it("refreshes (does not duplicate) when today equals the last bar", () => {
    const last = base.dates[base.dates.length - 1];
    const t = technicalsFromHistory(base, { date: last, price: 200 });
    assert.equal(t.price, 200);
    assert.equal(t.asof, last);
  });
  it("refuses a today OLDER than the series tail (no corruption) → null", () => {
    assert.equal(technicalsFromHistory(base, { date: "2000-01-01", price: 50 }), null);
  });
  it("returns null on too-shallow history or bad input (caller falls back to live)", () => {
    assert.equal(technicalsFromHistory({ dates: ["2026-01-02"], closes: [10] }, { date: "2026-01-03", price: 11 }), null);
    assert.equal(technicalsFromHistory(null, { date: "x", price: 1 }), null);
    assert.equal(technicalsFromHistory(base, { date: "2026-01-02", price: 0 }), null);
  });
});

// Build exactly N weekday daily closes; close i = fn(i) where i is the bar index (0-based).
function series(n, fn) {
  const dates = [], closes = [];
  let d = new Date(Date.UTC(2020, 0, 1));
  while (closes.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) { dates.push(d.toISOString().slice(0, 10)); closes.push(fn(closes.length)); }
    d = new Date(d.getTime() + 86400000);
  }
  return { dates, closes };
}

describe("technicals: windows correctly on a DEEP series (the read-side fix)", () => {
  // 6 years of data; a 52-week high set RECENTLY must not be polluted by an old all-time high.
  const n = 252 * 6;
  const { dates, closes } = series(n, (i) => (i < n - 300 ? 500 : 100 + i * 0.01)); // old plateau 500, recent ~100s
  const t = computeTechnicals(dates, closes);
  it("52-week high uses the trailing ~252 sessions, NOT the all-time max", () => {
    const recentMax = Math.max(...closes.slice(-252));
    assert.equal(t.high52, recentMax);
    assert.ok(t.high52 < 200); // would be 500 if it used the full history (the bug we're preventing)
  });
  it("12-month momentum compares to ~252 sessions ago, not the first bar decades back", () => {
    const ref = closes[closes.length - 1 - 252];
    assert.ok(Math.abs(t.mom_12m - (closes[closes.length - 1] / ref - 1)) < 1e-9);
  });
  it("YTD uses the first close on/after Jan 1 of the latest bar's year", () => {
    const yr = dates[dates.length - 1].slice(0, 4);
    const firstIdx = dates.findIndex((d) => d >= `${yr}-01-01`);
    assert.ok(Math.abs(t.ytd - (closes[closes.length - 1] / closes[firstIdx] - 1)) < 1e-9);
  });
});

describe("technicals: moving averages + flags", () => {
  const { dates, closes } = series(300, () => 100); // flat at 100
  const t = computeTechnicals(dates, closes);
  it("flat series → MAs equal price, above_* true, vol ~0", () => {
    assert.equal(t.ma200, 100); assert.equal(t.ma20, 100);
    assert.equal(t.above_ma200, true); assert.equal(t.above_ma20, true);
    assert.ok(t.vol_1y < 1e-6);
  });
  it("price below the 200-DMA flips above_ma200 false", () => {
    const up = series(300, (i) => 100 + i); // rising → price >> 200-DMA
    const tu = computeTechnicals(up.dates, up.closes);
    assert.equal(tu.above_ma200, true);
    const down = series(300, (i) => 400 - i); // falling → price << 200-DMA
    const td = computeTechnicals(down.dates, down.closes);
    assert.equal(td.above_ma200, false);
  });
});

describe("technicals: short series + safety (graceful nulls, never throws)", () => {
  it("short series → long-window fields null, no throw", () => {
    const { dates, closes } = series(40, () => 100);
    const t = computeTechnicals(dates, closes);
    assert.equal(t.ma200, null); assert.equal(t.mom_12m, null);
    assert.equal(t.ma20, 100); // 20-DMA still available
    assert.equal(t.price, 100);
  });
  it("empty input returns nulls, not an exception", () => {
    const t = computeTechnicals([], []);
    assert.equal(t.price, null); assert.equal(t.ma200, null); assert.equal(t.high52, null);
  });
  it("price + asof come from the LAST bar", () => {
    const { dates, closes } = series(60, (i) => 100 + i);
    const t = computeTechnicals(dates, closes);
    assert.equal(t.price, closes[closes.length - 1]);
    assert.equal(t.asof, dates[dates.length - 1]);
  });
});
