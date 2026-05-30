// Supabase persistence — zero-dependency PostgREST-over-fetch (no SDK), matching the app's
// existing fetch-based style. Used ONLY by the GitHub Actions scanner (server-side), with the
// service_role key from env. The static dashboard never touches this. Everything no-ops cleanly
// when Supabase isn't configured, so local/offline runs and forks behave exactly as before.
//
// `fetchImpl` and `env` are injected so the request-building is fully unit-testable without
// network or keys (same pattern as the LLM client).

export function supabaseConfigured(env = process.env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

const base = (env) => env.SUPABASE_URL.replace(/\/+$/, "");
const authHeaders = (env) => ({
  apikey: env.SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
});

// Turn a fetchSeries result ({ ticker, dates, closes }) into price_history rows.
export function seriesToRows(series, source = "yahoo") {
  if (!series || !Array.isArray(series.dates) || !Array.isArray(series.closes)) return [];
  const rows = [];
  for (let i = 0; i < series.dates.length; i++) {
    const d = series.dates[i], close = series.closes[i];
    if (d && Number.isFinite(close) && close > 0) rows.push({ ticker: series.ticker, d, close, source });
  }
  return rows;
}

// Idempotent bulk upsert. on_conflict columns must match a unique/PK constraint (e.g. "ticker,d").
export async function upsertRows(table, rows, { onConflict, env = process.env, fetchImpl = fetch, chunk = 500 } = {}) {
  if (!supabaseConfigured(env)) return { skipped: true, written: 0 };
  if (!rows || !rows.length) return { written: 0 };
  const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const endpoint = `${base(env)}/rest/v1/${table}${q}`;
  let written = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { ...authHeaders(env), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`supabase upsert ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    written += batch.length;
  }
  return { written };
}

// Read rows back (PostgREST query string, e.g. filters="ticker=eq.QQQ&order=d.desc").
export async function selectRows(table, { select = "*", filters = "", limit, env = process.env, fetchImpl = fetch } = {}) {
  if (!supabaseConfigured(env)) return { skipped: true, rows: [] };
  let qs = `select=${encodeURIComponent(select)}`;
  if (filters) qs += `&${filters}`;
  if (limit) qs += `&limit=${limit}`;
  const endpoint = `${base(env)}/rest/v1/${table}?${qs}`;
  const res = await fetchImpl(endpoint, { headers: { ...authHeaders(env), accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`supabase select ${table} ${res.status}`);
  return { rows: await res.json() };
}

// Convenience: persist price history from any number of fetchSeries results + ad-hoc rows.
// Runs the anti-synthetic guard first (defense in depth): only REAL, validated prints persist.
export async function upsertPriceHistory(rows, opts = {}) {
  return upsertRows("price_history", sanitizePriceRows(rows), { onConflict: "ticker,d", ...opts });
}

// ── STANDING DATA-INTEGRITY INVARIANT: NEVER PERSIST SYNTHETIC DATA ──────────────────────────
// The app degrades by SKIPPING, never by fabricating. Only real prints from a trusted LIVE
// market-data provider, with a finite positive close and a valid date, may enter the database.
// This guard makes that structural: offline/synthetic/placeholder/zero/unknown-source rows are
// dropped, not written. (Mirrors the V2.3 overlay's "refuses to act on fake data" rule.)
export const TRUSTED_PRICE_SOURCES = new Set(["yahoo", "stooq", "finnhub", "twelvedata", "alphavantage", "consensus"]);

export function sanitizePriceRows(rows) {
  return (rows || []).filter((r) =>
    r && typeof r.ticker === "string" && r.ticker.length > 0 &&
    typeof r.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.d) &&
    Number.isFinite(r.close) && r.close > 0 &&
    TRUSTED_PRICE_SOURCES.has(r.source));
}
