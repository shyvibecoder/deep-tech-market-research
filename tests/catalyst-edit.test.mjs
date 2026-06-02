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
});

describe("catalyst-edit: catalystEditable (which fired triggers offer a draft PR)", () => {
  it("cut/trim with affected names → editable; deploy/none → not", () => {
    assert.deepEqual(catalystEditable({ watch: { edit: "cut", affects: ["MP"] } }), { edit: "cut", affects: ["MP"] });
    assert.equal(catalystEditable({ watch: { edit: "deploy", affects: ["GEV"] } }), null);
    assert.equal(catalystEditable({ watch: { queries: ["x"] } }), null);
    assert.equal(catalystEditable({}), null);
  });
});
