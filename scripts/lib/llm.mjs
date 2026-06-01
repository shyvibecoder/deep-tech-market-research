// Free-LLM abstraction with MULTI-MODEL adversarial review.
//   GEMINI_API_KEY -> Google Gemini (free tier)   [analyst by default]
//   GROQ_API_KEY   -> Groq (free tier)             [red-team by default]
// If BOTH keys are set, the analyst and red-team passes run on DIFFERENT models,
// so the critique is genuinely adversarial (one model attacks the other's output)
// instead of a model grading itself. With one key, both passes use it.
// This is where the "research / red-team agents" run in CI on free models.
//
// Defaults are the latest THINKING models (May 2026): Gemini 3.5 Flash (thinking on by default)
// and Groq's gpt-oss-120b reasoning model. Both are overridable via GEMINI_MODEL / GROQ_MODEL so
// the next model bump needs no code change. CRITICAL: API failures THROW (they used to be
// swallowed into ""), so a retired/blocked model surfaces loudly in the run instead of looking
// like "the model had nothing to say" — that silent-fail is exactly what hid the 2.0-flash
// retirement and zeroed out every research run.
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-r1:free"; // free reasoning model; override via OPENROUTER_MODEL

// Free tiers rate-limit aggressively (Gemini free RPM is tiny). Retry transient throttling/outages
// with exponential backoff, honoring a server Retry-After when present. A persistent quota error
// still throws after the last attempt — loudly, with the body — so it surfaces in the report.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchRetry(url, opts, label, { tries = 4, base = 2000, maxBackoffMs = 20000, fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const backoff = (i, ra) => Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : base * 2 ** i, maxBackoffMs);
  let last = "";
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetchImpl(url, opts); }
    catch (e) { last = `${label}: ${e.name === "TimeoutError" ? "timeout" : e.message}`; await sleepImpl(backoff(i)); continue; }
    if (r.ok) return r;
    const body = (await r.text()).slice(0, 200);
    last = `${label} HTTP ${r.status}: ${body}`;
    if (!RETRY_STATUS.has(r.status) || i === tries - 1) throw new Error(last);
    // Honor a server Retry-After, but CAP it: a Tier-1 key can send Retry-After: 60+, which across
    // many calls × tries would stall the run for many minutes. Cap keeps the run bounded + responsive.
    await sleepImpl(backoff(i, Number(r.headers.get("retry-after"))));
  }
  throw new Error(last);
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetchRetry(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(120000), // thinking models take longer than the old flash
  }, `gemini ${model}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("") || "";
  if (!text) throw new Error(`gemini ${model}: empty response (${JSON.stringify(j).slice(0, 200)})`);
  return text;
}

// Shared OpenAI-compatible chat call (Groq + OpenRouter both speak this). Thinking models can leave
// `content` empty and put the answer in `reasoning` — fall back to it. Failures throw loudly.
async function callOpenAIChat({ url, key, model, label, extraHeaders = {} }, prompt) {
  const r = await fetchRetry(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  }, label);
  const j = await r.json();
  const msg = j?.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning || "";
  if (!text) throw new Error(`${label}: empty response (${JSON.stringify(j).slice(0, 200)})`);
  return text;
}

function callGroq(prompt) {
  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  return callOpenAIChat({ url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY, model, label: `groq ${model}` }, prompt);
}

// OpenRouter: one key, MANY free models — DeepSeek R1, Qwen3, GLM, Kimi, Llama. Set OPENROUTER_MODEL
// to A/B them (default: a free DeepSeek reasoning model). The optional referer/title headers are
// OpenRouter etiquette for free-tier attribution.
function callOpenRouter(prompt) {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  return callOpenAIChat({
    url: "https://openrouter.ai/api/v1/chat/completions", key: process.env.OPENROUTER_API_KEY, model, label: `openrouter ${model}`,
    extraHeaders: { "HTTP-Referer": "https://deep-tech-market-research.vercel.app", "X-Title": "deep-tech-market-research" },
  }, prompt);
}

// --- Optional FRONTIER providers (paid) — materially better reasoning than the free tiers. Set a
// key to opt in; they're preferred first so they staff the committee's lead seats / the CRO review.
const DEFAULT_OPENAI_MODEL = "gpt-5.1";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

// OpenAI is OpenAI-compatible → reuse the shared chat caller.
function callOpenAI(prompt) {
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  return callOpenAIChat({ url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model, label: `openai ${model}` }, prompt);
}

// Anthropic Messages API has its own request/response shape (x-api-key, required max_tokens, content
// blocks). parseAnthropic is exported for unit testing the extraction without a network call.
export function parseAnthropic(j) {
  return (j?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("") || "";
}
async function callAnthropic(prompt) {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const r = await fetchRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  }, `anthropic ${model}`);
  const text = parseAnthropic(await r.json());
  if (!text) throw new Error(`anthropic ${model}: empty response`);
  return text;
}

const PROVIDERS = {
  anthropic: { env: "ANTHROPIC_API_KEY", label: () => `anthropic:${process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL}`, call: callAnthropic },
  openai: { env: "OPENAI_API_KEY", label: () => `openai:${process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL}`, call: callOpenAI },
  gemini: { env: "GEMINI_API_KEY", label: () => `gemini:${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}`, call: callGemini },
  groq: { env: "GROQ_API_KEY", label: () => `groq:${process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL}`, call: callGroq },
  openrouter: { env: "OPENROUTER_API_KEY", label: () => `openrouter:${process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL}`, call: callOpenRouter },
};

// Providers with a key present, in PRIMARY-first preference order. FRONTIER models (Anthropic, then
// OpenAI) lead when their paid keys are set — they staff the committee's lead seats / the CRO review
// for materially better reasoning. Then the free tiers: Groq (high free limit, carries bulk),
// OpenRouter (DeepSeek/Qwen/GLM/Kimi), Gemini (tiny free RPM). Set fewer keys to narrow the pool.
const PREFERENCE = ["anthropic", "openai", "groq", "openrouter", "gemini"];
export function availableProviders() {
  return PREFERENCE.filter((p) => process.env[PROVIDERS[p].env]);
}
export function llmAvailable() { return availableProviders().length > 0; }

// Call a specific provider (falls back to the first available one).
export async function llm(prompt, provider) {
  const avail = availableProviders();
  const p = provider && avail.includes(provider) ? provider : avail[0];
  return p ? PROVIDERS[p].call(prompt) : "";
}

// LIVENESS PING (root-cause guard for the recurring "valid key, dead model slug" bug): a 1-token
// call that proves the CONFIGURED model actually answers. A key being present is NOT enough — free
// providers silently retire model slugs (the 2.0-flash / deepseek-r1:free traps). `callFor` is
// injectable so the logic is unit-testable without network. Returns {provider, ok, error}.
export async function pingProvider(provider, callFor) {
  const call = callFor || ((p) => PROVIDERS[p].call("ping — reply with the single word: ok"));
  try {
    const text = await call(provider);
    if (typeof text === "string" && text.trim()) return { provider, ok: true, error: "" };
    return { provider, ok: false, error: `${provider}: empty response from configured model` };
  } catch (e) {
    return { provider, ok: false, error: e.message || String(e) };
  }
}

// Probe a set of providers in parallel; preserves input order so the report is deterministic.
export async function probeProviders(providers, { callFor } = {}) {
  return Promise.all(providers.map((p) => pingProvider(p, callFor ? () => callFor(p)(p) : undefined)));
}

// Given the seat→provider assignment and a {provider: isLive} map, reassign any DEAD seat to the
// `fallback` provider (the funded frontier) when it's live. Pure → testable. Records every swap so
// the run can announce the fallback LOUDLY: degraded cross-model diversity must never be silent.
// When there's no live fallback, dead seats are left as-is — the committee-health path then reports
// the run as degraded rather than pretending it ran.
export function resolveLiveSeats(seatProviders, live, fallback) {
  const fallbackLive = fallback && live[fallback];
  const swaps = [];
  const seats = seatProviders.map((p) => {
    if (live[p] === false && fallbackLive && p !== fallback) {
      swaps.push({ from: p, to: fallback });
      return fallback;
    }
    return p;
  });
  return { seats, swaps };
}

// Two-pass "analyst + red-team" digest over fresh signals/filings/news.
// Analyst runs on the first available model; red-team on a DIFFERENT model when a
// second free key exists — a true cross-model adversarial review.
export async function analystRedteamDigest({ signals, filings = [], headlines = [], scarcities }) {
  const avail = availableProviders();
  if (!avail.length) return "";
  const analystP = avail[0];
  const redteamP = avail[1] || avail[0];
  const crossModel = analystP !== redteamP;
  const ctx = JSON.stringify({ signals, filings, headlines, scarcities }, null, 0).slice(0, 24000);

  const analyst = await PROVIDERS[analystP].call(
    `You are a markets analyst tracking structural-tech-scarcity theses.\n` +
    `Given this JSON of fresh quotes (incl. forward P/E where available), recent SEC ` +
    `filings (8-K/10-Q items), news headlines, and the scarcity map, write 6-10 terse ` +
    `bullets: what materially changed for any scarcity/holding — prioritize SEC filings ` +
    `that touch backlog, capacity, guidance, or pricing — and whether any deploy/exit ` +
    `trigger looks closer. Note where a name "went up a lot" but is still cheap on ` +
    `forward multiples. Be specific and cite the ticker/scarcity/filing. JSON:\n${ctx}`
  );
  const redteam = await PROVIDERS[redteamP].call(
    `You are a skeptical red-team${crossModel ? ` (a different model than the analyst)` : ""}. ` +
    `Attack this analyst digest: which claims are over-stated, already-priced, or not ` +
    `supported by the data (quotes/filings/news provided)? Keep it to 4-6 sharp bullets.\n\n` +
    `DIGEST:\n${analyst}`
  );

  const header = `_Analyst: ${PROVIDERS[analystP].label()} · Red-team: ${PROVIDERS[redteamP].label()} ` +
    `${crossModel ? "(cross-model adversarial review)" : "(single model — set a 2nd free key, e.g. GROQ_API_KEY, for cross-model review)"}_`;
  return `${header}\n\n## Analyst\n${analyst}\n\n## Red-team\n${redteam}`.trim();
}
