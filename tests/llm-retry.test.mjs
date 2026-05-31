import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchRetry } from "../scripts/lib/llm.mjs";

// Build a fake fetch that returns a scripted sequence of responses (status + body), recording calls.
function scripted(seq) {
  let i = 0;
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const step = seq[Math.min(i++, seq.length - 1)];
    if (step.throw) throw Object.assign(new Error(step.throw), { name: step.name || "Error" });
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (h) => (step.headers || {})[h] ?? null },
      text: async () => step.body || "",
    };
  };
  return { fn, calls: () => calls };
}

describe("llm fetchRetry: free-tier resilience", () => {
  const fast = { base: 1, tries: 4 }; // tiny backoff so tests are instant

  it("returns immediately on a 2xx (no retry)", async () => {
    const s = scripted([{ status: 200, body: "ok" }]);
    const r = await fetchRetry("u", {}, "x", { ...fast, fetchImpl: s.fn });
    assert.equal(r.status, 200);
    assert.equal(s.calls().length, 1);
  });

  it("retries on 429 then succeeds", async () => {
    const s = scripted([{ status: 429, body: "slow down" }, { status: 200, body: "ok" }]);
    const r = await fetchRetry("u", {}, "gemini", { ...fast, fetchImpl: s.fn });
    assert.equal(r.status, 200);
    assert.equal(s.calls().length, 2);
  });

  it("retries on transient 503", async () => {
    const s = scripted([{ status: 503, body: "high demand" }, { status: 200 }]);
    const r = await fetchRetry("u", {}, "gemini", { ...fast, fetchImpl: s.fn });
    assert.equal(r.status, 200);
  });

  it("throws with status + body after exhausting retries on a persistent 429 (loud, not silent)", async () => {
    const s = scripted([{ status: 429, body: "exceeded your current quota" }]);
    await assert.rejects(
      fetchRetry("u", {}, "gemini gemini-3.5-flash", { ...fast, fetchImpl: s.fn }),
      /gemini gemini-3.5-flash HTTP 429: exceeded your current quota/
    );
    assert.equal(s.calls().length, 4); // all attempts used
  });

  it("does NOT retry a non-retryable 4xx (e.g. 400 bad model) — fails fast", async () => {
    const s = scripted([{ status: 400, body: "model not found" }]);
    await assert.rejects(fetchRetry("u", {}, "groq", { ...fast, fetchImpl: s.fn }), /HTTP 400/);
    assert.equal(s.calls().length, 1);
  });

  it("retries on a network/timeout throw, then succeeds", async () => {
    const s = scripted([{ throw: "fetch failed", name: "TypeError" }, { status: 200 }]);
    const r = await fetchRetry("u", {}, "groq", { ...fast, fetchImpl: s.fn });
    assert.equal(r.status, 200);
    assert.equal(s.calls().length, 2);
  });

  it("honors a Retry-After header (seconds) without blowing up", async () => {
    const s = scripted([{ status: 429, headers: { "retry-after": "0" } }, { status: 200 }]);
    const r = await fetchRetry("u", {}, "gemini", { ...fast, fetchImpl: s.fn });
    assert.equal(r.status, 200);
  });

  it("CAPS the backoff so a huge Retry-After can't stall the run for minutes", async () => {
    const slept = [];
    const s = scripted([{ status: 429, headers: { "retry-after": "600" } }, { status: 200 }]); // server asks 10 min
    const r = await fetchRetry("u", {}, "anthropic", { tries: 4, base: 2000, maxBackoffMs: 20000, fetchImpl: s.fn, sleepImpl: async (ms) => slept.push(ms) });
    assert.equal(r.status, 200);
    assert.equal(slept[0], 20000, "600s Retry-After must be capped at maxBackoffMs (20s), not honored literally");
  });

  it("also caps the exponential backoff (no Retry-After) at maxBackoffMs on later attempts", async () => {
    const slept = [];
    // base 2000 → attempt 4 would be 2000*2^3 = 16000; with base 8000 it'd be 64000 → must cap to 20000
    const s = scripted([{ status: 503 }, { status: 503 }, { status: 200 }]);
    await fetchRetry("u", {}, "groq", { tries: 4, base: 8000, maxBackoffMs: 20000, fetchImpl: s.fn, sleepImpl: async (ms) => slept.push(ms) });
    assert.ok(slept.every((ms) => ms <= 20000), `every backoff must be <= 20000, got ${slept}`);
  });
});
