// Integration: run the REAL scanner (offline) end-to-end and assert the generated
// artifacts + invariants, then run the CI selfcheck as a subprocess. Non-destructive:
// backs up and restores the committed web/data files it touches.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { acquireScanLock, releaseScanLock } from "./_scanlock.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
// All tracked files the offline scan writes MUST be backed up/restored, else the test mutates the repo
// (F10: forecasts.json was missing → its "updated" date leaked into git after every run).
const dataFiles = ["signals.json", "scarcity-history.json", "seen.state.json", "dca.json", "forecasts.json"].map((f) => root + "web/data/" + f);
const backups = new Map();
const read = (f) => JSON.parse(readFileSync(root + "web/data/" + f));

before(() => {
  acquireScanLock(); // serialize vs coherence.test.mjs — both rewrite the shared web/data/*.json (no race)
  for (const f of dataFiles) if (existsSync(f)) { backups.set(f, f + ".bak"); copyFileSync(f, f + ".bak"); }
  execFileSync("node", ["scripts/scan.mjs", "--offline"], { cwd: root, stdio: "pipe" });
});
after(() => { for (const [orig, bak] of backups) { copyFileSync(bak, orig); execFileSync("rm", ["-f", bak]); } releaseScanLock(); });

describe("integration: offline scan pipeline", () => {
  it("writes a schema-valid signals.json with the expected sections", () => {
    const s = read("signals.json");
    for (const k of ["schema_version", "scanned_at", "quotes", "trigger_status", "regime", "data_quality", "errors"]) assert.ok(k in s, `missing ${k}`);
  });
  it("marks data quality DEGRADED offline and HOLDS the auto-triggers (fail-safe)", () => {
    const s = read("signals.json");
    assert.equal(s.data_quality.ok, false);
    assert.equal(s.trigger_status.drawdown.fired, false);
    assert.equal(s.trigger_status.sleeve_cap.fired, false);
  });
  it("resolves or errors every tradeable portfolio ticker (no silent drops)", () => {
    const s = read("signals.json");
    for (const h of read("portfolio.json").holdings) {
      if (/[()]/.test(h.ticker) || /^CASH/i.test(h.ticker)) continue;
      const q = s.quotes[h.ticker];
      assert.ok(q && (typeof q.price === "number" || typeof q.error === "string"), `${h.ticker} not resolved/errored`);
    }
  });
  it("regenerates scarcity-history, seen-state and a DCA plan", () => {
    assert.ok(Object.keys(read("scarcity-history.json").history).length > 0);
    assert.ok("filings" in read("seen.state.json"));
    assert.ok(read("dca.json").holdings.PAVE.schedule.now > 0);
  });
  it("passes the CI selfcheck (schemas + options math)", () => {
    const out = execFileSync("node", ["scripts/selfcheck.mjs"], { cwd: root, encoding: "utf8" });
    assert.match(out, /selfcheck OK/);
  });
});
