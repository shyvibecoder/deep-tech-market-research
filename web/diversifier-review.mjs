// Diversifier funding review. Reads the diversifier-candidates.json feed (the runner's proposal) and, on
// accept, the dashboard opens a PR that funds the sleeve in portfolio.json (the PLAN). PURE — no DOM here;
// app.js renders + opens the PR with the admin token. F9: the bot never writes portfolio.json; you merge.

// Build the proposed plan holdings: scale the build-out by buildoutScale, keep existing diversifiers as-is,
// append the funded names. Mirrors scripts/lib/diversifier.mjs applyFunding (kept in sync — small + pure so
// it runs in the browser against the LIVE portfolio, not a stale snapshot from when the runner ran).
export function applyDiversifierFunding(portfolioDoc, funding, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!portfolioDoc?.holdings || !funding?.newHoldings?.length) return portfolioDoc;
  const { newHoldings, buildoutScale = 1, existingDiversifierTickers = [] } = funding;
  const newSet = new Set(newHoldings.map((h) => h.ticker));
  const scaled = portfolioDoc.holdings.filter((h) => !newSet.has(h.ticker)).map((h) => {
    if (existingDiversifierTickers.includes(h.ticker)) return { ...h }; // existing diversifier untouched — already in the budget
    const weight = +((h.weight || 0) * buildoutScale).toFixed(4);
    return { ...h, weight, target_usd: Math.round(weight * (portfolioDoc.sleeve_usd || 0)) };
  });
  return { ...portfolioDoc, updated: today, holdings: [...scaled, ...newHoldings] };
}

// View model for the Diversifier tab: the qualifying sleeves, the funding proposal, and the resulting plan.
export function diversifierFundingView(feed, portfolioDoc) {
  const qualifiers = (feed?.candidates || []).filter((c) => c.qualifies);
  const funding = feed?.funding?.newHoldings?.length ? feed.funding : null;
  return {
    generated: feed?.generated || null,
    sleeve_pct: feed?.sleeve_pct ?? funding?.sleevePct ?? null,
    qualifiers, funding,
    proposed: funding ? applyDiversifierFunding(portfolioDoc, funding) : null,
  };
}
