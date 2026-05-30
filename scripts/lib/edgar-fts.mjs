// Proxy DISCOVERY for inaccessible chokepoints. The public companies whose SEC
// filings mention a private/foreign entity (SpaceX, Ajinomoto, Harmonic Drive,
// Physical Intelligence, …) ARE the exposed proxies — customers, suppliers, partners.
// Free, keyless SEC EDGAR full-text search. parseFtsHits is pure + tested.
const UA = process.env.SEC_USER_AGENT || "puck-scarcity-radar (github.com/shyvibecoder/deep-tech-market-research)";

// EDGAR full-text search returns hits whose display_names embed "Company (TICK) (CIK …)".
export function parseFtsHits(json) {
  const hits = json?.hits?.hits || [];
  const tally = {};
  for (const h of hits) {
    for (const dn of (h?._source?.display_names || [])) {
      const m = dn.match(/^(.*?)\s+\(([A-Z0-9.\-]+)\)\s+\(CIK/);
      if (!m) continue;
      const tk = m[2];
      (tally[tk] ||= { ticker: tk, company: m[1].trim(), mentions: 0 });
      tally[tk].mentions++;
    }
  }
  return Object.values(tally).sort((a, b) => b.mentions - a.mentions);
}

export async function searchFts(term) {
  const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${term}"`)}&forms=10-K,10-Q,8-K`;
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`fts ${r.status}`);
  return parseFtsHits(await r.json());
}

// Discover the most-mentioning public companies across a chokepoint's search terms.
export async function discoverProxies(terms, { max = 6 } = {}) {
  const tally = {}; const errors = [];
  for (const t of terms || []) {
    try { for (const h of await searchFts(t)) { (tally[h.ticker] ||= { ...h, mentions: 0 }); tally[h.ticker].mentions += h.mentions; } }
    catch (e) { errors.push(`${t}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 150)); // polite to SEC
  }
  return { proxies: Object.values(tally).sort((a, b) => b.mentions - a.mentions).slice(0, max), errors };
}
