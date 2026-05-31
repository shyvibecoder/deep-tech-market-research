import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStooqHistory, parseTiingoHistory } from "../scripts/lib/quotes.mjs";

describe("history sources: Stooq daily CSV parser", () => {
  const csv = "Date,Open,High,Low,Close,Volume\n2026-01-05,10,11,9.5,10.5,1000\n2026-01-06,10.5,12,10,11.2,1200\n";
  it("parses date+close rows, ignoring others", () => {
    const out = parseStooqHistory("AAA", csv);
    assert.deepEqual(out.dates, ["2026-01-05", "2026-01-06"]);
    assert.deepEqual(out.closes, [10.5, 11.2]);
  });
  it("returns empty on a non-CSV / error body (e.g. Stooq throttle text)", () => {
    assert.deepEqual(parseStooqHistory("AAA", "Exceeded the daily hits limit").closes, []);
    assert.deepEqual(parseStooqHistory("AAA", "").closes, []);
  });
  it("drops malformed / non-positive closes", () => {
    const out = parseStooqHistory("AAA", "Date,Open,High,Low,Close,Volume\n2026-01-05,1,1,1,0,1\nbad,row\n2026-01-07,1,1,1,9,1\n");
    assert.deepEqual(out.dates, ["2026-01-07"]);
  });
});

describe("history sources: Tiingo JSON parser", () => {
  it("prefers adjClose, falls back to close", () => {
    const out = parseTiingoHistory("AAA", [
      { date: "2026-01-05T00:00:00.000Z", close: 10, adjClose: 9.9 },
      { date: "2026-01-06T00:00:00.000Z", close: 11 },
    ]);
    assert.deepEqual(out.dates, ["2026-01-05", "2026-01-06"]);
    assert.deepEqual(out.closes, [9.9, 11]);
  });
  it("is safe on non-array / error payloads", () => {
    assert.deepEqual(parseTiingoHistory("AAA", { detail: "Error: not found" }).closes, []);
    assert.deepEqual(parseTiingoHistory("AAA", null).closes, []);
  });
});
