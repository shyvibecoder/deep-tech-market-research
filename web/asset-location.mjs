// ASSET LOCATION — which account (Roth / Traditional / taxable) should hold each name to maximize
// after-tax TERMINAL value. ADVISORY + transparent; never trades. Pure (browser + Node).
//
// We model each name's after-tax terminal MULTIPLE in each account (afterTaxMultiple) and then solve a
// transportation problem (optimizeLocation) — placing every target dollar into the account where it
// compounds to the most after-tax value, subject to each account's balance. This is the TRUE optimum for
// the modelled multiples (not a sort-by-one-metric heuristic): it captures BOTH
//   • the Roth growth benefit — the highest-EXPECTED-RETURN names gain the MOST from tax-free compounding,
//     so scarce Roth room goes to them first (a low-growth, high-yield diversifier gains far less from a
//     Roth than a high-growth build-out name does — see afterTaxMultiple), and
//   • the annual tax-drag shelter — what spills to TAXABLE prefers the low-yield names (qualified rates,
//     step-up at death, loss-harvesting), so the dividend/turnover drag is minimised on the residual.
// The numbers use explicit assumptions (below) you can override — guidance, not a guaranteed optimum, and
// it does NOT model your exact bracket arbitrage, RMDs, contributions, or estate plan.

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
    // Turnover is a SECONDARY shelter driver — kept small so the intrinsic DIVIDEND drag dominates the
    // location decision (turnover is a choice you make INSIDE the tax-advantaged account, not an asset
    // property; a name held in taxable would be held buy-and-hold).
    turnover: tactical ? 0.2 : 0.05,
    growth: Number.isFinite(q.growth) ? q.growth : (div ? 0.04 : 0.09), // expected pre-tax annual return
    div,
  };
  return { ...base, ...(overrides[h.ticker] || {}) };
}

// Annual tax drag a name suffers IN A TAXABLE account: dividends taxed yearly at the qualified rate +
// the gains a high-turnover name realizes each year taxed at LTCG. Sheltering it avoids this.
export function annualDragRate(p, tax = DEFAULT_TAX) {
  return p.yieldPct * tax.qualified + p.turnover * TURNOVER_REALIZED * tax.ltcg;
}

// After-tax TERMINAL value per $1 placed today, by account, over an N-year horizon. This is the objective
// the optimizer maximizes — every comparison the placement makes reduces to "which account gives this
// dollar of THIS name the higher multiple?".
//   • roth        — tax-free forever: (1+g)^N. Biggest payoff for the highest-growth names → they win Roth.
//   • traditional — ordinary-rate on withdrawal: (1+g)^N·(1−ordinary). Same growth ranking as Roth but a
//                   flat haircut, so it's the second-best home for high growth once Roth is full.
//   • taxable     — qualified-rate dividend drag each year shaves the compounding rate; the terminal GAIN
//                   is taxed at LTCG (step-up at death would make this strictly better, so this is
//                   conservative): 1 + ((1 + g − y·qualified)^N − 1)·(1−ltcg). Low-yield names lose the
//                   least here, so they're what optimally spills to taxable.
export function afterTaxMultiple(p, account, { horizonYears = 20, tax = DEFAULT_TAX } = {}) {
  const N = Math.max(0, horizonYears), g = p.growth || 0, y = p.yieldPct || 0;
  if (account === "roth") return Math.pow(1 + g, N);
  if (account === "traditional" || account === "tax-advantaged" || account === "ira") return Math.pow(1 + g, N) * (1 - tax.ordinary);
  const netGrowth = Math.max(0, 1 + g - y * tax.qualified); // taxable: annual qualified-dividend drag
  const grossTerminal = Math.pow(netGrowth, N);
  return 1 + (grossTerminal - 1) * (1 - tax.ltcg); // terminal gain taxed at LTCG (step-up ⇒ conservative)
}

