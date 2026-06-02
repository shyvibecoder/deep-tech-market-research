import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCatalystEdit, catalystEditable } from "../web/catalyst-review.mjs";

const doc = () => ({ sleeve_usd: 1000000, holdings: [
  { ticker: "MP", weight: 0.10, role: "rare earths" },
  { ticker: "GEV", weight: 0.30, role: "turbines" },
  { ticker: "ASML", weight: 0.60, role: "litho" },
] });

describe("catalyst-edit: applyCatalystEdit (cut / trim → renormalized plan)", () => {
  it("cut drops the name and renormalizes the rest to sum 1", () => {
    const r = applyCatalystEdit(doc(), { edit: "cut", affects: ["MP"] });
    assert.ok(!r.holdings.some((h) => h.ticker === "MP"), "MP removed");
    assert.ok(Math.abs(r.holdings.reduce((a, h) => a + h.weight, 0) - 1) < 1e-3, "renormalized to 1");
    // GEV/ASML keep their 1:2 ratio (0.30:0.60 → 0.333:0.667)
    const gev = r.holdings.find((h) => h.ticker === "GEV").weight;
    assert.ok(Math.abs(gev - 1 / 3) < 0.01);
    assert.equal(r.holdings.find((h) => h.ticker === "GEV").target_usd, Math.round(gev * 1000000));
  });
  it("trim reduces the affected names by a third, then renormalizes", () => {
    const r = applyCatalystEdit(doc(), { edit: "trim", affects: ["GEV"] });
    assert.ok(r.holdings.some((h) => h.ticker === "GEV"), "GEV kept (trimmed, not cut)");
    assert.ok(Math.abs(r.holdings.reduce((a, h) => a + h.weight, 0) - 1) < 1e-3);
    // GEV pre-norm 0.30→0.20; others unchanged pre-norm → GEV share falls
    const gev = r.holdings.find((h) => h.ticker === "GEV").weight;
    assert.ok(gev < 0.30 && gev > 0.15);
  });
  it("multi-ticker trim handles a name not in the plan gracefully", () => {
    const r = applyCatalystEdit(doc(), { edit: "trim", affects: ["GEV", "SMNEY"] }); // SMNEY absent
    assert.ok(Math.abs(r.holdings.reduce((a, h) => a + h.weight, 0) - 1) < 1e-3);
  });
  it("no edit / no affects → unchanged", () => {
    assert.deepEqual(applyCatalystEdit(doc(), {}).holdings.length, 3);
    assert.deepEqual(applyCatalystEdit(doc(), { edit: "cut", affects: [] }).holdings.length, 3);
  });
  it("[H3] cutting an ABSENT name returns the SAME reference (no-op → no duplicate PR)", () => {
    const d = doc();
    assert.equal(applyCatalystEdit(d, { edit: "cut", affects: ["NOPE"] }), d); // same ref, not a fresh object
  });
  it("[M2] a build-out cut preserves the 85/15 axis split (doesn't inflate the diversifier sleeve)", () => {
    const d = { sleeve_usd: 1000000, holdings: [
      { ticker: "MP", weight: 0.10, role: "rare earths" },        // build-out
      { ticker: "GEV", weight: 0.25, role: "turbines" },          // build-out
      { ticker: "ASML", weight: 0.50, role: "litho" },            // build-out  (build-out total 0.85)
      { ticker: "KO", weight: 0.15, axis: "diversifier" },        // diversifier total 0.15
    ] };
    const r = applyCatalystEdit(d, { edit: "cut", affects: ["MP"] });
    const div = r.holdings.find((h) => h.ticker === "KO").weight;
    assert.ok(Math.abs(div - 0.15) < 0.01, `diversifier stayed ~15% (got ${div})`);
    const bld = r.holdings.filter((h) => h.ticker !== "KO").reduce((a, h) => a + h.weight, 0);
    assert.ok(Math.abs(bld - 0.85) < 0.01, `build-out stayed ~85% (got ${bld})`);
  });
  it("[M2-edge] cutting the ONLY diversifier still sums to 1 (freed weight not lost)", () => {
    const d = { sleeve_usd: 1000000, holdings: [
      { ticker: "MP", weight: 0.50, role: "rare earths" },
      { ticker: "ASML", weight: 0.35, role: "litho" },
      { ticker: "KO", weight: 0.15, axis: "diversifier" }, // the only diversifier
    ] };
    const r = applyCatalystEdit(d, { edit: "cut", affects: ["KO"] });
    assert.ok(!r.holdings.some((h) => h.ticker === "KO"));
    assert.ok(Math.abs(r.holdings.reduce((a, h) => a + h.weight, 0) - 1) < 1e-3, "still sums to 1 (global renorm fallback)");
    assert.ok(Math.abs(r.holdings.reduce((a, h) => a + h.target_usd, 0) - 1000000) < 1500, "target_usd ~ full sleeve");
  });
  it("[M1] never emits an empty plan (cutting the whole book → unchanged)", () => {
    const d = { sleeve_usd: 1e6, holdings: [{ ticker: "MP", weight: 0.6 }, { ticker: "GEV", weight: 0.4 }] };
    assert.equal(applyCatalystEdit(d, { edit: "cut", affects: ["MP", "GEV"] }), d); // refused → same ref
  });
});

describe("catalyst-edit: catalystEditable (which fired triggers offer a draft PR)", () => {
  it("cut/trim with affected names → editable; deploy/none → not", () => {
    assert.deepEqual(catalystEditable({ watch: { edit: "cut", affects: ["MP"] } }), { edit: "cut", affects: ["MP"] });
    assert.equal(catalystEditable({ watch: { edit: "deploy", affects: ["GEV"] } }), null);
    assert.equal(catalystEditable({ watch: { queries: ["x"] } }), null);
    assert.equal(catalystEditable({}), null);
  });
});
