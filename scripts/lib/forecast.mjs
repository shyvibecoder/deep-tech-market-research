// Accountability ledger: record every dated, resolvable per-name call the system
// makes, then grade it against what actually happened. This is the moat — a scored,
// append-only track record that compounds with time and can't be back-dated. Pure.

export const addDays = (d, n) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// Turn the current scan into resolvable claims: each per-name TSMOM tilt (overweight
// → expect the price up over the horizon; underweight → down). Anchors the price now
// so resolution is self-contained (no need to re-fetch history).
export function makeForecasts(signals, today, horizon = 21) {
  const per = signals?.regime?.per_name || [];
  const quotes = signals?.quotes || {};
  const out = [];
  for (const t of per) {
    if (t.tilt !== "overweight" && t.tilt !== "underweight") continue;
    const q = quotes[t.ticker];
    const price = q && !q.error ? q.price : null;
    if (!(price > 0)) continue;
    out.push({
      id: `${today}:tsmom_tilt:${t.ticker}`, date: today, type: "tsmom_tilt", subject: t.ticker,
      claim: t.tilt === "overweight" ? "up" : "down", horizon_days: horizon,
      price_at: price, resolve_on: addDays(today, horizon), basis: t.tilt,
    });
  }
  return out;
}

// Resolve claims whose horizon has matured, using the current price vs the anchor.
export function resolveDue(open, currentPrices, today) {
  const resolved = [], stillOpen = [];
  for (const f of open || []) {
    if (today < f.resolve_on) { stillOpen.push(f); continue; }
    if (f.type === "scarcity_rel") {
      // P4/F2: equal-weight per-ticker returns over fixed membership (new forecasts carry basket_prices);
      // fall back to the legacy price-weighted mean-ratio for forecasts created before this change.
      let bRet, cRet;
      if (f.basket_prices && f.complex_prices) {
        bRet = basketReturn(f.basket_prices, currentPrices); cRet = basketReturn(f.complex_prices, currentPrices);
      } else {
        const bNow = meanPrice(currentPrices, f.proxies), cNow = meanPrice(currentPrices, f.complex_tickers);
        bRet = (bNow != null && f.basket_at) ? bNow / f.basket_at - 1 : null;
        cRet = (cNow != null && f.complex_at) ? cNow / f.complex_at - 1 : null;
      }
      if (bRet == null || cRet == null) { stillOpen.push(f); continue; }
      const rel = bRet - cRet;
      resolved.push({ ...f, resolved_on: today, rel: +rel.toFixed(4), correct: f.claim === "underperform" ? rel < 0 : rel > 0 });
    } else if (f.type === "sizing_tilt") {
      // CRITICAL-2 grading: did the signal tilt beat the research baseline over the horizon?
      const sRet = weightedReturn(f.signal_weights, f.prices, currentPrices);
      const rRet = weightedReturn(f.research_weights, f.prices, currentPrices);
      if (sRet == null || rRet == null) { stillOpen.push(f); continue; }
      const rel = sRet - rRet;
      resolved.push({ ...f, resolved_on: today, rel: +rel.toFixed(4), signal_return: +sRet.toFixed(4), research_return: +rRet.toFixed(4), correct: rel > 0 });
    } else {
      const q = currentPrices?.[f.subject]; const price = q && !q.error ? q.price : null;
      if (price > 0 && f.price_at > 0) resolved.push({ ...f, resolved_on: today, realized_return: +(price / f.price_at - 1).toFixed(4), correct: f.claim === "up" ? price / f.price_at - 1 > 0 : price / f.price_at - 1 < 0 });
      else stillOpen.push(f);
    }
  }
  return { resolved, stillOpen };
}

// --- Grade the G3 SIZING TILT (CRITICAL-2): is the signal-tilted weight vector actually better than
// NOT tilting? Record the signal vs research portfolio weights + per-ticker anchor prices; at horizon,
// the claim "signal_beats_research" is true iff the signal-weighted return exceeds the research-weighted
// return. This turns the allocation overlay from an ungraded assertion into a falsifiable, scored call —
// if tilting doesn't beat the baseline out-of-sample, the scorecard says so (ALPHA.md honesty gate). ---
export function weightedReturn(weights, anchorPrices, currentQuotes) {
  let wsum = 0, acc = 0;
  for (const t of Object.keys(weights || {})) {
    const a = anchorPrices?.[t], q = currentQuotes?.[t], now = q && !q.error ? q.price : null;
    if (a > 0 && now > 0) { acc += weights[t] * (now / a - 1); wsum += weights[t]; } // renormalize over resolvable names
  }
  return wsum > 0 ? acc / wsum : null;
}

export function makeSizingForecast(rebalance, quotes, today, horizon = 42) {
  if (!rebalance?.signal?.rows?.length || !rebalance?.research?.rows?.length) return [];
  const sigUsd = {}, resUsd = {}, prices = {};
  for (const r of rebalance.signal.rows) sigUsd[r.ticker] = r.target_usd;
  for (const r of rebalance.research.rows) resUsd[r.ticker] = r.target_usd;
  for (const t of Object.keys(sigUsd)) { const q = quotes?.[t]; if (q && !q.error && q.price > 0) prices[t] = q.price; }
  const priced = Object.keys(prices);
  if (priced.length < 2) return [];
  const norm = (m) => { const tot = priced.reduce((a, k) => a + (m[k] || 0), 0) || 1; const o = {}; for (const k of priced) o[k] = (m[k] || 0) / tot; return o; };
  return [{
    id: `${today}:sizing_tilt`, date: today, type: "sizing_tilt", subject: "portfolio",
    claim: "signal_beats_research", horizon_days: horizon, resolve_on: addDays(today, horizon),
    signal_weights: norm(sigUsd), research_weights: norm(resUsd), prices,
  }];
}

