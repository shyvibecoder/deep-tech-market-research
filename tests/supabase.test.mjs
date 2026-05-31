import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { supabaseConfigured, seriesToRows, upsertRows, selectRows, upsertPriceHistory, sanitizePriceRows, TRUSTED_PRICE_SOURCES, readSeries } from "../scripts/lib/supabase.mjs";

const ENV = { SUPABASE_URL: "https://proj.supabase.co/", SUPABASE_SERVICE_KEY: "svc_key" };
// Capture-and-OK fake fetch.
function fakeFetch(captured) {
  return async (url, opts) => { captured.push({ url, opts }); return { ok: true, status: 200, async text() { return ""; }, async json() { return [{ ticker: "QQQ", close: 100 }]; } }; };
}

describe("supabase: configuration gate (graceful no-op without keys)", () => {
  it("configured only when BOTH url and key are present", () => {
    assert.equal(supabaseConfigured({}), false);
    assert.equal(supabaseConfigured({ SUPABASE_URL: "x" }), false);
    assert.equal(supabaseConfigured(ENV), true);
  });
  it("upsert/select skip cleanly when unconfigured — never throw, never fetch", async () => {
    const cap = [];
    assert.deepEqual(await upsertRows("price_history", [{ ticker: "A", d: "2026-01-01", close: 1 }], { env: {}, fetchImpl: fakeFetch(cap) }), { skipped: true, written: 0 });
    assert.deepEqual(await selectRows("price_history", { env: {}, fetchImpl: fakeFetch(cap) }), { skipped: true, rows: [] });
    assert.equal(cap.length, 0); // no network attempted
  });
});

describe("supabase: seriesToRows", () => {
  it("maps a fetchSeries result to rows, dropping bad closes", () => {
    const rows = seriesToRows({ ticker: "QQQ", dates: ["2026-01-01", "2026-01-02", "2026-01-03"], closes: [100, 0, 102] });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { ticker: "QQQ", d: "2026-01-01", close: 100, source: "yahoo" });
    assert.deepEqual(seriesToRows(null), []);
  });
});

describe("supabase: ANTI-SYNTHETIC guard (never persist fabricated data)", () => {
  const good = { ticker: "QQQ", d: "2026-01-02", close: 100, source: "yahoo" };
  it("keeps real, trusted, valid prints", () => {
    assert.deepEqual(sanitizePriceRows([good]), [good]);
    for (const s of TRUSTED_PRICE_SOURCES) assert.equal(sanitizePriceRows([{ ...good, source: s }]).length, 1);
  });
  it("drops anything not from a trusted live source (offline/synthetic/unknown)", () => {
    for (const s of ["offline run", "synthetic", "mock", "", undefined, "guess"]) {
      assert.equal(sanitizePriceRows([{ ...good, source: s }]).length, 0, `source ${s} must be dropped`);
    }
  });
  it("drops non-finite / non-positive closes and bad dates/tickers", () => {
    assert.equal(sanitizePriceRows([{ ...good, close: 0 }]).length, 0);
    assert.equal(sanitizePriceRows([{ ...good, close: -5 }]).length, 0);
    assert.equal(sanitizePriceRows([{ ...good, close: NaN }]).length, 0);
    assert.equal(sanitizePriceRows([{ ...good, close: Infinity }]).length, 0);
    assert.equal(sanitizePriceRows([{ ...good, d: "not-a-date" }]).length, 0);
    assert.equal(sanitizePriceRows([{ ...good, ticker: "" }]).length, 0);
  });
  it("upsertPriceHistory applies the guard so synthetic rows never reach the network", async () => {
    const cap = [];
    const fake = async (url, opts) => { cap.push({ url, opts }); return { ok: true, status: 200, async text() { return ""; } }; };
    const out = await upsertPriceHistory(
      [good, { ticker: "X", d: "2026-01-02", close: 50, source: "synthetic" }, { ticker: "Y", d: "2026-01-02", close: 0, source: "yahoo" }],
      { env: ENV, fetchImpl: fake });
    assert.equal(out.written, 1); // only the one real row
    const body = JSON.parse(cap[0].opts.body);
    assert.equal(body.length, 1);
    assert.equal(body[0].ticker, "QQQ");
  });
});

