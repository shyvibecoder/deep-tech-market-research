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

// Free tiers rate-limit aggressively (Gemini free RPM is tiny). Retry transient throttling/outages
// with exponential backoff, honoring a server Retry-After when present. A persistent quota error
// still throws after the last attempt — loudly, with the body — so it surfaces in the report.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchRetry(url, opts, label, { tries = 4, base = 2000, fetchImpl = fetch } = {}) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetchImpl(url, opts); }
    catch (e) { last = `${label}: ${e.name === "TimeoutError" ? "timeout" : e.message}`; await sleep(base * 2 ** i); continue; }
    if (r.ok) return r;
    const body = (await r.text()).slice(0, 200);
    last = `${label} HTTP ${r.status}: ${body}`;
    if (!RETRY_STATUS.has(r.status) || i === tries - 1) throw new Error(last);
    const ra = Number(r.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : base * 2 ** i);
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

async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const r = await fetchRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    // gpt-oss reasons by default; Groq returns the thinking in a separate `reasoning` field, so
    // message.content stays the clean final answer. Don't send reasoning_effort — an unsupported
    // value would 400 and reintroduce the silent-fail we're fixing.
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  }, `groq ${model}`);
  const j = await r.json();
  // gpt-oss may leave content empty when the answer lands in `reasoning` — fall back to it.
  const msg = j?.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning || "";
  if (!text) throw new Error(`groq ${model}: empty response (${JSON.stringify(j).slice(0, 200)})`);
  return text;
}

const PROVIDERS = {
  gemini: { env: "GEMINI_API_KEY", label: () => `gemini:${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}`, call: callGemini },
  groq: { env: "GROQ_API_KEY", label: () => `groq:${process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL}`, call: callGroq },
};

// Providers with a key present, in PRIMARY-first preference order. Groq is preferred as the primary
// analyst: its free tier has far higher limits than Gemini's, so it carries the bulk of the calls,
// with Gemini as the cross-model second opinion. Override the order implicitly by setting only one key.
const PREFERENCE = ["groq", "gemini"];
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
