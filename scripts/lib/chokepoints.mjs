// Inaccessible-chokepoint heat: the thesis's sharpest idea (the best chokepoints are
// private/foreign/impaired) tracked via FREE public proxies. Heat = market attention
// (news) + proxy momentum; rel = proxy strength vs the AI-capex complex (alpha read).
// Pure; the scanner attaches live heat to the human-owned chokepoints.json list.
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function chokepointHeat({ proxyMom = null, complexMom = null, newsCount = 0 } = {}) {
  const news = clamp01((newsCount || 0) / 5);              // 5+ recent items → max
  const mom = proxyMom == null ? null : clamp01(0.5 + proxyMom * 5); // +10% 1m → ~1.0
  const parts = [news, ...(mom == null ? [] : [mom])];
  const heat = Math.round(100 * (parts.reduce((a, b) => a + b, 0) / parts.length));
  const rel = (proxyMom != null && complexMom != null) ? +(proxyMom - complexMom).toFixed(4) : null;
  return { heat, rel, news_count: newsCount || 0 };
}
