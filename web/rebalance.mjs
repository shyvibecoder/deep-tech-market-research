// Rebalance helper (v4): flag any holding whose ACTUAL weight is >±band from its
// TARGET weight. Pure ESM (browser + Node). positions = {ticker:{shares,price}},
// targets = {ticker: target_usd}, band default 0.25 (±25%).
export function rebalanceFlags(positions, targets, band = 0.25) {
  const mv = {};
  let totalMv = 0, totalTarget = 0;
  for (const [t, p] of Object.entries(positions || {})) {
    if (!(p?.price > 0) || !(p?.shares > 0) || !(targets?.[t] > 0)) continue;
    mv[t] = p.price * p.shares; totalMv += mv[t];
  }
  for (const t of Object.keys(mv)) totalTarget += targets[t];
  const out = [];
  if (!totalMv || !totalTarget) return out;
  for (const t of Object.keys(mv)) {
    const w = mv[t] / totalMv;
    const tw = targets[t] / totalTarget;
    const drift = tw ? w / tw - 1 : null;
    const flagged = drift != null && Math.abs(drift) > band;
    out.push({
      ticker: t,
      weight: +(w * 100).toFixed(1),
      target_weight: +(tw * 100).toFixed(1),
      drift: drift == null ? null : +(drift * 100).toFixed(0),
      flagged,
      action: flagged ? (drift > 0 ? "trim" : "add") : "hold",
    });
  }
  return out;
}
