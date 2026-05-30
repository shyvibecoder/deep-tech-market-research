// Real implied volatility from Yahoo's (keyless) options endpoint. Pure parser
// `parseAtmIv` (tested) + a best-effort server-side fetch. Gives the Options tab a
// market ATM IV to compare your option's IV against. Returns null on any failure.
export function parseAtmIv(json, spot) {
  const res = json?.optionChain?.result?.[0];
  const opt = res?.options?.[0];
  const s = spot ?? res?.quote?.regularMarketPrice;
  if (!opt || !(s > 0)) return null;
  const nearest = (arr) => (Array.isArray(arr) && arr.length ? arr.reduce((a, b) => (Math.abs(b.strike - s) < Math.abs(a.strike - s) ? b : a)) : null);
  const c = nearest(opt.calls), p = nearest(opt.puts);
  const ivs = [c?.impliedVolatility, p?.impliedVolatility].filter((x) => typeof x === "number" && x > 0);
  if (!ivs.length) return null;
  return +(ivs.reduce((a, b) => a + b, 0) / ivs.length).toFixed(4);
}

export async function fetchAtmIv(ticker) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`,
      { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return parseAtmIv(await r.json());
  } catch { return null; }
}
