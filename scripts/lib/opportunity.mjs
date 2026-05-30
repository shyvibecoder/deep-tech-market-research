// Opportunity Score — operationalizes ALPHA.md Edge 1 (duration mispricing): retail alpha
// lives in chokepoints that bind SOON, throw off a DURABLE + DEFENSIBLE rent, and are NOT
// yet priced in. Built entirely from human-owned source fields (bind_window / priced_in /
// durability / substitution_risk / non_consensus) — transparent, no curve-fitting. Pure.
//
// priced_in is a MULTIPLICATIVE GATE on purpose: there is no alpha left in what the market
// has already priced, so a `crowded` thesis scores ~0 however good the underlying business.
// That is the model refusing to confuse a great company with a great *investment*.

// How un-priced the thesis still is — the necessary condition for any edge (0 = no edge left).
export const PRICED_GATE = { low: 1.0, medium: 0.66, high: 0.33, crowded: 0.0 };
// How soon the chokepoint binds (nearer = the market under-discounts it more today).
export const BIND_PROXIMITY = { now: 1.0, "2027": 0.85, "2028-29": 0.65, "2030+": 0.45, "physics-floor": 0.6 };
// How durable the resulting rent is once it binds.
export const DURABILITY = { "very-high": 1.0, high: 0.75, medium: 0.5, low: 0.25 };
// Defensibility = inverse of substitution risk (a rent that's easily substituted isn't a rent).
export const DEFENSIBILITY = { low: 1.0, medium: 0.5, high: 0.0 };

const get = (map, k, dflt = 0.5) => (k in map ? map[k] : dflt);

export function opportunityScore(s = {}) {
  const gate = get(PRICED_GATE, s.priced_in);
  const bind = get(BIND_PROXIMITY, s.bind_window);
  const dur = get(DURABILITY, s.durability);
  const def = get(DEFENSIBILITY, s.substitution_risk);
  const quality = 0.40 * bind + 0.35 * dur + 0.25 * def; // how good the rent is when it arrives
  const contrarian = !!s.non_consensus;
  const bonus = contrarian ? 1.15 : 1.0;               // a genuinely non-consensus view is where edge hides
  const score = Math.min(100, 100 * gate * quality * bonus);
  return {
    score: Math.round(score),
    gate: +gate.toFixed(2),
    quality: +quality.toFixed(2),
    contrarian,
    components: { bind_proximity: +bind.toFixed(2), durability: +dur.toFixed(2), defensibility: +def.toFixed(2) },
  };
}

export function rankOpportunities(scarcities) {
  return (scarcities || [])
    .map((s) => ({ id: s.id, scarcity: s.scarcity, sector: s.sector, ...opportunityScore(s) }))
    .sort((a, b) => b.score - a.score);
}
