// G1 — factor attribution: is the book's return ALPHA or just factor/beta? Pure ESM (Node + browser),
// no deps. Regresses the basket's daily return on a small, tradeable factor set and reports the
// intercept (residual alpha) with a t-stat — the teeth ALPHA.md's honesty gate was missing.
//
// CRUCIAL honesty choice: one regressor is a THEMATIC proxy (e.g. QQQ), not just broad market +
// momentum. Without it, this single-factor deep-tech build-out book's theme exposure would masquerade as "alpha".
// The intercept therefore measures return BEYOND what market + momentum + the AI/tech theme explain —
// the test that can actually fail. Parsimonious by design (few factors) given limited daily history.

// Daily simple returns from a price/level series.
export function returns(values) {
  const r = [];
  for (let i = 1; i < (values || []).length; i++) {
    const a = values[i - 1], b = values[i];
    if (a > 0 && Number.isFinite(b)) r.push(b / a - 1);
  }
  return r;
}

// Align several {dates, values} series on their common dates (intersection), preserving order.
// Returns { dates, cols: { name: alignedValues } }. Series with <2 points are dropped.
export function alignByDate(named) {
  const entries = Object.entries(named || {}).filter(([, s]) => s && Array.isArray(s.dates) && s.dates.length > 1);
  if (!entries.length) return { dates: [], cols: {} };
  let common = null;
  for (const [, s] of entries) {
    const set = new Set(s.dates);
    common = common == null ? set : new Set([...common].filter((d) => set.has(d)));
  }
  const dates = [...common].sort();
  const cols = {};
  for (const [name, s] of entries) {
    const byDate = new Map(s.dates.map((d, i) => [d, s.values[i]]));
    cols[name] = dates.map((d) => byDate.get(d));
  }
  return { dates, cols };
}

// --- minimal linear algebra (small k×k, k = #factors+1) ---
function matInverse(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null; // singular (e.g. two identical factors)
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

// OLS y = Xβ + e. X columns are the factor arrays; an intercept column is added internally as col 0.
// Returns { coef:[a, b1..], se:[...], t:[...], r2, n, k } or null when under-determined/singular.
export function ols(y, Xcols) {
  const n = y.length, k = Xcols.length + 1;
  if (n <= k + 1) return null; // need residual degrees of freedom
  const X = y.map((_, i) => [1, ...Xcols.map((c) => c[i])]);
  if (X.some((row) => row.some((v) => !Number.isFinite(v)))) return null;
  // XtX and Xty
  const XtX = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const inv = matInverse(XtX);
  if (!inv) return null;
  const coef = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  // residuals + variance
  let sse = 0, sst = 0; const ybar = y.reduce((s, v) => s + v, 0) / n;
  for (let i = 0; i < n; i++) {
    const yhat = X[i].reduce((s, v, j) => s + v * coef[j], 0);
    sse += (y[i] - yhat) ** 2; sst += (y[i] - ybar) ** 2;
  }
  const sigma2 = sse / (n - k);
  const se = inv.map((row, a) => Math.sqrt(Math.max(0, sigma2 * row[a])));
  const t = coef.map((c, a) => (se[a] > 0 ? c / se[a] : 0));
  return { coef, se, t, r2: sst > 0 ? 1 - sse / sst : 0, n, k };
}

// Attribution: regress asset daily returns on the named factor daily returns. Returns the annualized
// residual alpha + its t-stat + betas + R² + a verdict. ALPHA only when alpha>0 AND |t| ≥ tStat (≈95%).
export function factorAttribution(assetReturns, factorReturns, { freq = 252, tStat = 2 } = {}) {
  const names = Object.keys(factorReturns || {});
  const Xcols = names.map((nm) => factorReturns[nm]);
  const fit = ols(assetReturns, Xcols);
  if (!fit) return null;
  const alphaDaily = fit.coef[0];
  const alpha_t = fit.t[0];
  const betas = {}; names.forEach((nm, i) => { betas[nm] = +fit.coef[i + 1].toFixed(3); });
  const significant = Math.abs(alpha_t) >= tStat;
  return {
    alpha_annual: +(alphaDaily * freq).toFixed(4), // arithmetic annualization
    alpha_t: +alpha_t.toFixed(2),
    betas, r2: +fit.r2.toFixed(3), n: fit.n,
    verdict: significant && alphaDaily > 0 ? "alpha" : "factor/beta",
    note: significant
      ? (alphaDaily > 0 ? "residual alpha is statistically positive" : "significantly NEGATIVE alpha (underperforms its factors)")
      : "no significant alpha — return is explained by market + momentum + theme exposure (i.e. beta)",
  };
}

// Simple absolute external-benchmark check: total return of the book vs a benchmark over the window.
export function benchmarkRelative(assetValues, benchValues) {
  const ar = (assetValues?.length > 1 && assetValues[0] > 0) ? assetValues[assetValues.length - 1] / assetValues[0] - 1 : null;
  const br = (benchValues?.length > 1 && benchValues[0] > 0) ? benchValues[benchValues.length - 1] / benchValues[0] - 1 : null;
  if (ar == null || br == null) return null;
  return { asset_return: +ar.toFixed(4), benchmark_return: +br.toFixed(4), excess: +(ar - br).toFixed(4) };
}

// G1 follow-up — AUTO-RELABEL the scorecard's alpha edge from the factor-attribution verdict, so a high
// forward hit-rate can't read as "skill" when the CURRENT factor regression says the basket's return is
// just market+momentum+theme beta. Previously a human had to eyeball the attribution line and the alpha
// line and connect them; this stamps the verdict ON the alpha edge. `bySignal` = scorecard.by_signal
// (the forward-graded de-rating/inflecting calls) is carried for context (resolved count).
export function alphaEdgeLabel(attribution, bySignal = {}) {
  const resolved = (bySignal?.underperform?.n || 0) + (bySignal?.outperform?.n || 0);
  if (attribution && (attribution.verdict === "alpha" || attribution.verdict === "factor/beta")) {
    const isAlpha = attribution.verdict === "alpha";
    return {
      verdict: isAlpha ? "alpha" : "factor/beta",
      basis: "factor-adjusted",
      alpha_t: attribution.alpha_t ?? null,
      resolved,
      note: isAlpha
        ? `factor-adjusted residual alpha is positive & significant (t=${attribution.alpha_t}) — genuine edge`
        : `current factor read: return is explained by market + momentum + theme (t=${attribution.alpha_t}) — NOT alpha`,
    };
  }
  // No attribution this run (offline / too little history) → can't relabel; report the forward ledger state.
  return {
    verdict: "unproven", basis: resolved ? "forward-only" : "building", resolved,
    note: resolved ? "no factor attribution this run — forward calls only, edge unconfirmed"
      : "building — first relative calls resolve in ~42 days; no factor attribution yet",
  };
}
