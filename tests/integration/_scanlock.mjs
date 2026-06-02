// Cross-process advisory lock for the integration tests that run the REAL scanner offline. node:test runs
// test FILES in separate processes concurrently, and both pipeline.test.mjs and coherence.test.mjs run
// `scripts/scan.mjs --offline`, which rewrites the SHARED web/data/*.json. Without serialization, one file's
// after()-restore can clobber the other's scan output mid-read (e.g. data_quality.ok flips back to the
// committed online value) — a genuine race. Each file holds this lock from its before() (scan) through its
// after() (restore), so the two never overlap on the shared files. mkdirSync is atomic, so it's the lock
// primitive; a stale lock (crashed holder) is stolen after STALE_MS.
import { mkdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lockDir = fileURLToPath(new URL("../../web/data/.scan.lock", import.meta.url));
const STALE_MS = 120_000;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function acquireScanLock() {
  for (let waited = 0; ; waited += 50) {
    try { mkdirSync(lockDir); return; } // atomic create → we hold it
    catch {
      try { if (Date.now() - statSync(lockDir).mtimeMs > STALE_MS) { rmSync(lockDir, { recursive: true, force: true }); continue; } } catch { /* gone — retry */ }
      sleepSync(50);
    }
  }
}

export function releaseScanLock() { try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* already gone */ } }