// OPTIMAL placement: a transportation problem. `items` = [{ key, value, mult:{account:multiple,…} }];
// `capacities` = { account: $ }. Maximize Σ value·multiple, each item fully placed (or to a synthetic
// overflow when total value > total capacity), no account over its balance. Solved by a greedy feasible
// start followed by improvement to a FIXED POINT over the three elementary moves of a transportation graph:
// relocate-into-slack, 2-name swap, and 3-name rotation. With ≤3 real accounts those moves cancel every
// elementary negative cycle (lengths 4 and 6), so the fixed point is the GLOBAL optimum (verified against a
// brute-force search in the tests). Returns { rows:[{key,account,value}], unplaced:{key:$}, objective }.
export function optimizeLocation(items, capacities) {
  const real = Object.keys(capacities || {}).filter((a) => (+capacities[a] || 0) > 1e-9);
  const totalVal = items.reduce((s, it) => s + (it.value || 0), 0);
  const totalCap = real.reduce((s, a) => s + (+capacities[a] || 0), 0);
  const SINK = "__unplaced__";
  const caps = {}; real.forEach((a) => caps[a] = +capacities[a]);
  if (totalVal > totalCap + 1e-6) caps[SINK] = totalVal - totalCap; // overflow that won't fit anywhere
  const accts = Object.keys(caps);
  const n = items.length;
  const mult = (i, a) => a === SINK ? -1e18 : (Number.isFinite(items[i].mult?.[a]) ? items[i].mult[a] : -1e15);

  const x = items.map(() => Object.fromEntries(accts.map((a) => [a, 0])));
  const slack = { ...caps };
  // Greedy feasible start: each item into its best-multiple accounts that still have room.
  items.forEach((it, i) => {
    let left = it.value || 0;
    for (const a of [...accts].sort((p, q) => mult(i, q) - mult(i, p))) {
      if (left <= 1e-9) break;
      const amt = Math.min(left, slack[a]);
      if (amt > 0) { x[i][a] += amt; slack[a] -= amt; left -= amt; }
    }
  });

  const EPS = 1e-7;
  for (let guard = 0; guard < 200000; guard++) {
    let best = null;
    const consider = (gain, apply) => { if (gain > EPS && (!best || gain > best.gain)) best = { gain, apply }; };
    // relocate i: a -> b (b has slack)
    for (let i = 0; i < n; i++) for (const a of accts) { if (x[i][a] <= EPS) continue; for (const b of accts) { if (b === a || slack[b] <= EPS) continue; const d = Math.min(x[i][a], slack[b]); consider((mult(i, b) - mult(i, a)) * d, () => { x[i][a] -= d; x[i][b] += d; slack[a] += d; slack[b] -= d; }); } }
    // swap-2: i in a, j in b → i to b, j to a
    for (let i = 0; i < n; i++) for (const a of accts) { if (x[i][a] <= EPS) continue; for (let j = 0; j < n; j++) { if (j === i) continue; for (const b of accts) { if (b === a || x[j][b] <= EPS) continue; const d = Math.min(x[i][a], x[j][b]); consider(((mult(i, b) + mult(j, a)) - (mult(i, a) + mult(j, b))) * d, () => { x[i][a] -= d; x[i][b] += d; x[j][b] -= d; x[j][a] += d; }); } } }
    // rotate-3: i:a→b, j:b→c, k:c→a (distinct items, distinct accounts)
    if (accts.length >= 3) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (j === i) continue; for (let k = 0; k < n; k++) { if (k === i || k === j) continue;
      for (const a of accts) { if (x[i][a] <= EPS) continue; for (const b of accts) { if (b === a || x[j][b] <= EPS) continue; for (const c of accts) { if (c === a || c === b || x[k][c] <= EPS) continue;
        const d = Math.min(x[i][a], x[j][b], x[k][c]);
        consider(((mult(i, b) + mult(j, c) + mult(k, a)) - (mult(i, a) + mult(j, b) + mult(k, c))) * d, () => { x[i][a] -= d; x[i][b] += d; x[j][b] -= d; x[j][c] += d; x[k][c] -= d; x[k][a] += d; });
      } } }
    } }
    if (!best) break;
    best.apply();
  }

  const rows = [], unplaced = {};
  let objective = 0;
  items.forEach((it, i) => { for (const a of accts) { const v = x[i][a]; if (v <= 1e-6) continue; if (a === SINK) unplaced[it.key] = (unplaced[it.key] || 0) + v; else { rows.push({ key: it.key, account: a, value: v }); objective += v * mult(i, a); } } });
  return { rows, unplaced, objective };
}

