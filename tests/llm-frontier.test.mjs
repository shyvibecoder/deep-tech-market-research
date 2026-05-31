import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { availableProviders, parseAnthropic } from "../scripts/lib/llm.mjs";

// Save/restore env so tests don't leak keys into each other.
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } }
}

describe("llm frontier providers: detection + preference order", () => {
  const clear = { GROQ_API_KEY: null, OPENROUTER_API_KEY: null, GEMINI_API_KEY: null, ANTHROPIC_API_KEY: null, OPENAI_API_KEY: null };

  it("detects Anthropic + OpenAI when their keys are set", () => {
    withEnv({ ...clear, ANTHROPIC_API_KEY: "x" }, () => assert.deepEqual(availableProviders(), ["anthropic"]));
    withEnv({ ...clear, OPENAI_API_KEY: "x" }, () => assert.deepEqual(availableProviders(), ["openai"]));
  });

  it("prefers FRONTIER models first (anthropic > openai > groq > openrouter > gemini)", () => {
    withEnv({ ...clear, ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "r", GEMINI_API_KEY: "m" }, () => {
      assert.deepEqual(availableProviders(), ["anthropic", "openai", "groq", "openrouter", "gemini"]);
    });
  });

  it("staffs committee seats across whatever is set (e.g. frontier bull + free bear/skeptic)", () => {
    withEnv({ ...clear, ANTHROPIC_API_KEY: "a", GROQ_API_KEY: "g", OPENROUTER_API_KEY: "r" }, () => {
      assert.deepEqual(availableProviders(), ["anthropic", "groq", "openrouter"]);
    });
  });
});

describe("llm: parseAnthropic (Messages API response shape)", () => {
  it("extracts joined text from the content blocks", () => {
    const j = { content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] };
    assert.equal(parseAnthropic(j), "hello world");
  });
  it("ignores non-text blocks (e.g. thinking) and returns the text", () => {
    const j = { content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "answer" }] };
    assert.equal(parseAnthropic(j), "answer");
  });
  it("returns empty string on a malformed/empty response (caller then throws loudly)", () => {
    assert.equal(parseAnthropic({}), "");
    assert.equal(parseAnthropic(null), "");
  });
});
