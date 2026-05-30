// E2E: (1) static contract — the dashboard JS only queries elements that exist, every
// tab has a section, and every help "?" has a registry entry; (2) serve smoke — boot a
// static server over web/ and fetch the page + assets + data, asserting the contract
// the browser app depends on. No browser/deps (sandbox-friendly); a full Playwright DOM
// pass is queued in TODO for CI where a browser is available.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../web/", import.meta.url));
const html = readFileSync(web + "index.html", "utf8");
const appjs = readFileSync(web + "app.js", "utf8");
const optui = readFileSync(web + "options-ui.js", "utf8");
const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));

describe("e2e: static HTML↔JS contract", () => {
  it("every $(\"#id\") selector in app.js + options-ui.js exists in index.html", () => {
    for (const js of [appjs, optui]) {
      for (const m of js.matchAll(/\$\("#([\w-]+)"\)/g)) assert.ok(ids.has(m[1]), `missing #${m[1]} in HTML`);
    }
  });
  it("every nav tab has a matching <section> id", () => {
    for (const m of html.matchAll(/data-tab="([\w-]+)"/g)) assert.ok(ids.has(m[1]), `tab ${m[1]} has no section`);
  });
  it("every help \"?\" has a HELP registry entry — incl. ones injected dynamically by app.js", () => {
    const keys = new Set([...appjs.matchAll(/^\s{2}(\w+): \{ title:/gm)].map((m) => m[1]));
    // Cover BOTH the static HTML buttons AND the data-help="..." strings rendered from app.js,
    // so a new in-app "?" can never ship without its help page (the guarantee behind "keep the
    // help pages in sync"). Dynamic refs are template literals: data-help=\"alpha\" etc.
    const refs = new Set([
      ...[...html.matchAll(/data-help="(\w+)"/g)].map((m) => m[1]),
      ...[...appjs.matchAll(/data-help="(\w+)"/g)].map((m) => m[1]),
    ]);
    for (const k of refs) assert.ok(keys.has(k), `no HELP entry for "${k}"`);
  });
});

describe("e2e: static server serves the dashboard + data contract", () => {
  let server, base;
  before(async () => {
    server = createServer((req, res) => {
      const p = (req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]);
      const file = web + p.replace(/^\//, "");
      if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("nf"); }
      const ct = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" }[extname(file)] || "text/plain";
      res.writeHead(200, { "content-type": ct }); res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it("serves index.html, app.js and options.mjs (200)", async () => {
    assert.match(await (await fetch(base + "/")).text(), /Puck/);
    assert.equal((await fetch(base + "/app.js")).status, 200);
    assert.equal((await fetch(base + "/options.mjs")).status, 200);
  });
  it("serves all data files as valid JSON with the fields the app reads", async () => {
    for (const f of ["scarcities", "portfolio", "triggers", "signals"]) {
      const r = await fetch(`${base}/data/${f}.json`);
      assert.equal(r.status, 200);
      const j = await r.json();
      if (f === "signals") for (const k of ["quotes", "trigger_status", "regime"]) assert.ok(k in j, `signals.${k}`);
      if (f === "scarcities") assert.ok(Array.isArray(j.scarcities));
    }
  });
});