// Locate each holding's dollars across accounts to maximize after-tax terminal value (true optimum, above).
// `capacities` = {roth, traditional, taxable} in $; if roth & traditional aren't both given we run a 2-way
// (combined tax-advantaged vs taxable) split. Returns one row per (ticker × account) allocation with value>0.
export function locateAssets(holdings, { capacities = {}, tax = DEFAULT_TAX, horizonYears = 20, quotes = {}, overrides = {}, sleeveUsd = 0 } = {}) {
  const cap = { roth: +capacities.roth || 0, traditional: +capacities.traditional || 0, taxable: +capacities.taxable || 0, ira: +capacities.ira || 0 };
  const threeWay = cap.roth > 0 && cap.traditional > 0; // need BOTH split out for a Roth-vs-Traditional decision
  const capOf = threeWay ? { roth: cap.roth, traditional: cap.traditional, taxable: cap.taxable } : { "tax-advantaged": cap.roth + cap.traditional + cap.ira, taxable: cap.taxable };
  const accts = Object.keys(capOf);

  const items = (holdings || [])
    .filter((h) => h && h.ticker && (h.weight > 0 || h.target_usd > 0))
    .map((h) => {
      const value = Number.isFinite(h.target_usd) && h.target_usd > 0 ? h.target_usd : (h.weight || 0) * sleeveUsd;
      const p = taxProfile(h, { quotes, overrides });
      const mult = {}; accts.forEach((a) => mult[a] = afterTaxMultiple(p, a, { horizonYears, tax }));
      return { key: h.ticker, value, mult, yieldPct: p.yieldPct, growth: p.growth, dragRate: annualDragRate(p, tax), profile: p };
    });
  const byKey = new Map(items.map((it) => [it.key, it]));

  const { rows: placed, objective } = optimizeLocation(items, capOf);
  const rows = placed.map((r) => {
    const it = byKey.get(r.key);
    return {
      ticker: r.key, account: r.account, value: Math.round(r.value), yieldPct: it.yieldPct, growth: it.growth,
      drag_rate: +it.dragRate.toFixed(4),
      after_tax_multiple: +afterTaxMultiple(it.profile, r.account, { horizonYears, tax }).toFixed(3),
      annual_drag_avoided: r.account === "taxable" ? 0 : Math.round(r.value * it.dragRate),
    };
  }).sort((a, b) => b.value - a.value);

  // Headline = the after-tax TERMINAL $ this placement adds vs a PRO-RATA baseline (every name spread
  // across accounts in proportion to balances) — isolates the value of LOCATION, holding total
  // tax-advantaged room fixed. Captures the Roth growth benefit, not just dividend drag.
  const totalCap = accts.reduce((s, a) => s + capOf[a], 0) || 1;
  let baseObj = 0;
  for (const it of items) for (const a of accts) baseObj += it.value * (capOf[a] / totalCap) * it.mult[a];
  const after_tax_uplift = Math.max(0, Math.round(objective - baseObj));

  const annual = rows.reduce((s, r) => s + r.annual_drag_avoided, 0);
  const horizon_value = +(annual * ((Math.pow(1.06, horizonYears) - 1) / 0.06)).toFixed(0);
  return {
    three_way: threeWay, horizon_years: horizonYears, tax, rows,
    summary: {
      after_tax_uplift_usd: after_tax_uplift,
      annual_drag_avoided: +annual.toFixed(0),
      horizon_drag_avoided: horizon_value,
      note: threeWay ? "Roth ← highest after-tax growth, then Traditional; taxable ← the tax-efficient residual." : "Only a combined tax-advantaged balance was given — add Roth + Traditional balances for the full 3-way split.",
    },
  };
}

