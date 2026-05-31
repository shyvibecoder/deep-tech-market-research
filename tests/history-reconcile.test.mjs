import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileSeries } from "../scripts/lib/history-reconcile.mjs";

const S = (dates, closes) => ({ dates, closes });

describe("history-reconcile: cross-provider per-bar corroboration", () => {
  it("agreeing providers → one corroborated 'consensus' bar (median)", () => {
    const { rows } = reconcileSeries("AAA", {
      yahoo: S(["2026-01-05"], [100]), stooq: S(["2026-01-05"], [100.5]), tiingo: S(["2026-01-05"], [99.8]),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].d, "2026-01-05");
    assert.equal(rows[0].corroborated, true);
    assert.equal(rows[0].source, "consensus");
    assert.ok(Math.abs(rows[0].close - 100) < 0.6); // ~median of the three
  });

  it("DROPS a bar where providers disagree beyond tolerance (can't trust it)", () => {
    const { rows, stats } = reconcileSeries("AAA", {
      yahoo: S(["2026-01-05"], [100]), stooq: S(["2026-01-05"], [140]), // 40% apart, only two sources, no majority
    });
    assert.equal(rows.length, 0);
    assert.equal(stats.dropped_conflict, 1);
  });

  it("with 3 providers, the outlier is excluded and the 2 agreeing form consensus", () => {
    const { rows } = reconcileSeries("AAA", {
      yahoo: S(["2026-01-05"], [100]), stooq: S(["2026-01-05"], [100.4]), tiingo: S(["2026-01-05"], [150]), // tiingo bad
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].corroborated, true);
    assert.ok(Math.abs(rows[0].close - 100.2) < 0.5); // median of the two good ones, outlier dropped
  });

  it("single-provider bars are kept but flagged uncorroborated (deep history only one source has)", () => {
    const { rows, stats } = reconcileSeries("AAA", { yahoo: S(["2001-03-05"], [42]) });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].corroborated, false);
    assert.equal(rows[0].source, "yahoo");
    assert.equal(stats.single_source, 1);
  });
});

describe("history-reconcile: synthetic / weekend / holiday screening", () => {
  it("drops weekend bars (markets closed → a bar there is synthetic)", () => {
    // 2026-01-10 is a Saturday, 2026-01-11 a Sunday.
    const { rows, stats } = reconcileSeries("AAA", {
      yahoo: S(["2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12"], [100, 100, 100, 101]),
      stooq: S(["2026-01-09", "2026-01-12"], [100, 101]),
    });
    const days = rows.map((r) => r.d);
    assert.ok(!days.includes("2026-01-10") && !days.includes("2026-01-11"));
    assert.equal(stats.dropped_weekend, 2);
  });

  it("keeps a legitimate unchanged-close day (does NOT mistake a flat day for a synthetic fill)", () => {
    // A real flat close must survive — silently deleting equal-to-prior bars would corrupt the series.
    const { rows } = reconcileSeries("AAA", {
      yahoo: S(["2026-01-20", "2026-01-21", "2026-01-22"], [100, 100, 102]),
    });
    assert.deepEqual(rows.map((r) => r.d), ["2026-01-20", "2026-01-21", "2026-01-22"]);
  });
});

describe("history-reconcile: anomaly (weird-jump) screening", () => {
  it("drops an UNcorroborated implausible spike (bad bar), keeps the clean series", () => {
    const { rows, stats } = reconcileSeries("AAA", {
      yahoo: S(["2026-02-02", "2026-02-03", "2026-02-04"], [100, 1000, 101]), // 10x spike on the 3rd, single source
    });
    assert.deepEqual(rows.map((r) => r.d), ["2026-02-02", "2026-02-04"]);
    assert.equal(stats.dropped_jump, 1);
  });

  it("KEEPS a SUSTAINED large move that holds (real deal/earnings gap, single source) — no truncation", () => {
    // The MP/NVTS bug: a real +60% day that stays up must NOT be dropped, and must NOT truncate the rest.
    const { rows, stats } = reconcileSeries("AAA", {
      yahoo: S(["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"], [100, 160, 162, 165]),
    });
    assert.deepEqual(rows.map((r) => r.d), ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"]);
    assert.equal(stats.dropped_jump, 0);
  });

  it("KEEPS a corroborated large move (real crash/split shows in every provider)", () => {
    const { rows } = reconcileSeries("AAA", {
      yahoo: S(["2026-02-02", "2026-02-03"], [100, 50]), stooq: S(["2026-02-02", "2026-02-03"], [100, 50.2]),
    });
    assert.equal(rows.length, 2); // both corroborated; the -50% is real, not dropped
    assert.equal(rows[1].corroborated, true);
  });
});

describe("history-reconcile: shape + safety", () => {
  it("rows are sorted ascending by date and carry ticker", () => {
    const { rows } = reconcileSeries("XYZ", { yahoo: S(["2026-01-06", "2026-01-05"], [10, 9]) });
    assert.deepEqual(rows.map((r) => r.d), ["2026-01-05", "2026-01-06"]);
    assert.equal(rows[0].ticker, "XYZ");
  });
  it("safe on empty / missing providers", () => {
    assert.deepEqual(reconcileSeries("X", {}).rows, []);
    assert.deepEqual(reconcileSeries("X", { yahoo: S([], []) }).rows, []);
  });
});
