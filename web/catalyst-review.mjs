// Catalyst draft-PR review (browser): translate a FIRED catalyst trigger's policy action into a concrete,
// reviewable portfolio.json edit — `cut` drops the name, `trim` reduces it by a third — then renormalize the
// plan to sum to 1. PURE (no DOM); app.js opens the PR with the admin token. F9: the bot never edits your
// plan or trades — this only DRAFTS a PR you review and merge.
const isDiv = (h) => h?.axis === "diversifier" || /diversifier|de-correlator/i.test(h?.role || "");

export function applyCatalystEdit(portfolioDoc, { affects = [], edit = null } = {}) {
  if (!portfolioDoc?.holdings || !edit || !affects.length) return portfolioDoc;
  const set = new Set(affects);
  // No-op guard (H3): if none of the affected names are actually in the plan (e.g. a prior cut PR already
  // merged), return the SAME reference so callers can detect "nothing to do" and not open a duplicate PR.
  if (!portfolioDoc.holdings.some((h) => set.has(h.ticker) && (h.weight || 0) > 0)) return portfolioDoc;
  // Preserve each AXIS's original total weight so a build-out cut/trim doesn't silently inflate the
  // diversifier sleeve (M2) — the freed weight is redistributed WITHIN the affected name's axis.
  const origAxis = { d: 0, b: 0 };
  for (const h of portfolioDoc.holdings) origAxis[isDiv(h) ? "d" : "b"] += (h.weight || 0);
  let holdings = portfolioDoc.holdings.map((h) => {
    if (!set.has(h.ticker)) return { ...h };
    if (edit === "cut") return { ...h, weight: 0 };
    if (edit === "trim") return { ...h, weight: +((h.weight || 0) * (2 / 3)).toFixed(4) };
    return { ...h };
  }).filter((h) => (h.weight || 0) > 0); // a cut name (weight 0) drops out of the plan
  if (!holdings.length) return portfolioDoc; // M1: never emit an empty plan
  const curAxis = { d: 0, b: 0 };
  for (const h of holdings) curAxis[isDiv(h) ? "d" : "b"] += h.weight;
  holdings = holdings.map((h) => {
    const k = isDiv(h) ? "d" : "b";
    const scale = curAxis[k] > 0 ? origAxis[k] / curAxis[k] : 1; // keep this axis's total constant
    const w = +(h.weight * scale).toFixed(4);
    return { ...h, weight: w, target_usd: Math.round(w * (portfolioDoc.sleeve_usd || 0)) };
  });
  return { ...portfolioDoc, updated: new Date().toISOString().slice(0, 10), holdings };
}

// Is this fired trigger plan-editing (so the dashboard offers a "Draft PR")? Only cut/trim with affected names.
export function catalystEditable(trigger) {
  const e = trigger?.watch?.edit;
  return (e === "cut" || e === "trim") && Array.isArray(trigger?.watch?.affects) && trigger.watch.affects.length > 0
    ? { edit: e, affects: trigger.watch.affects } : null;
}