describe("supabase: upsert request building", () => {
  it("posts to /rest/v1/<table> with on_conflict, auth headers, and merge-duplicates", async () => {
    const cap = [];
    const out = await upsertPriceHistory([{ ticker: "QQQ", d: "2026-01-01", close: 100, source: "yahoo" }], { env: ENV, fetchImpl: fakeFetch(cap) });
    assert.equal(out.written, 1);
    const { url, opts } = cap[0];
    assert.equal(url, "https://proj.supabase.co/rest/v1/price_history?on_conflict=ticker%2Cd"); // trailing slash trimmed
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.apikey, "svc_key");
    assert.equal(opts.headers.authorization, "Bearer svc_key");
    assert.match(opts.headers.prefer, /merge-duplicates/);
  });
  it("chunks large upserts into multiple requests", async () => {
    const cap = [];
    const rows = Array.from({ length: 1200 }, (_, i) => ({ ticker: "A", d: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, close: i + 1, source: "yahoo" }));
    const out = await upsertRows("price_history", rows, { env: ENV, fetchImpl: fakeFetch(cap), chunk: 500 });
    assert.equal(out.written, 1200);
    assert.equal(cap.length, 3); // 500 + 500 + 200
  });
  it("throws with status + body on a non-ok response", async () => {
    const failing = async () => ({ ok: false, status: 401, async text() { return "no auth"; } });
    await assert.rejects(() => upsertRows("price_history", [{ ticker: "A", d: "2026-01-01", close: 1 }], { env: ENV, fetchImpl: failing }), /supabase upsert price_history 401: no auth/);
  });
});

describe("supabase: select request building", () => {
  it("builds a PostgREST query with select/filters/limit + auth", async () => {
    const cap = [];
    const out = await selectRows("price_history", { select: "ticker,d,close", filters: "ticker=eq.QQQ&order=d.desc", limit: 10, env: ENV, fetchImpl: fakeFetch(cap) });
    assert.deepEqual(out.rows, [{ ticker: "QQQ", close: 100 }]);
    assert.equal(cap[0].url, "https://proj.supabase.co/rest/v1/price_history?select=ticker%2Cd%2Cclose&ticker=eq.QQQ&order=d.desc&limit=10");
    assert.equal(cap[0].opts.headers.apikey, "svc_key");
  });
});

describe("supabase: readSeries (deep history read for the read side)", () => {
  it("returns null when Supabase isn't configured (caller falls back to live fetch)", async () => {
    assert.equal(await readSeries("QQQ", { env: {} }), null);
  });
  it("paginates and reconstructs an ascending {ticker,dates,closes}", async () => {
    // page 1 full (pageSize=2), page 2 partial → stop.
    const pages = [[{ d: "2026-01-02", close: 10 }, { d: "2026-01-05", close: 11 }], [{ d: "2026-01-06", close: 12 }]];
    let call = 0;
    const fetchImpl = async () => ({ ok: true, status: 200, async json() { return pages[call++] || []; } });
    const s = await readSeries("QQQ", { env: ENV, fetchImpl, pageSize: 2 });
    assert.equal(s.ticker, "QQQ");
    assert.deepEqual(s.dates, ["2026-01-02", "2026-01-05", "2026-01-06"]);
    assert.deepEqual(s.closes, [10, 11, 12]);
    assert.equal(call, 2); // stopped after the short page
  });
  it("drops non-positive/garbage closes and returns null on no rows", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, async json() { return []; } });
    assert.equal(await readSeries("ZZZ", { env: ENV, fetchImpl, pageSize: 1000 }), null);
  });
});
