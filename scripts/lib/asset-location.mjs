// ASSET LOCATION — which account (Roth / Traditional / taxable) should hold each name to maximize
// after-tax terminal value. ADVISORY + transparent; never trades. Pure (browser + Node).
//
// Two robust, rate-arbitrage-agnostic rules (the part of asset location that holds regardless of your exact
// withdrawal-vs-contribution tax bracket):
//   1) SHELTER THE ANNUAL TAX DRAG — high dividend-yield / high-turnover names belong in a tax-advantaged
//      account; tax-efficient names (low yield, low turnover → qualified rates, step-up at death, loss
//      harvesting) belong in TAXABLE.
//   2) WITHIN tax-advantaged, the HIGHEST-EXPECTED-GROWTH names go to ROTH (the biggest balance compounds
//      tax-free forever), the income/lower-growth names to TRADITIONAL (shelter the ordinary-income drag).
// The numbers use explicit assumptions (below) you can override — this is guidance, not a guaranteed
// optimum, and it does NOT model your exact bracket arbitrage, RMDs, or estate plan.

export const DEFAULT_TAX = { ordinary: 0.35, qualified: 0.15, ltcg: 0.15 }; // marginal rates (overridable)
export const TURNOVER_REALIZED = 0.08; // fraction of a tactical sleeve's value realized as gains per year

const isDiv = (h) => h?.axis === "diversifier" || /diversifier|de-correlator/i.test(h?.role || "");

// Per-name tax character. Uses live data where present (dividend_yield), else documented per-axis defaults:
// diversifiers are dividend-heavy + low-growth + low-turnover; the build-out is low-yield + higher-growth,
// and its TACTICAL (IRA-tier) names turn over. All overridable via `overrides[ticker]`.
export function taxProfile(h, { quotes = {}, overrides = {} } = {}) {
  const div = isDiv(h);
  const q = quotes[h.ticker] || {};
  const tactical = h.account === "ira" || /tactical/i.test(h.role || "");
  const base = {
    yieldPct: Number.isFinite(q.dividend_yield) ? q.dividend_yield : (div ? 0.030 : 0.008),
    turnover: tactical ? 0.6 : 0.1,
    growth: div ? 0.04 : 0.09, // expected pre-tax annual growth (defensive vs build-out alpha)
    div,
  };
  return { ...base, ...(overrides[h.ticker] || {}) };
}

// Annual tax drag a name suffers IN A TAXABLE account: dividends taxed yearly at the qualified rate +
// the gains a high-turnover name realizes each year taxed at LTCG. Sheltering it avoids this.
export function annualDragRate(p, tax = DEFAULT_TAX) {
  return p.yieldPct * tax.qualified + p.turnover * TURNOVER_REALIZED * tax.ltcg;
}

// Locate each holding. `capacities` = {roth, traditional, taxable} in $. If roth+traditional are both 0 we
// fall back to a 2-way split (one combined tax-advantaged bucket vs taxable) and flag it.
export function locateAssets(holdings, { capacities = {}, tax = DEFAULT_TAX, horizonYears = 20, quotes = {}, overrides = {}, sleeveUsd = 0 } = {}) {
  const cap = { roth: +capacities.roth || 0, traditional: +capacities.traditional || 0, taxable: +capacities.taxable || 0, ira: +capacities.ira || 0 };
  const threeWay = cap.roth > 0 && cap.traditional > 0; // need BOTH split out for a Roth-vs-Traditional decision
  const rows = (holdings || [])
    .filter((h) => h && h.ticker && (h.weight > 0 || h.target_usd > 0))
    .map((h) => {
      const value = Number.isFinite(h.target_usd) && h.target_usd > 0 ? h.target_usd : (h.weight || 0) * sleeveUsd;
      const p = taxProfile(h, { quotes, overrides });
      return { ticker: h.ticker, account_now: h.account || "taxable", value, ...p, dragRate: annualDragRate(p, tax) };
    });

  // Greedy placement (whole names): Roth ← highest growth; Traditional ← highest remaining drag; rest → taxable.
  let rothLeft = cap.roth, tradLeft = cap.traditional, taxLeft = cap.taxable;
  const place = {};
  if (threeWay) {
    for (const r of [...rows].sort((a, b) => b.growth - a.growth)) { if (rothLeft >= r.value) { place[r.ticker] = "roth"; rothLeft -= r.value; } }
    for (const r of [...rows].filter((r) => !place[r.ticker]).sort((a, b) => b.dragRate - a.dragRate)) { if (tradLeft >= r.value) { place[r.ticker] = "traditional"; tradLeft -= r.value; } }
    for (const r of rows) if (!place[r.ticker]) place[r.ticker] = "taxable";
  } else {
    // 2-way: only a combined tax-advantaged balance is known (old "ira" = Roth+Traditional undistinguished).
    // Shelter the highest-drag names there, rest taxable.
    let taLeft = cap.roth + cap.traditional + cap.ira;
    for (const r of [...rows].sort((a, b) => b.dragRate - a.dragRate)) { if (taLeft >= r.value) { place[r.ticker] = "tax-advantaged"; taLeft -= r.value; } else place[r.ticker] = "taxable"; }
  }

  const out = rows.map((r) => {
    const suggested = place[r.ticker];
    const sheltered = suggested !== "taxable";
    // Drag avoided this year by sheltering vs leaving it taxable (0 if it lands in taxable anyway).
    const annual_drag_avoided = sheltered ? +(r.value * r.dragRate).toFixed(0) : 0;
    return { ticker: r.ticker, value: Math.round(r.value), account_now: r.account_now, suggested, sheltered, yieldPct: r.yieldPct, growth: r.growth, drag_rate: +r.dragRate.toFixed(4), annual_drag_avoided, mislocated: norm(r.account_now) !== norm(suggested) };
  });

  const annual = out.reduce((a, r) => a + r.annual_drag_avoided, 0);
  // Compounded value of avoiding that drag over the horizon (a simple annuity-style growth of the saving).
  const horizon_value = +(annual * ((Math.pow(1 + (tax.qualified ? 0.06 : 0.06), horizonYears) - 1) / 0.06)).toFixed(0);
  return {
    three_way: threeWay, horizon_years: horizonYears, tax,
    rows: out.sort((a, b) => b.annual_drag_avoided - a.annual_drag_avoided || b.value - a.value),
    summary: {
      annual_drag_avoided: +annual.toFixed(0),
      horizon_drag_avoided: horizon_value,
      mislocated: out.filter((r) => r.mislocated).length,
      note: threeWay ? "Roth ← highest growth, Traditional ← income/drag, taxable ← tax-efficient." : "Only a combined tax-advantaged balance was given — add Roth + Traditional balances for the full 3-way split.",
    },
  };
}

// Treat "ira" (the old combined bucket) as matching either tax-advantaged suggestion so we don't flag every
// IRA holding as mislocated before the user splits Roth/Traditional.
function norm(a) { return a === "ira" ? "tax-advantaged" : (a === "roth" || a === "traditional") ? "tax-advantaged" : a; }
