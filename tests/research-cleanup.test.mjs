import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planCleanup, parseAcceptBranch } from "../scripts/lib/research-cleanup.mjs";

const day = 24 * 3600 * 1000;
const now = Date.parse("2026-05-31T00:00:00Z");
const pr = (number, branch, daysAgo) => ({ number, headRef: branch, created_at: new Date(now - daysAgo * day).toISOString() });

describe("research-cleanup: parseAcceptBranch", () => {
  it("extracts the scarcity id from a research-accept branch", () => {
    assert.equal(parseAcceptBranch("research-accept/gallium-abc123").id, "gallium");
    assert.equal(parseAcceptBranch("research-accept/manipulation-data-x9z").id, "manipulation-data"); // hyphenated id
  });
  it("returns null for branches the bot didn't open (never touch those)", () => {
    assert.equal(parseAcceptBranch("feature/my-work"), null);
    assert.equal(parseAcceptBranch("main"), null);
    assert.equal(parseAcceptBranch("research-accept/"), null);
  });
});

describe("research-cleanup: planCleanup (which open accept-PRs to close + why)", () => {
  it("ignores PRs whose branch isn't a research-accept/* branch", () => {
    const plan = planCleanup([{ number: 1, headRef: "feature/x", created_at: new Date(now).toISOString() }], { now, maxAgeDays: 60 });
    assert.equal(plan.length, 0);
  });

  it("SUPERSEDES older PRs for the same scarcity, keeping only the newest", () => {
    const prs = [pr(10, "research-accept/gallium-old", 20), pr(11, "research-accept/gallium-new", 2), pr(12, "research-accept/optical-x", 3)];
    const plan = planCleanup(prs, { now, maxAgeDays: 60 });
    const sup = plan.filter((p) => p.reason === "superseded");
    assert.deepEqual(sup.map((p) => p.number), [10]);          // only the older gallium
    assert.ok(!plan.some((p) => p.number === 11));             // newest gallium kept
    assert.ok(!plan.some((p) => p.number === 12));             // lone optical kept
    assert.match(sup[0].detail, /#11/);                        // names the PR that supersedes it
  });

  it("closes PRs older than maxAgeDays as STALE (abandoned)", () => {
    const prs = [pr(20, "research-accept/copper-a", 90), pr(21, "research-accept/cobalt-b", 10)];
    const plan = planCleanup(prs, { now, maxAgeDays: 60 });
    assert.deepEqual(plan.filter((p) => p.reason === "stale").map((p) => p.number), [20]);
    assert.ok(!plan.some((p) => p.number === 21));            // recent one kept
  });

  it("does not double-list a PR that is BOTH superseded and stale (superseded wins, listed once)", () => {
    const prs = [pr(30, "research-accept/lithium-old", 90), pr(31, "research-accept/lithium-new", 1)];
    const plan = planCleanup(prs, { now, maxAgeDays: 60 });
    assert.equal(plan.filter((p) => p.number === 30).length, 1);
    assert.equal(plan.find((p) => p.number === 30).reason, "superseded");
  });

  it("is safe on empty input and respects a custom maxAgeDays", () => {
    assert.deepEqual(planCleanup([], { now, maxAgeDays: 60 }), []);
    const prs = [pr(40, "research-accept/zinc-a", 40)];
    assert.equal(planCleanup(prs, { now, maxAgeDays: 30 }).length, 1);   // 40d > 30d → stale
    assert.equal(planCleanup(prs, { now, maxAgeDays: 60 }).length, 0);   // 40d < 60d → kept
  });

  it("each plan item carries number + reason + a human detail for the close comment", () => {
    const plan = planCleanup([pr(50, "research-accept/tin-a", 90)], { now, maxAgeDays: 60 });
    assert.equal(plan[0].number, 50);
    assert.equal(plan[0].reason, "stale");
    assert.match(plan[0].detail, /60 days|abandoned|stale/i);
  });
});
