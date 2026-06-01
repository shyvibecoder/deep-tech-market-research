import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { updateScarcityHistory, applySeenState } from "../scripts/lib/history.mjs";

// Audit P6: append-only history must FAIL LOUD on a corrupt-but-existing file, not silently reset to
// empty and overwrite (permanent wipe). A MISSING file is fine (first run → fallback).
describe("history: corrupt-file fail-loud (P6)", () => {
  const dir = mkdtempSync(join(tmpdir(), "puck-hist-"));
  const url = (name) => pathToFileURL(join(dir, name));
  const scarcities = [{ id: "x", priced_in: "low", bind_window: "2027", non_consensus: true }];

  it("a MISSING file is a first-run fallback (no throw)", () => {
    const r = updateScarcityHistory(url("missing.json"), scarcities, "2026-06-01");
    assert.ok(r && typeof r.drift === "object");
  });
  it("a CORRUPT scarcity-history file THROWS instead of wiping", () => {
    const f = join(dir, "corrupt.json"); writeFileSync(f, "{ this is not json ");
    assert.throws(() => updateScarcityHistory(pathToFileURL(f), scarcities, "2026-06-01"), /corrupt|refusing to overwrite/i);
  });
  it("a CORRUPT seen-state file THROWS instead of wiping", () => {
    const f = join(dir, "corrupt-seen.json"); writeFileSync(f, "not json at all");
    assert.throws(() => applySeenState(pathToFileURL(f), { filings: [], news: [], triggerStatus: {}, today: "2026-06-01" }), /corrupt|refusing to overwrite/i);
  });

  it("cleanup", () => { rmSync(dir, { recursive: true, force: true }); assert.ok(true); });
});
