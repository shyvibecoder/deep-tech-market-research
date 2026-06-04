// Target-weight sizing: turn the per-name TSMOM tilt + regime posture into concrete,
// account-aware, bounded allocation deltas (analysis → action). Adds only in risk-on
// (don't accelerate into weakness); trims (underweight) allowed in any posture; the
// taxable sleeve stays buy-and-hold. Pure (browser+Node). Bounded by maxDeltaPct.
export function targetDeltas(holdings, perName, regime, { maxDeltaPct = 0.25 } = {}) {
  const tilt = Object.fromEntries((perName || []).map((t) => [t.ticker, t.tilt]));
  const posture = regime?.posture;
  return (holdings || []).map((h) => {
    const t = tilt[h.ticker] || "n/a";
    let dir = t === "overweight" ? 1 : t === "underweight" ? -1 : 0;
    if (dir > 0 && posture !== "risk-on") dir = 0; // only accelerate in a risk-on regime
    const active = h.account === "ira";            // tactical sleeve only (tax-free turnover)
    const delta = active ? dir * maxDeltaPct : 0;
    return {
      ticker: h.ticker, account: h.account, tilt: t,
      delta_pct: +(delta * 100).toFixed(1),
      action: !active ? "hold (taxable anchor)" : delta > 0 ? "add" : delta < 0 ? "trim" : "hold",
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// G3 — volatility-tilted target weights + an account-aware rebalance plan (analysis → allocation).
// HONEST SCOPE: this is a LIGHT single-name inverse-VOL tilt, NOT correlation/covariance-aware. On a
// ~1.0-internally-correlated book (this one) a standalone-vol tilt does little for PORTFOLIO drawdown —
// true equal-risk-contribution sizing waits on G2 (a genuinely uncorrelated 2nd axis to balance). The
// output is ADVISORY and currently UNGRADED (not yet scored by the forecast ledger) — do not auto-execute.
// No tuned constants: every multiplier is coarse, bounded, economically motivated (REGIME/ALPHA.md).
// Two vectors side by side: RESEARCH (your portfolio.json weights + a LIGHT inverse-vol tilt only)
// and SIGNAL (research × Opportunity factor × regime tilt × the same risk tilt — so a committee
// "crowded" downgrade shrinks the weight and surfaces a trim; this closes the thesis→allocation link).
// Funding: IRA (tax-free) self-funds (trims pay for buys); TAXABLE buys come from cash and a taxable
// trim only ACTIONS when a higher bar is met (ticker in taxableTrimOk: broken/strong de-rating or the
// cost-basis trim rule) — else the ideal weight is shown but the action stays "hold (anchor)".

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// Inverse-volatility tilt, bounded to [1-cap, 1+cap], centered at the geometric-mean vol so the
// average name is ~1.0 (a tilt, not a re-scale). vols = { ticker: annualizedVol }. Missing → 1.0.
export function riskFactors(tickers, vols, { cap = 0.15 } = {}) {
  const valid = (tickers || []).filter((t) => Number.isFinite(vols?.[t]) && vols[t] > 0);
  const factor = {};
  for (const t of tickers || []) factor[t] = 1;
  if (valid.length < 2) return factor; // need a cross-section to tilt against
  const center = Math.exp(valid.reduce((a, t) => a + Math.log(vols[t]), 0) / valid.length);
  for (const t of valid) factor[t] = clamp(center / vols[t], 1 - cap, 1 + cap);
  return factor;
}

// Opportunity factor from the 0..100 score: crowded(≈0)→1-cap, top(100)→1+cap. Missing → neutral 1.0.
export function opportunityFactor(score, { cap = 0.30 } = {}) {
  if (!Number.isFinite(score)) return 1;
  return clamp(1 - cap + (2 * cap) * (score / 100), 1 - cap, 1 + cap);
}

// Regime tilt: overweight bites only in a risk-on regime; underweight bites in any regime. ±cap.
export function regimeFactor(tilt, posture, { cap = 0.15 } = {}) {
  if (tilt === "overweight") return posture === "risk-on" ? 1 + cap : 1;
  if (tilt === "underweight") return 1 - cap;
  return 1;
}

// Which sleeve (axis) a holding belongs to — by explicit axis tag or its role. The deep-tech build-out is
// the default; diversifiers (the 2nd axis) are detected so the rebalance keeps each sleeve in its own lane.
export const sleeveAxis = (h) => (h?.axis === "diversifier" || /diversifier|de-correlator/i.test(h?.role || "")) ? "diversifier" : "deep-tech";
// THE canonical "is this holding a diversifier?" predicate — import this everywhere instead of re-typing
// the axis/role test, so the classification can't drift across modules (audit C4).
export const isDiversifierHolding = (h) => sleeveAxis(h) === "diversifier";

// Target-weight vector, normalized PER (account × axis) CELL — so the diversifier sleeve is held to its
// own budget and can't drift into/out of the build-out under the inverse-vol/opportunity tilts. Diversifiers
// get the inverse-vol risk tilt ONLY (never the opportunity/regime tilt — those are build-out concepts).
// mode ∈ {research, signal}. Returns [{ ticker, account, axis, base_usd, factor, target_weight, target_usd }].
export function targetWeights(holdings, {
  mode = "research", vols = {}, perName = [], posture = null, oppByTicker = {},
  sleeveTotals = null, riskCap = 0.15, oppCap = 0.30, regimeCap = 0.15,
} = {}) {
  const hs = (holdings || []).filter((h) => h && h.ticker && h.target_usd > 0);
  const tilt = Object.fromEntries((perName || []).map((t) => [t.ticker, t.tilt]));
  const rf = riskFactors(hs.map((h) => h.ticker), vols, { cap: riskCap });
  const groups = {};
  for (const h of hs) (groups[`${h.account || "ungrouped"}|${sleeveAxis(h)}`] ||= []).push(h);

  const out = [];
  for (const [key, list] of Object.entries(groups)) {
    const [acct, axis] = key.split("|");
    const sleeveTotal = Math.round(sleeveTotals?.[key] ?? list.reduce((a, h) => a + h.target_usd, 0));
    const rows = list.map((h) => {
      let factor = rf[h.ticker] ?? 1;
      if (mode === "signal" && axis !== "diversifier") { // the opportunity/regime tilt is build-out-only
        factor *= opportunityFactor(oppByTicker[h.ticker], { cap: oppCap });
        if (acct === "ira") factor *= regimeFactor(tilt[h.ticker], posture, { cap: regimeCap });
      }
      return { h, factor, raw: h.target_usd * factor };
    });
    const sumRaw = rows.reduce((a, r) => a + r.raw, 0) || 1;
    // Largest-remainder rounding so the cell conserves EXACTLY (Σ target_usd === sleeveTotal),
    // which keeps the rebalance buy/sell identity exact rather than off-by-rounding.
    const exact = rows.map((r) => ({ r, w: r.raw / sumRaw, usd: sleeveTotal * (r.raw / sumRaw) }));
    const cents = exact.map((e) => Math.floor(e.usd));
    let rem = sleeveTotal - cents.reduce((a, b) => a + b, 0);
    exact.map((e, i) => ({ i, frac: e.usd - cents[i] })).sort((a, b) => b.frac - a.frac)
      .forEach((o) => { if (rem > 0) { cents[o.i] += 1; rem -= 1; } });
    exact.forEach((e, i) => out.push({
      ticker: e.r.h.ticker, account: acct, axis, base_usd: e.r.h.target_usd, factor: +e.r.factor.toFixed(3),
      target_weight: +(e.w * 100).toFixed(1), target_usd: cents[i],
    }));
  }
  return out;
}

// Actionable plan vs CURRENT holdings (marketValue per ticker; defaults to base target when absent,
// so the plan shows how risk/signal weighting differs from the static research plan). Applies funding.
export function rebalancePlan(targets, { currentUsd = {}, taxableTrimOk = [], cashBySleeve = {} } = {}) {
  const okSet = new Set(taxableTrimOk);
  const acct = {}; // per-sleeve tallies so funding is checked sleeve-by-sleeve
  const rows = (targets || []).map((t) => {
    const current = Number.isFinite(currentUsd[t.ticker]) ? currentUsd[t.ticker] : t.base_usd;
    const delta = +(t.target_usd - current).toFixed(0);
    const a = (acct[t.account] ||= { buy: 0, sell: 0, blocked: 0 });
    let action, actioned = delta;
    if (delta > 0) { action = "buy"; a.buy += delta; }
    else if (delta < 0) {
      if (t.account === "taxable" && !okSet.has(t.ticker)) {
        action = "hold (anchor — trim bar not met)"; actioned = 0; a.blocked += -delta;
      } else { action = t.account === "ira" ? "trim (funds buys)" : "trim (high-conviction)"; a.sell += -delta; }
    } else action = "hold";
    return {
      ticker: t.ticker, account: t.account, target_weight: t.target_weight,
      current_usd: +current.toFixed(0), target_usd: t.target_usd,
      delta_usd: delta, actioned_usd: actioned, action,
    };
  });
  // HIGH-5: buys must be funded. Per sleeve, NEW cash needed = buys not covered by actioned sells +
  // that sleeve's available dry powder. The IRA self-funds (buy≈sell) so it nets ~0; the taxable sleeve,
  // whose anchor trims are blocked, surfaces the real outlay instead of implying free money.
  let buy = 0, sell = 0, blocked = 0, needCash = 0;
  for (const [name, v] of Object.entries(acct)) {
    buy += v.buy; sell += v.sell; blocked += v.blocked;
    needCash += Math.max(0, v.buy - v.sell - (cashBySleeve[name] || 0));
  }
  return { rows, summary: {
    buy_usd: +buy.toFixed(0), sell_usd: +sell.toFixed(0), net_usd: +(buy - sell).toFixed(0),
    blocked_trim_usd: +blocked.toFixed(0), needs_new_cash_usd: +needCash.toFixed(0),
  } };
}

// Both columns + plans in one call (what the scan and dashboard consume).
// SAFETY (funding invariant): when live `currentUsd` is supplied we rebalance ONLY the holdings we can
// actually price, and the sleeve total follows the summed market value of exactly those names. Mixing a
// priced-sleeve total with unpriced names defaulting to their full base target manufactures phantom
// "sell everything" trims when a quote is missing — so unpriced names are excluded, not guessed.
export function rebalanceBoth(holdings, inputs = {}) {
  let hs = holdings || [], sleeveTotals = inputs.sleeveTotals;
  if (inputs.currentUsd) {
    hs = hs.filter((h) => Number.isFinite(inputs.currentUsd[h.ticker]));
    // Per (account × axis) cell, so the live diversifier sleeve is rebalanced within its own market value
    // (the axis split is preserved) rather than competing with the build-out for one account budget.
    sleeveTotals = hs.reduce((a, h) => { const k = `${h.account || "ungrouped"}|${sleeveAxis(h)}`; a[k] = (a[k] || 0) + inputs.currentUsd[h.ticker]; return a; }, {});
  }
  const wInputs = { ...inputs, sleeveTotals };
  const planArgs = { currentUsd: inputs.currentUsd, taxableTrimOk: inputs.taxableTrimOk, cashBySleeve: inputs.cashBySleeve };
  return {
    research: rebalancePlan(targetWeights(hs, { ...wInputs, mode: "research" }), planArgs),
    signal: rebalancePlan(targetWeights(hs, { ...wInputs, mode: "signal" }), planArgs),
    risk_cap_pct: +((inputs.riskCap ?? 0.15) * 100).toFixed(0),
  };
}
