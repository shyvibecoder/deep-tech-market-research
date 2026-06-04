import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taxProfile, annualDragRate, afterTaxMultiple, optimizeLocation, locateAssets, rebalanceLocated, DEFAULT_TAX } from "../scripts/lib/asset-location.mjs";

const holds = [
  { ticker: "GEV", account: "ira", role: "Anchor — build-out", weight: 0.35 },                              // build-out: high growth, low yield, tactical
  { ticker: "PAVE", account: "taxable", role: "Anchor — reshoring", weight: 0.30 },                          // build-out: tax-efficient anchor
  { ticker: "FIW", account: "taxable", role: "Anchor — non-build-out de-correlator", weight: 0.20 },         // diversifier: dividend-heavy
  { ticker: "NEE", account: "ira", role: "Diversifier (2nd axis) — utilities", axis: "diversifier", weight: 0.15 },
];
const isBuildout = (t) => t === "GEV" || t === "PAVE";
const sleeveUsd = 600_000;

describe("asset-location: tax profile by axis/role", () => {
  it("diversifiers are dividend-heavy + low-growth; build-out is low-yield + higher-growth", () => {
    const div = taxProfile(holds[2]); // FIW
    const bld = taxProfile(holds[0]); // GEV
    assert.ok(div.yieldPct > bld.yieldPct, "diversifier yields more");
    assert.ok(bld.growth > div.growth, "build-out grows faster");
  });
  it("a tactical (IRA) name turns over more than a taxable anchor", () => {
    assert.ok(taxProfile(holds[0]).turnover > taxProfile(holds[1]).turnover);
  });
  it("annual drag rises with yield + turnover", () => {
    assert.ok(annualDragRate({ yieldPct: 0.03, turnover: 0.6 }) > annualDragRate({ yieldPct: 0.008, turnover: 0.1 }));
  });
});

describe("asset-location: after-tax terminal multiple (the optimizer's objective)", () => {
  const bld = taxProfile(holds[0]), div = taxProfile(holds[2]);
  it("Roth beats Traditional for the SAME asset (Traditional takes the ordinary-rate haircut)", () => {
    assert.ok(afterTaxMultiple(bld, "roth") > afterTaxMultiple(bld, "traditional"));
  });
  it("the Roth growth benefit (vs taxable) is LARGER for the higher-growth name → growth wins scarce Roth", () => {
    const bldPrem = afterTaxMultiple(bld, "roth") - afterTaxMultiple(bld, "taxable");
    const divPrem = afterTaxMultiple(div, "roth") - afterTaxMultiple(div, "taxable");
    assert.ok(bldPrem > divPrem, `build-out Roth premium ${bldPrem.toFixed(3)} should exceed diversifier ${divPrem.toFixed(3)}`);
  });
  it("a longer horizon widens the Roth-vs-taxable gap (compounding)", () => {
    const g10 = afterTaxMultiple(bld, "roth", { horizonYears: 10 }) - afterTaxMultiple(bld, "taxable", { horizonYears: 10 });
    const g30 = afterTaxMultiple(bld, "roth", { horizonYears: 30 }) - afterTaxMultiple(bld, "taxable", { horizonYears: 30 });
    assert.ok(g30 > g10);
  });
});

