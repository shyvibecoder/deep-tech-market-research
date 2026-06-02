// COHERENCE PHASE — runs every loop round (and in CI). Verifies the app stays ONE
// coherent system, not a pile of features: the producer (scanner) and consumers
// (dashboard, schema) agree on the data contract, and cross-feature dependencies hold.
// Non-destructive: backs up/restores the web/data files the scan touches.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { acquireScanLock, releaseScanLock } from "./_scanlock.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const r = (f) => JSON.parse(readFileSync(root + "web/data/" + f));
const touched = ["signals.json", "scarcity-history.json", "seen.state.json", "dca.json", "forecasts.json"].map((f) => root + "web/data/" + f);
const baks = new Map();

before(() => {
  acquireScanLock(); // serialize vs pipeline.test.mjs — both rewrite the shared web/data/*.json (no race)
  for (const f of touched) if (existsSync(f)) { baks.set(f, f + ".cbak"); copyFileSync(f, f + ".cbak"); }
  execFileSync("node", ["scripts/scan.mjs", "--offline"], { cwd: root, stdio: "pipe" });
});
after(() => { for (const [orig, bak] of baks) { copyFileSync(bak, orig); execFileSync("rm", ["-f", bak]); } releaseScanLock(); });

describe("coherence: scanner emits every section the system depends on", () => {
  it("signals.json carries all cross-cutting sections", () => {
    const s = r("signals.json");
    for (const k of ["schema_version", "scanned_at", "quotes", "filings", "news", "trigger_status",
      "catalyst_watch", "alerts", "regime", "metrics", "scorecard", "scarcity_signals", "opportunities", "v23",
      "dislocation_entry", "chokepoints", "proxy_hubs", "data_quality", "digest", "errors"]) {
      assert.ok(k in s, `signals.json missing section: ${k}`);
    }
  });
  it("trigger_status entries expose met + fired (two-scan-confirmation contract)", () => {
    const ts = r("signals.json").trigger_status;
    for (const id of ["drawdown", "sleeve_cap", "trim_rule"]) {
      assert.ok("met" in ts[id] && "fired" in ts[id], `${id} missing met/fired`);
    }
  });
  it("regime exposes the v2 contract the dashboard reads", () => {
    const reg = r("signals.json").regime;
    for (const k of ["version", "posture", "per_name", "account_policy", "macro_available"]) {
      assert.ok(k in reg, `regime missing: ${k}`);
    }
  });
});

describe("coherence: cross-feature dependencies line up", () => {
  it("every deep-tech build-out scarcity has a scarcity_signals entry; diversifiers are excluded by design", () => {
    const sig = r("signals.json"), scar = r("scarcities.json");
    for (const sc of scar.scarcities) {
      const expected = sc.axis !== "diversifier"; // the Opportunity/de-rating machinery is deep-tech build-out-only
      assert.equal(sc.id in sig.scarcity_signals, expected,
        expected ? `no signal for deep-tech build-out scarcity ${sc.id}` : `diversifier ${sc.id} should NOT be scored by the deep-tech build-out machinery`);
    }
  });
  it("dca.json holdings exactly match portfolio holdings", () => {
    const dca = r("dca.json"), port = r("portfolio.json");
    assert.deepEqual(Object.keys(dca.holdings).sort(), port.holdings.map((h) => h.ticker).sort());
  });
  it("regime.per_name only references real holdings", () => {
    const port = new Set(r("portfolio.json").holdings.map((h) => h.ticker));
    for (const t of r("signals.json").regime.per_name) assert.ok(port.has(t.ticker), `per_name ghost ticker ${t.ticker}`);
  });
  it("every tradeable holding resolves (or errors) in quotes", () => {
    const s = r("signals.json");
    for (const h of r("portfolio.json").holdings) {
      if (/[()]/.test(h.ticker) || /^CASH/i.test(h.ticker)) continue;
      const q = s.quotes[h.ticker];
      assert.ok(q && (typeof q.price === "number" || typeof q.error === "string"), `${h.ticker} not in quotes`);
    }
  });
  it("open forecasts only reference real subjects (holdings for tilts, scarcity ids for relative calls)", () => {
    const port = new Set(r("portfolio.json").holdings.map((h) => h.ticker));
    const scar = new Set(r("scarcities.json").scarcities.map((s) => s.id));
    for (const f of r("forecasts.json").open) {
      if (f.type === "scarcity_rel") assert.ok(scar.has(f.subject), `forecast ghost scarcity ${f.subject}`);
      else if (f.type === "sizing_tilt") assert.equal(f.subject, "portfolio", `unexpected sizing_tilt subject ${f.subject}`); // whole-sleeve sizing call
      else assert.ok(port.has(f.subject), `forecast ghost subject ${f.subject}`);
    }
  });
});

describe("coherence: dashboard↔scanner field contract (no orphan reads)", () => {
  it("every DATA.sig.<field> the dashboard reads is a section the scanner emits", () => {
    const app = readFileSync(root + "web/app.js", "utf8");
    const emitted = new Set(Object.keys(r("signals.json")));
    const fields = new Set([...app.matchAll(/DATA\.sig\??\.(\w+)/g)].map((m) => m[1]));
    for (const f of fields) assert.ok(emitted.has(f), `app.js reads signals.${f} but the scanner never emits it`);
  });
  it("every diversifier carries the diversifier_evidence fields the radar renders", () => {
    const divs = r("scarcities.json").scarcities.filter((s) => s.axis === "diversifier");
    assert.ok(divs.length > 0, "expected at least one diversifier scarcity");
    for (const s of divs) {
      const e = s.diversifier_evidence;
      assert.ok(e, `${s.id}: missing diversifier_evidence (radar would show blank cells)`);
      for (const k of ["maxDD", "mktBeta", "buildoutBeta", "blend_with", "blend_maxDD", "blend_compRho"]) {
        assert.ok(k in e, `${s.id}: diversifier_evidence missing ${k} (the radar reads it)`);
      }
    }
  });
});

describe("coherence: shared math is single-source (no mirror drift)", () => {
  it("app.js's inline esc/safeUrl behave identically to web/sanitize.mjs", async () => {
    const { esc, safeUrl } = await import(new URL("../../web/sanitize.mjs", import.meta.url));
    const app = readFileSync(root + "web/app.js", "utf8");
    const grab = (name) => { const m = app.match(new RegExp(`const ${name} = (.+);`)); return eval(`(${m[1]})`); };
    const escApp = grab("esc"), safeApp = grab("safeUrl");
    for (const v of ['<img onerror="x">', `a&b"'`, null, "plain"]) assert.equal(escApp(v), esc(v), `esc drift on ${v}`);
    for (const v of ["javascript:alert(1)", "https://sec.gov/x", "http://n.io/a", null, "nope"]) assert.equal(safeApp(v), safeUrl(v), `safeUrl drift on ${v}`);
  });
});
