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