// Tax-located REBALANCE [D2]: net the committee-aware target against what you ACTUALLY hold (per account) →
// BUY rows (net-new dollars placed OPTIMALLY into AVAILABLE room via optimizeLocation) and SELL/trim rows
// (in-place; a taxable lot is buy-and-hold unless its ticker is in `taxableAnchorTrimOk` — we don't realize
// gains just to relocate). All-cash reduces to the deploy plan (held empty → all buys, globally optimal).
// `held` = { ticker: { roth, traditional, taxable, ira } } in $. Pure + deterministic.
export function rebalanceLocated(holdings, { held = {}, capacities = {}, tax = DEFAULT_TAX, horizonYears = 20, taxableAnchorTrimOk = [], quotes = {}, overrides = {} } = {}) {
  const cap = { roth: +capacities.roth || 0, traditional: +capacities.traditional || 0, taxable: +capacities.taxable || 0, ira: +capacities.ira || 0 };
  const threeWay = cap.roth > 0 && cap.traditional > 0;
  const capOf = threeWay ? { roth: cap.roth, traditional: cap.traditional, taxable: cap.taxable } : { "tax-advantaged": cap.roth + cap.traditional + cap.ira, taxable: cap.taxable };
  const accts = Object.keys(capOf);
  const bookTotal = accts.reduce((a, k) => a + capOf[k], 0);
  const normAcct = (k) => k === "taxable" ? "taxable" : (threeWay ? (k === "ira" ? "traditional" : k) : "tax-advantaged");
  const okSet = new Set(taxableAnchorTrimOk);

  const items = (holdings || []).filter((h) => h && h.ticker && h.weight > 0).map((h) => { const p = taxProfile(h, { quotes, overrides }); const mult = {}; accts.forEach((a) => mult[a] = afterTaxMultiple(p, a, { horizonYears, tax })); return { ticker: h.ticker, weight: h.weight, growth: p.growth, yieldPct: p.yieldPct, dragRate: annualDragRate(p, tax), mult }; });
  const wsum = items.reduce((a, it) => a + it.weight, 0) || 1;
  items.forEach((it) => { it.target = (it.weight / wsum) * bookTotal; });

  const heldA = {}; // ticker -> { acct: $ } (normalized to capOf's account keys)
  for (const t in (held || {})) { heldA[t] = {}; for (const k in held[t]) { const a = normAcct(k); heldA[t][a] = (heldA[t][a] || 0) + (held[t][k] || 0); } }
  const heldTot = (t) => Object.values(heldA[t] || {}).reduce((a, b) => a + b, 0);
  const heldInAcct = {}; accts.forEach((a) => heldInAcct[a] = 0);
  for (const t in heldA) for (const a in heldA[t]) heldInAcct[a] = (heldInAcct[a] || 0) + heldA[t][a];

  const rows = [], buyLegs = [];
  const sellOrder = [...accts].sort((a, b) => (a === "taxable" ? 1 : 0) - (b === "taxable" ? 1 : 0)); // sell tax-advantaged first, taxable last
  const sellName = (t, amount, yieldPct, notInPlan) => {
    let need = amount;
    for (const a of sellOrder) { if (need <= 1) break; const have = Math.round(heldA[t]?.[a] || 0); if (have <= 0) continue; const amt = Math.min(have, need); const blocked = a === "taxable" && !okSet.has(t); rows.push({ ticker: t, account: a, action: blocked ? "hold (taxable anchor — trim bar not met)" : (notInPlan ? "sell (not in plan)" : "trim"), amount: amt, blocked, yieldPct }); need -= amt; }
  };
  for (const it of items) { const d = Math.round(it.target - heldTot(it.ticker)); if (d < -1) sellName(it.ticker, -d, it.yieldPct, false); else if (d > 1) buyLegs.push({ ...it, buy: d }); }
  for (const t in heldA) if (!items.some((it) => it.ticker === t)) sellName(t, Math.round(heldTot(t)), 0, true); // held but dropped from the plan → exit

  // Buys go into AVAILABLE room only: capacity − held + (non-blocked sells that free cash in that account).
  // Then they're placed OPTIMALLY (after-tax terminal value) into that room — same optimizer as the deploy.
  const freed = {}; accts.forEach((a) => freed[a] = 0);
  for (const r of rows) if (!r.blocked && (r.action === "trim" || r.action.startsWith("sell"))) freed[r.account] += r.amount;
  const avail = {}; accts.forEach((a) => avail[a] = Math.max(0, capOf[a] - heldInAcct[a] + freed[a]));
  const byTicker = new Map(buyLegs.map((b) => [b.ticker, b]));
  const { rows: placed, unplaced } = optimizeLocation(buyLegs.map((b) => ({ key: b.ticker, value: b.buy, mult: b.mult })), avail);
  for (const pr of placed) { const b = byTicker.get(pr.key); const amt = Math.round(pr.value); if (amt > 1) rows.push({ ticker: pr.key, account: pr.account, action: "buy", amount: amt, yieldPct: b.yieldPct, annual_drag_avoided: pr.account === "taxable" ? 0 : Math.round(amt * b.dragRate) }); }
  const needs_new_cash = Object.values(unplaced).reduce((a, b) => a + Math.max(0, b), 0); // buys that didn't fit available room

  const sumOf = (pred) => Math.round(rows.filter(pred).reduce((a, r) => a + r.amount, 0));
  return {
    three_way: threeWay, rows,
    summary: {
      buy_usd: sumOf((r) => r.action === "buy"),
      sell_usd: sumOf((r) => !r.blocked && (r.action === "trim" || r.action.startsWith("sell"))),
      blocked_usd: sumOf((r) => r.blocked),
      needs_new_cash_usd: Math.round(needs_new_cash),
      annual_drag_avoided: rows.reduce((a, r) => a + (r.annual_drag_avoided || 0), 0),
    },
  };
}