export function updateScorecard(sc, resolved) {
  const s = sc && sc.by_tilt ? JSON.parse(JSON.stringify(sc))
    : { by_tilt: { overweight: { n: 0, hits: 0 }, underweight: { n: 0, hits: 0 } }, total: { n: 0, hits: 0 } };
  if (!s.by_signal) s.by_signal = {};
  for (const r of resolved || []) {
    s.total.n++; if (r.correct) s.total.hits++;
    if (r.type === "scarcity_rel") {
      (s.by_signal[r.claim] ||= { n: 0, hits: 0 }); s.by_signal[r.claim].n++; if (r.correct) s.by_signal[r.claim].hits++;
    } else if (r.type === "sizing_tilt") {
      (s.by_signal.sizing_tilt ||= { n: 0, hits: 0 }); s.by_signal.sizing_tilt.n++; if (r.correct) s.by_signal.sizing_tilt.hits++;
    } else {
      const k = r.claim === "up" ? "overweight" : "underweight"; s.by_tilt[k].n++; if (r.correct) s.by_tilt[k].hits++;
    }
  }
  s.hit_rate = s.total.n ? +(s.total.hits / s.total.n).toFixed(3) : null;
  return s;
}

// --- Grade the ALPHA signal (de-rating/inflecting) on a RELATIVE basis: does a
// flagged scarcity basket under/out-perform the AI-capex complex over the horizon? ---
export function meanPrice(quotes, tickers) {
  const ps = (tickers || []).map((t) => quotes?.[t]).filter((q) => q && !q.error && q.price > 0).map((q) => q.price);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}

// Audit P4/F2: per-ticker anchor prices + an EQUAL-WEIGHT basket return over FIXED membership. meanPrice
// (a price-weighted mean) let a high-nominal-price name dominate, and recomputing it over a changed
// membership at resolution wasn't a return at all. priceMap snapshots {ticker: price} at anchor time;
// basketReturn averages each anchored ticker's OWN return, using only those that resolve (intersection).
export function priceMap(quotes, tickers) {
  const m = {};
  for (const t of (tickers || [])) { const q = quotes?.[t]; if (q && !q.error && q.price > 0) m[t] = q.price; }
  return m;
}
export function basketReturn(anchorPrices, currentQuotes) {
  const rs = [];
  for (const t of Object.keys(anchorPrices || {})) {
    const q = currentQuotes?.[t]; const now = q && !q.error ? q.price : null;
    if (now > 0 && anchorPrices[t] > 0) rs.push(now / anchorPrices[t] - 1);
  }
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

// A high Opportunity Score (ALPHA.md Edge 1) is a structural CLAIM — binds soon, durable,
// not yet priced → it should outperform the complex. Grade it even when the tape is quiet.
export const OPPORTUNITY_FORECAST_THRESHOLD = 60;

export function makeScarcityForecasts(scarcities, signals, today, horizon = 42, complexTickers = []) {
  const quotes = signals?.quotes || {}, sigs = signals?.scarcity_signals || {};
  const complex_at = meanPrice(quotes, complexTickers);
  const complex_prices = priceMap(quotes, complexTickers);   // P4: per-ticker anchor for equal-weight resolution
  if (complex_at == null) return [];
  const out = [];
  for (const s of scarcities || []) {
    const sig = sigs[s.id] || {};
    const basket_at = meanPrice(quotes, s.tickers);
    if (basket_at == null) continue;
    const base = { date: today, type: "scarcity_rel", subject: s.id, proxies: s.tickers,
      complex_tickers: complexTickers, basket_at, complex_at, basket_prices: priceMap(quotes, s.tickers), complex_prices,
      horizon_days: horizon, resolve_on: addDays(today, horizon) };
    if (sig.flag === "de-rating" || sig.flag === "inflecting") {
      // The tape is moving: crowded de-rates (underperform), under-priced inflects (outperform).
      out.push({ ...base, id: `${today}:scarcity_rel:${s.id}`, claim: sig.flag === "de-rating" ? "underperform" : "outperform", source: "de-rating" });
    } else if (sig.forced_flow?.flag === "accumulate") {
      // Forced/neglect selling INTO an intact thesis (Edge 3) → predict mean-reversion outperformance.
      out.push({ ...base, id: `${today}:scarcity_rel:ff:${s.id}`, claim: "outperform", source: "forced-flow", dislocation: sig.forced_flow.dislocation });
    } else if (typeof sig.score === "number" && sig.score >= OPPORTUNITY_FORECAST_THRESHOLD) {
      // Structural opportunity the tape hasn't confirmed yet → predict outperformance, and grade it.
      out.push({ ...base, id: `${today}:scarcity_rel:opp:${s.id}`, claim: "outperform", source: "opportunity", opportunity: sig.score });
    }
  }
  return out;
}
