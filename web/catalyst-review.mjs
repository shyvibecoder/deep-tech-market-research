// Catalyst draft-PR review (browser): translate a FIRED catalyst trigger's policy action into a concrete,
// reviewable portfolio.json edit — `cut` drops the name, `trim` reduces it by a third — then renormalize the
// plan to sum to 1. PURE (no DOM); app.js opens the PR with the admin token. F9: the bot never edits your
// plan or trades — this only DRAFTS a PR you review and merge.
export function applyCatalystEdit(portfolioDoc, { affects = [], edit = null } = {}) {
  if (!portfolioDoc?.holdings || !edit || !affects.length) return portfolioDoc;
  const set = new Set(affects);
  let holdings = portfolioDoc.holdings.map((h) => {
    if (!set.has(h.ticker)) return { ...h };
    if (edit === "cut") return { ...h, weight: 0 };
    if (edit === "trim") return { ...h, weight: +((h.weight || 0) * (2 / 3)).toFixed(4) };
    return { ...h };
  }).filter((h) => (h.weight || 0) > 0); // a cut name (weight 0) drops out of the plan
  const tot = holdings.reduce((a, h) => a + (h.weight || 0), 0) || 1; // renormalize to sum 1
  holdings = holdings.map((h) => { const w = +((h.weight || 0) / tot).toFixed(4); return { ...h, weight: w, target_usd: Math.round(w * (portfolioDoc.sleeve_usd || 0)) }; });
  return { ...portfolioDoc, updated: new Date().toISOString().slice(0, 10), holdings };
}

// Is this fired trigger plan-editing (so the dashboard offers a "Draft PR")? Only cut/trim with affected names.
export function catalystEditable(trigger) {
  const e = trigger?.watch?.edit;
  return (e === "cut" || e === "trim") && Array.isArray(trigger?.watch?.affects) && trigger.watch.affects.length > 0
    ? { edit: e, affects: trigger.watch.affects } : null;
}
