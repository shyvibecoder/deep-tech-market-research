import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { scheduleFor, buildDcaPlan } from "../scripts/lib/dca.mjs";
import { updateScarcityHistory, applySeenState } from "../scripts/lib/history.mjs";

describe("dca: tier schedules sum to target", () => {
  for (const [tier, t] of [["A", 100000], ["B", 90000], ["C", 150000], ["D", 15000]]) {
    it(`${tier} schedule sums to its target`, () => {
      const sum = Object.values(scheduleFor(tier, t)).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - t) <= 1);
    });
  }
  it("DRY deploys nothing now", () => assert.equal(scheduleFor("DRY", 50000).now, 0));
  it("buildDcaPlan keys by ticker with a schedule", () => {
    const plan = buildDcaPlan({ holdings: [{ ticker: "MU", tier: "B", target_usd: 90000, account: "ira" }] }, "2026-05-30");
    assert.ok(plan.holdings.MU.schedule.now === 45000);
  });
});

describe("history: scarcity drift is append-only and change-only (F4)", () => {
  const f = join(tmpdir(), `puck-hist-${Date.now()}.json`);
  after(() => { try { rmSync(f); } catch {} });
  const scar = (priced) => [{ id: "enrichment", priced_in: priced, bind_window: "2028-29", non_consensus: true }];
  it("records one snapshot on first run, none when unchanged, a new one + drift on change", () => {
    updateScarcityHistory(f, scar("crowded"), "2026-05-01");
    const r2 = updateScarcityHistory(f, scar("crowded"), "2026-05-02"); // unchanged
    assert.equal(Object.keys(r2.drift).length, 0);
    const r3 = updateScarcityHistory(f, scar("low"), "2026-06-01");     // changed
    assert.ok(r3.drift.enrichment);
    assert.deepEqual(r3.drift.enrichment.priced_in, ["crowded", "low"]);
  });
});

describe("history: seen-state marks new items once (F7)", () => {
  const f = join(tmpdir(), `puck-seen-${Date.now()}.json`);
  after(() => { try { rmSync(f); } catch {} });
  it("flags is_new on first sight, not on the next run", () => {
    const filings = [{ ticker: "MU", form: "8-K", date: "2026-05-30" }];
    const a = applySeenState(f, { filings, news: [], triggerStatus: {}, today: "2026-05-30" });
    assert.equal(a.newFilings, 1);
    assert.equal(filings[0].is_new, true);
    const filings2 = [{ ticker: "MU", form: "8-K", date: "2026-05-30" }];
    const b = applySeenState(f, { filings: filings2, news: [], triggerStatus: {}, today: "2026-05-31" });
    assert.equal(b.newFilings, 0);
    assert.equal(filings2[0].is_new, false);
  });
});
