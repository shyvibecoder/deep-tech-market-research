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

// Rank discovered proxies by SPECIFICITY, not raw mentions. Raw counts are inverted for
// our purpose: a diversified megacap that mentions every term once in boilerplate (and so
// appears across many chokepoints) is the WORST proxy, yet would rank highest. We want the
// concentrated pure-play. So we score TF-IDF-style — term frequency within a chokepoint ×
// inverse "document" frequency across chokepoints — and flag ubiquitous tickers as generic.
// Fully data-derived (no hand-coded megacap list, per the discovery mandate). Pure.
export function rankProxies(chokepoints) {
  const cps = chokepoints || [];
  const N = cps.length || 1;
  const df = {}; // how many chokepoints each ticker appears in
  for (const c of cps) for (const d of c.discovered || []) df[d.ticker] = (df[d.ticker] || 0) + 1;
  return cps.map((c) => {
    const disc = c.discovered || [];
    const maxM = Math.max(1, ...disc.map((d) => d.mentions || 0));
    const scored = disc.map((d) => {
      // sqrt dampens raw-mention dominance (a megacap's boilerplate shouldn't win on volume);
      // 1/df is the specificity multiplier — a ticker in every chokepoint is generic, so ↓.
      const tf = Math.sqrt((d.mentions || 0) / maxM);            // 0..1, sublinear
      const idf = 1 / (df[d.ticker] || 1);                       // 1 = unique to this chokepoint
      return { ...d, score: +(tf * idf).toFixed(3), generic: (df[d.ticker] || 0) > N / 2 };
    }).sort((a, b) => b.score - a.score || b.mentions - a.mentions);
    return { ...c, discovered: scored };
  });
}
