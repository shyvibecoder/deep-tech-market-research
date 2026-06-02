// VALUATION leg for the per-name entry read — "is this expensive?", corroborated across TWO sources so a
// single bad/blocked feed can't drive the call (same philosophy as the price corroboration).
//   • EDGAR XBRL companyfacts (keyless, authoritative REPORTED figures) → trailing P/E (price ÷ TTM diluted
//     EPS) + revenue YoY + net margin. Forward P/E isn't recoverable keyless (Yahoo quoteSummary is
//     crumb-gated), so we use authoritative TRAILING earnings instead.
//   • Tiingo fundamentals daily (free key) → its reported peRatio.
// Pure parsers + a corroboration join (reuses marketdata.corroborate). Fetchers are thin and live in the
// scanner; everything here is unit-testable with fixtures (the sandbox can't reach SEC/Tiingo).
import { corroborate } from "./marketdata.mjs";

const REV_CONCEPTS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"];
const num = (v) => (Number.isFinite(v) ? v : null);

// Latest ANNUAL value (10-K / fp "FY") for a us-gaap concept; returns { val, end } or null.
function latestAnnual(facts, concept, unit) {
  const arr = facts?.facts?.["us-gaap"]?.[concept]?.units?.[unit];
  if (!Array.isArray(arr)) return null;
  const annual = arr.filter((e) => (e.fp === "FY" || e.form === "10-K") && Number.isFinite(e.val) && e.end);
  if (!annual.length) return null;
  annual.sort((a, b) => (a.end < b.end ? 1 : -1));
  return { val: annual[0].val, end: annual[0].end };
}

// Trailing-twelve-month diluted EPS: sum the 4 most recent distinct ~quarterly values (10-Q, ~3-month
// duration); fall back to the latest annual diluted EPS when quarters aren't cleanly available.
function epsTTM(facts) {
  const arr = facts?.facts?.["us-gaap"]?.EarningsPerShareDiluted?.units?.["USD/shares"];
  if (!Array.isArray(arr)) return null;
  const isQtr = (e) => e.start && e.end && Number.isFinite(e.val) && Math.abs((new Date(e.end) - new Date(e.start)) / 86400000 - 91) <= 25;
  const q = [...new Map(arr.filter(isQtr).map((e) => [e.end, e])).values()].sort((a, b) => (a.end < b.end ? 1 : -1));
  if (q.length >= 4) return +(q.slice(0, 4).reduce((a, e) => a + e.val, 0)).toFixed(2);
  const ann = latestAnnual(facts, "EarningsPerShareDiluted", "USD/shares");
  return ann ? ann.val : null;
}

// Parse EDGAR companyfacts → trailing valuation/fundamentals. `price` = current share price (for P/E).
export function parseEdgarFacts(facts, { price } = {}) {
  const eps = epsTTM(facts);
  const pe = (Number.isFinite(eps) && eps > 0 && Number.isFinite(price) && price > 0) ? +(price / eps).toFixed(1) : null;
  let revC = null; for (const c of REV_CONCEPTS) { if (facts?.facts?.["us-gaap"]?.[c]) { revC = c; break; } }
  const revArr = revC ? facts.facts["us-gaap"][revC].units?.USD : null;
  let revenue_yoy = null, net_margin = null, revNow = null;
  if (Array.isArray(revArr)) {
    const annual = revArr.filter((e) => (e.fp === "FY" || e.form === "10-K") && Number.isFinite(e.val) && e.end).sort((a, b) => (a.end < b.end ? 1 : -1));
    if (annual.length >= 2 && annual[1].val > 0) revenue_yoy = +(annual[0].val / annual[1].val - 1).toFixed(3);
    revNow = annual[0]?.val ?? null;
  }
  const ni = latestAnnual(facts, "NetIncomeLoss", "USD");
  if (ni && revNow > 0) net_margin = +(ni.val / revNow).toFixed(3);
  return { source: "edgar", eps_ttm: eps, pe, revenue_yoy, net_margin };
}

// Parse Tiingo fundamentals/daily rows → latest reported peRatio.
export function parseTiingoFundamentals(rows) {
  if (!Array.isArray(rows) || !rows.length) return { source: "tiingo", pe: null };
  const withPe = rows.filter((r) => Number.isFinite(r?.peRatio) && r.peRatio > 0).sort((a, b) => (a.date < b.date ? 1 : -1));
  return { source: "tiingo", pe: withPe.length ? +withPe[0].peRatio.toFixed(1) : null };
}

