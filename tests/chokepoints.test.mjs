import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chokepointHeat } from "../scripts/lib/chokepoints.mjs";

describe("chokepoints: heat from proxy momentum + news", () => {
  it("is hot with strong proxy momentum + heavy news", () => {
    const h = chokepointHeat({ proxyMom: 0.1, complexMom: 0.02, newsCount: 5 });
    assert.equal(h.heat, 100); assert.equal(h.rel, 0.08);
  });
  it("is cold with no news and weak proxies", () => {
    assert.equal(chokepointHeat({ proxyMom: -0.1, newsCount: 0 }).heat, 0);
  });
  it("uses news only when no proxy momentum", () => {
    assert.equal(chokepointHeat({ newsCount: 5 }).heat, 100); // news=1, no mom term
    assert.equal(chokepointHeat({ newsCount: 0 }).heat, 0);
  });
  it("rel is null without a complex reference", () => {
    assert.equal(chokepointHeat({ proxyMom: 0.1 }).rel, null);
  });
});
