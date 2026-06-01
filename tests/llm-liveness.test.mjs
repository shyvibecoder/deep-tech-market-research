import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pingProvider, probeProviders } from "../scripts/lib/llm.mjs";

// THE BUG CLASS THIS GUARDS: a key can be valid while its CONFIGURED MODEL slug is retired (e.g. a
// free "deepseek-r1:free" that 404s). The seat then returns nothing, gets swallowed, and a 1-of-3
// monologue masquerades as a real result. A pre-run liveness ping catches it and reassigns the dead
// seat to the funded frontier — LOUDLY, so degraded diversity is never silent.
describe("llm liveness: pingProvider", () => {
  it("ok when the configured model answers with text", async () => {
    const r = await pingProvider("anthropic", async () => "ok");
    assert.equal(r.ok, true);
    assert.equal(r.provider, "anthropic");
  });
  it("DOWN when the call throws (retired slug / bad key) — carries the error", async () => {
    const r = await pingProvider("openrouter", async () => { throw new Error("openrouter deepseek/deepseek-r1:free HTTP 404: No endpoints found"); });
    assert.equal(r.ok, false);
    assert.match(r.error, /No endpoints found/);
  });
  it("DOWN on an empty response (a live model produces text)", async () => {
    const r = await pingProvider("groq", async () => "   ");
    assert.equal(r.ok, false);
    assert.match(r.error, /empty/i);
  });
});

describe("llm liveness: probeProviders", () => {
  it("probes every provider in parallel and returns a result per provider", async () => {
    const callFor = (p) => p === "groq"
      ? async () => { throw new Error("groq openai/gpt-oss-120b HTTP 400: model_decommissioned"); }
      : async () => "ok";
    const results = await probeProviders(["anthropic", "groq", "openrouter"], { callFor });
    assert.deepEqual(results.map((r) => r.provider), ["anthropic", "groq", "openrouter"]);
    assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  });
});