// Corroborate the trailing P/E across the sources; carry EDGAR's growth/margin (Tiingo daily lacks them).
// divergence is wider than prices (15%): reported-vs-vendor P/E differ on EPS definitions/timing.
export function corroborateValuation({ edgar = null, tiingo = null } = {}, divergence = 0.15) {
  const c = corroborate({ ...(edgar?.pe ? { edgar: edgar.pe } : {}), ...(tiingo?.pe ? { tiingo: tiingo.pe } : {}) }, divergence);
  if (!c) return null;
  return {
    pe: c.used, sources: c.sources, n: c.n, spread: c.spread, ok: c.ok,
    single_source: c.n < 2,
    revenue_yoy: edgar?.revenue_yoy ?? null,
    net_margin: edgar?.net_margin ?? null,
  };
}

// --- Thin fetchers (live only in the scanner; the sandbox is network-allowlisted so these aren't unit-run;
//     the PARSERS above are the tested part). EDGAR is keyless (needs a descriptive UA); Tiingo uses the key. ---
const SEC_UA = process.env.SEC_USER_AGENT || "puck-deep-tech-research (set SEC_USER_AGENT with contact)";

export async function fetchEdgarFacts(cik) {
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "user-agent": SEC_UA, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`companyfacts ${r.status}`);
  return r.json();
}

export async function fetchTiingoFundamentalsDaily(ticker, { key = process.env.TIINGO_API_KEY } = {}) {
  if (!key) return null;
  const r = await fetch(`https://api.tiingo.com/tiingo/fundamentals/${encodeURIComponent(ticker)}/daily?token=${key}`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null; // free tier covers a limited universe → 404 → single-source (EDGAR) fallback
  return r.json();
}

// Orchestrate one name → corroborated trailing valuation (or null). Each source is best-effort.
export async function getValuation(ticker, { cik = null, price = null, tiingoKey = process.env.TIINGO_API_KEY } = {}) {
  let edgar = null, tiingo = null;
  if (cik) { try { edgar = parseEdgarFacts(await fetchEdgarFacts(cik), { price }); } catch { /* skip */ } }
  try { const rows = await fetchTiingoFundamentalsDaily(ticker, { key: tiingoKey }); if (rows) tiingo = parseTiingoFundamentals(rows); } catch { /* skip */ }
  const cor = corroborateValuation({ edgar, tiingo });
  if (cor) return cor;
  // No P/E from either, but EDGAR may still have growth/margin — carry it (pe null).
  if (edgar && (edgar.revenue_yoy != null || edgar.net_margin != null)) return { pe: null, sources: [], n: 0, single_source: true, ok: null, revenue_yoy: edgar.revenue_yoy, net_margin: edgar.net_margin };
  return null;
}

// Label P/E relative to the plan's PEER MEDIAN when given (more honest than absolute thresholds across very
// different businesses); else a crude absolute band. GROWTH-AWARE: a high TRAILING P/E backed by strong
// revenue growth isn't "rich" — trailing earnings understate a recovering cyclical (e.g. MU ~52x trailing
// but ~10–12x forward). We soften rich→fair when revenue growth justifies the multiple, and always label it
// "trailing" so it's never mistaken for forward. Returns { tag: cheap|fair|rich, label }.
export function valuationLabel(v, { peerMedianPe = null } = {}) {
  const pe = v?.pe;
  if (!Number.isFinite(pe) || pe <= 0) return { tag: null, label: "no P/E" };
  const yoy = Number.isFinite(v?.revenue_yoy) ? v.revenue_yoy : null;
  const growthJustified = yoy != null && yoy >= 0.20; // strong top-line growth → high trailing P/E ≠ overvalued
  if (Number.isFinite(peerMedianPe) && peerMedianPe > 0) {
    const r = pe / peerMedianPe;
    const base = r < 0.8 ? "cheap" : r > 1.25 ? "rich" : "fair";
    if (base === "rich" && growthJustified) return { tag: "fair", label: `${pe}x trailing · ${r.toFixed(2)}× peers (rich on trailing, but +${Math.round(yoy * 100)}% rev → forward lower)`, ratio: +r.toFixed(2), growth_justified: true };
    return { tag: base, label: `${base} (${pe}x trailing · ${r.toFixed(2)}× peers)`, ratio: +r.toFixed(2) };
  }
  const base = pe < 15 ? "cheap" : pe > 30 ? "rich" : "fair";
  const tag = base === "rich" && growthJustified ? "fair" : base;
  return { tag, label: `${tag} (${pe}x trailing${tag !== base ? `, +${Math.round(yoy * 100)}% rev` : ""})` };
}
