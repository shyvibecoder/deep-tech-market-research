// Scenario stress simulator: apply the thesis's named shocks to the user's ACTUAL
// sleeve (localStorage positions × scan prices) and show the drawdown vs the −35%
// objective limit. Coarse, documented shock vectors (not fitted). Pure (browser+Node).
export const SCENARIOS = [
  { id: "digestion", name: "2027–28 Deep-tech build-out digestion", market: -0.35, beta: 1.2, note: "the basket's shared failure mode (~1.0 internal correlation)" },
  { id: "rate-shock", name: "2022-style rate shock", market: -0.25, beta: 1.3, note: "long-duration/high-beta hit hardest" },
  { id: "recession", name: "Broad recession", market: -0.30, beta: 1.1, note: "cyclicals fall together" },
  { id: "china-re-peace", name: "China rare-earth 'peace'", market: 0, beta: 1.0, targeted: { MP: -0.5, LYC: -0.5 }, note: "subsidy-floor RE names re-rate down" },
];

export function applyShock(positions, quotes, scenario, { betaDefault = 1.2, betas = {} } = {}) {
  const beta0 = scenario.beta ?? betaDefault;
  let before = 0, after = 0; const per = [];
  for (const [t, p] of Object.entries(positions || {})) {
    const q = quotes?.[t];
    const price = q && !q.error ? q.price : null;
    if (!(price > 0) || !(p?.shares > 0)) continue;
    const mv = price * p.shares;
    // Per-name beta when supplied (so "long-duration/high-beta hit hardest" is real, not just a label);
    // otherwise the scenario's uniform beta (the conservative ~1.0-internal-correlation assumption).
    const beta = Number.isFinite(betas[t]) && betas[t] >= 0 ? betas[t] : beta0;
    const change = scenario.targeted?.[t] != null ? scenario.targeted[t] : scenario.market * beta;
    before += mv; after += mv * (1 + change);
    per.push({ ticker: t, before: Math.round(mv), after: Math.round(mv * (1 + change)), change: +change.toFixed(3) });
  }
  const drawdown = before ? after / before - 1 : 0;
  return {
    scenario: scenario.name, scenario_id: scenario.id,
    before: Math.round(before), after: Math.round(after),
    drawdown: +drawdown.toFixed(4), breaches_35: drawdown <= -0.35,
    per_name: per.sort((a, b) => a.change - b.change),
  };
}