describe("asset-location: optimizeLocation is the true optimum (transportation LP)", () => {
  it("never exceeds capacity and places all value when capacity is sufficient", () => {
    const items = [{ key: "A", value: 100, mult: { roth: 2.0, taxable: 1.5 } }, { key: "B", value: 100, mult: { roth: 1.1, taxable: 1.0 } }];
    const { rows } = optimizeLocation(items, { roth: 100, taxable: 100 });
    const used = (a) => rows.filter((r) => r.account === a).reduce((s, r) => s + r.value, 0);
    assert.ok(used("roth") <= 100 + 1e-6 && used("taxable") <= 100 + 1e-6);
    assert.ok(Math.abs(rows.reduce((s, r) => s + r.value, 0) - 200) < 1e-6, "all value placed");
  });
  it("puts the highest-premium asset in the scarce account (known optimum)", () => {
    const items = [{ key: "A", value: 100, mult: { roth: 2.0, taxable: 1.5 } }, { key: "B", value: 100, mult: { roth: 1.1, taxable: 1.0 } }];
    const { rows, objective } = optimizeLocation(items, { roth: 100, taxable: 100 });
    assert.ok(rows.some((r) => r.key === "A" && r.account === "roth" && Math.abs(r.value - 100) < 1e-6));
    assert.ok(rows.some((r) => r.key === "B" && r.account === "taxable" && Math.abs(r.value - 100) < 1e-6));
    assert.ok(Math.abs(objective - 300) < 1e-6);
  });
  it("reports unplaced overflow when total value exceeds total capacity", () => {
    const { rows, unplaced } = optimizeLocation([{ key: "A", value: 100, mult: { roth: 2 } }], { roth: 60 });
    assert.ok(Math.abs(rows.reduce((s, r) => s + r.value, 0) - 60) < 1e-6);
    assert.ok(Math.abs(unplaced.A - 40) < 1e-6);
  });
  it("[CRITICAL regression] does not strand a placeable item in overflow (no IEEE-754 SINK absorption)", () => {
    // Audit repro: with a -1e18 SINK penalty the cross-SINK swap gain rounded to 0, dumping i1 (which loves
    // taxable@4.59) entirely into overflow for objective 127.99 — far below a random feasible 196.82.
    const { rows, objective } = optimizeLocation(
      [{ key: "i0", value: 48, mult: { roth: 4.07, traditional: 4.52, taxable: 1.26 } },
       { key: "i1", value: 31, mult: { roth: 2.73, traditional: 3.55, taxable: 4.59 } }],
      { roth: 11, traditional: 12, taxable: 23 });
    assert.ok(objective > 196.82, `objective ${objective.toFixed(2)} should beat the random-feasible 196.82`);
    assert.ok(rows.some((r) => r.key === "i1" && r.account === "taxable"), "i1 must occupy its best real account, not overflow");
  });
  it("[OPTIMALITY] beats every random feasible allocation — including the overflow (needs-new-cash) regime", () => {
    const rnd = (seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(42);
    const accts = ["roth", "traditional", "taxable"];
    for (let trial = 0; trial < 120; trial++) {
      const nItems = 2 + Math.floor(rnd() * 4);
      const items = Array.from({ length: nItems }, (_, i) => ({ key: "i" + i, value: 10 + Math.floor(rnd() * 90), mult: Object.fromEntries(accts.map((a) => [a, 1 + rnd() * 4])) }));
      const totalVal = items.reduce((s, it) => s + it.value, 0);
      // Half the trials UNDER-fund capacity (SINK active → overflow), half over-fund (everything placeable).
      const overflow = trial % 2 === 0;
      const target = overflow ? totalVal * (0.4 + rnd() * 0.4) : totalVal + 10;
      const raw = accts.map(() => rnd()); const rsum = raw.reduce((a, b) => a + b, 0);
      const caps = Object.fromEntries(accts.map((a, k) => [a, Math.max(1, Math.round((raw[k] / rsum) * target))]));
      const totalCap = accts.reduce((s, a) => s + caps[a], 0);
      const { rows, objective } = optimizeLocation(items, caps);
      // feasibility: never over capacity; placed total = min(value, capacity)
      for (const a of accts) assert.ok(rows.filter((r) => r.account === a).reduce((s, r) => s + r.value, 0) <= caps[a] + 1e-6, "capacity respected");
      assert.ok(Math.abs(rows.reduce((s, r) => s + r.value, 0) - Math.min(totalVal, totalCap)) < 1e-2, "fills exactly min(value,capacity)");
      // optimality: no random feasible allocation does better (random pours items into real caps; overflow scores 0)
      let bestRandom = -Infinity;
      for (let s = 0; s < 600; s++) {
        const slack = { ...caps }; let obj = 0;
        for (const it of [...items].sort(() => rnd() - 0.5)) {
          let left = it.value;
          for (const a of [...accts].sort(() => rnd() - 0.5)) { const amt = Math.min(left, slack[a]); slack[a] -= amt; left -= amt; obj += amt * it.mult[a]; if (left <= 0) break; }
        }
        if (obj > bestRandom) bestRandom = obj;
      }
      assert.ok(objective >= bestRandom - 1e-6, `trial ${trial} (${overflow ? "overflow" : "slack"}): optimizer ${objective.toFixed(2)} < random ${bestRandom.toFixed(2)}`);
    }
  });
  it("[OPTIMALITY] matches an EXACT brute-force optimum on small integer cases (slack + overflow)", () => {
    const accts = ["roth", "traditional", "taxable"];
    const brute = (items, caps) => { // exhaustive over integer allocations
      let best = -Infinity;
      const rec = (i, rem, obj) => {
        if (i === items.length) { best = Math.max(best, obj); return; }
        const dist = (ai, left, o, r) => {
          const a = accts[ai];
          if (ai === accts.length - 1) { if (left <= r[a]) rec(i + 1, { ...r, [a]: r[a] - left }, o + left * (items[i].mult[a] ?? -1)); return; }
          for (let put = 0; put <= Math.min(left, r[a]); put++) dist(ai + 1, left - put, o + put * (items[i].mult[a] ?? -1), { ...r, [a]: r[a] - put });
        };
        dist(0, items[i].value, obj, rem);
      };
      rec(0, { ...caps }, 0); return best;
    };
    const rnd = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(7);
    for (let t = 0; t < 50; t++) {
      const ni = 2 + Math.floor(rnd() * 2);
      const items = Array.from({ length: ni }, (_, i) => ({ key: "i" + i, value: 2 + Math.floor(rnd() * 5), mult: Object.fromEntries(accts.map((a) => [a, +(1 + rnd() * 4).toFixed(2)])) }));
      const tv = items.reduce((s, it) => s + it.value, 0);
      const target = rnd() < 0.5 ? Math.max(1, Math.round(tv * (0.4 + rnd() * 0.4))) : tv + 3; // overflow vs slack
      const raw = accts.map(() => rnd()); const rs = raw.reduce((a, b) => a + b, 0);
      const caps = Object.fromEntries(accts.map((a, k) => [a, Math.max(1, Math.round(raw[k] / rs * target))]));
      assert.ok(optimizeLocation(items, caps).objective >= brute(items, caps) - 1e-6, `trial ${t}: below brute-force optimum`);
    }
  });
});

describe("asset-location: 3-way placement (Roth ← growth, Traditional ← income, taxable ← efficient)", () => {
  // Matched totals (caps sum to the sleeve) — the real deploy fills every account.
  const cap = { roth: 200_000, traditional: 200_000, taxable: 200_000 };
  const r = locateAssets(holds, { capacities: cap, sleeveUsd, horizonYears: 20 });
  it("uses the 3-way split when Roth AND Traditional balances are given", () => assert.equal(r.three_way, true));
  it("Roth is filled with the highest-after-tax-growth names (build-out), not the low-growth diversifiers", () => {
    const roth = r.rows.filter((x) => x.account === "roth");
    assert.ok(roth.length && roth.every((x) => isBuildout(x.ticker)), "only build-out in Roth");
    assert.ok(roth.some((x) => x.ticker === "GEV"), "the top-growth name is sheltered in Roth");
  });
  it("shelters the dividend-heavy diversifiers in Traditional (least-bad there vs taxable)", () => {
    const trad = r.rows.filter((x) => x.account === "traditional");
    assert.ok(trad.length && trad.some((x) => x.ticker === "FIW" || x.ticker === "NEE"));
  });
  it("never exceeds any account's capacity (fractional fill)", () => {
    for (const a of Object.keys(cap)) {
      const used = r.rows.filter((x) => x.account === a).reduce((s, x) => s + x.value, 0);
      assert.ok(used <= cap[a] + 2, `${a} used ${used} > cap ${cap[a]}`);
    }
  });
  it("deploys the whole sleeve", () => {
    assert.ok(Math.abs(r.rows.reduce((s, x) => s + x.value, 0) - sleeveUsd) < 5);
  });
  it("[H1] folds pre-tax IRA capacity into Traditional in 3-way mode (doesn't drop it)", () => {
    // Roth+Traditional+IRA all supplied → threeWay; the IRA room must be usable, not lost to overflow.
    const rIra = locateAssets(holds, { capacities: { roth: 100_000, traditional: 50_000, ira: 450_000, taxable: 0 }, sleeveUsd, horizonYears: 20 });
    assert.equal(rIra.three_way, true);
    const placed = rIra.rows.reduce((s, x) => s + x.value, 0);
    assert.ok(Math.abs(placed - sleeveUsd) < 5, `whole sleeve placed using IRA room (placed ${placed} of ${sleeveUsd})`);
    const tradUsed = rIra.rows.filter((x) => x.account === "traditional").reduce((s, x) => s + x.value, 0);
    assert.ok(tradUsed <= 50_000 + 450_000 + 2, "traditional capacity includes the folded IRA room");
    assert.ok(tradUsed > 50_000, "the IRA room is actually being used beyond the bare Traditional balance");
  });
  it("reports a positive after-tax uplift and a positive annual + horizon tax drag avoided", () => {
    assert.ok(r.summary.after_tax_uplift_usd > 0, "optimal location adds after-tax terminal value vs pro-rata");
    assert.ok(r.summary.annual_drag_avoided > 0);
    assert.ok(r.summary.horizon_drag_avoided > r.summary.annual_drag_avoided);
  });
  it("[B1] splits an oversized name across accounts instead of stranding tax-advantaged capacity", () => {
    const r2 = locateAssets([{ ticker: "BIG", account: "taxable", role: "build-out", weight: 1.0 }], { capacities: { roth: 30_000, traditional: 20_000, taxable: 10_000 }, sleeveUsd: 60_000 });
    const used = (a) => r2.rows.filter((x) => x.account === a).reduce((s, x) => s + x.value, 0);
    assert.ok(used("roth") <= 30_002 && used("traditional") <= 20_002 && used("taxable") <= 10_002, "no account over capacity");
    assert.ok(used("roth") > 0 && used("traditional") > 0, "tax-advantaged room used, not stranded");
    assert.ok(Math.abs(used("roth") + used("traditional") + used("taxable") - 60_000) < 3, "all cash deployed");
  });
});

describe("asset-location: 2-way fallback (no Roth/Traditional split yet)", () => {
  const r = locateAssets(holds, { capacities: { ira: 300_000, taxable: 300_000 }, sleeveUsd });
  it("falls back to a combined tax-advantaged bucket and flags it", () => {
    assert.equal(r.three_way, false);
    assert.match(r.summary.note, /Roth \+ Traditional/);
    assert.ok(r.rows.every((x) => x.account === "tax-advantaged" || x.account === "taxable"));
  });
  it("shelters a high-drag diversifier in the tax-advantaged bucket", () => {
    assert.ok(r.rows.some((x) => (x.ticker === "NEE" || x.ticker === "FIW") && x.account === "tax-advantaged"));
  });
});

describe("asset-location: tax-located REBALANCE (net held → buy + sell) [D2]", () => {
  const BLD = { ticker: "BLD", weight: 0.85, role: "build-out" };           // high growth, low yield
  const DIV = { ticker: "DIV", weight: 0.15, role: "non-build-out de-correlator" }; // low growth, high yield
  const cap = { roth: 100_000, traditional: 100_000, taxable: 100_000 };    // bookTotal 300k

  it("all-cash reduces to the deploy: all buys, no sells, sums to the book; growth→Roth, income→Traditional", () => {
    const r = rebalanceLocated([BLD, DIV], { held: {}, capacities: cap });
    assert.equal(r.summary.sell_usd, 0);
    assert.equal(r.summary.needs_new_cash_usd, 0);
    assert.ok(Math.abs(r.summary.buy_usd - 300_000) < 5);
    assert.ok(r.rows.some((x) => x.ticker === "BLD" && x.account === "roth" && x.action === "buy"));        // growth → Roth (biggest tax-free payoff)
    assert.ok(r.rows.some((x) => x.ticker === "DIV" && x.account === "traditional" && x.action === "buy")); // income → Traditional (least-bad vs taxable)
    assert.ok(!r.rows.some((x) => x.ticker === "DIV" && x.account === "taxable"));                          // dividends not stranded in taxable
  });
  it("an overweight tax-advantaged holding produces a TRIM (in-place, not blocked)", () => {
    const r = rebalanceLocated([{ ticker: "BLD", weight: 1.0 }], { held: { BLD: { traditional: 150_000 } }, capacities: { roth: 50_000, traditional: 50_000, taxable: 0 } }); // target 100k, held 150k
    const trim = r.rows.find((x) => x.ticker === "BLD" && x.action === "trim");
    assert.ok(trim && trim.account === "traditional" && Math.abs(trim.amount - 50_000) < 5);
    assert.ok(Math.abs(r.summary.sell_usd - 50_000) < 5);
  });
  it("a taxable overweight is BLOCKED (buy-and-hold anchor) unless its ticker is trim-OK", () => {
    const held = { BLD: { taxable: 150_000 } }, capacities = { roth: 60_000, traditional: 40_000, taxable: 0 }; // target 100k
    const blocked = rebalanceLocated([{ ticker: "BLD", weight: 1.0 }], { held, capacities });
    const row = blocked.rows.find((x) => x.ticker === "BLD" && x.account === "taxable");
    assert.ok(row.blocked && /anchor/.test(row.action));
    assert.equal(blocked.summary.sell_usd, 0);
    assert.ok(blocked.summary.blocked_usd > 0);
    const allowed = rebalanceLocated([{ ticker: "BLD", weight: 1.0 }], { held, capacities, taxableAnchorTrimOk: ["BLD"] });
    assert.ok(allowed.rows.some((x) => x.ticker === "BLD" && x.action === "trim" && !x.blocked));
  });
  it("an underweight name is BOUGHT and the buy is located into available room (no account over capacity)", () => {
    const r = rebalanceLocated([{ ticker: "BLD", weight: 0.5 }, { ticker: "DIV", weight: 0.5, role: "de-correlator" }],
      { held: { BLD: { taxable: 100_000 }, DIV: { taxable: 50_000 } }, capacities: { roth: 100_000, traditional: 100_000, taxable: 200_000 } });
    for (const a of ["roth", "traditional", "taxable"]) {
      const heldA = a === "taxable" ? 150_000 : 0;
      const boughtA = r.rows.filter((x) => x.account === a && x.action === "buy").reduce((s, x) => s + x.amount, 0);
      assert.ok(heldA + boughtA <= ({ roth: 100_000, traditional: 100_000, taxable: 200_000 })[a] + 5, `${a} over capacity`);
    }
    assert.ok(r.rows.some((x) => x.ticker === "BLD" && x.account === "roth" && x.action === "buy")); // new growth → Roth
  });
  it("a holding dropped from the plan is sold/exited", () => {
    const r = rebalanceLocated([{ ticker: "BLD", weight: 1.0 }], { held: { OLD: { roth: 50_000 } }, capacities: { roth: 100_000, traditional: 50_000, taxable: 0 } });
    assert.ok(r.rows.some((x) => x.ticker === "OLD" && /sell|not in plan/.test(x.action)));
  });
});
