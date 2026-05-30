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
      const bNow = meanPrice(currentPrices, f.proxies), cNow = meanPrice(currentPrices, f.complex_tickers);
      if (bNow == null || cNow == null || !f.basket_at || !f.complex_at) { stillOpen.push(f); continue; }
      const rel = (bNow / f.basket_at - 1) - (cNow / f.complex_at - 1);
      resolved.push({ ...f, resolved_on: today, rel: +rel.toFixed(4), correct: f.claim === "underperform" ? rel < 0 : rel > 0 });
    } else {
      const q = currentPrices?.[f.subject]; const price = q && !q.error ? q.price : null;
      if (price > 0 && f.price_at > 0) resolved.push({ ...f, resolved_on: today, realized_return: +(price / f.price_at - 1).toFixed(4), correct: f.claim === "up" ? price / f.price_at - 1 > 0 : price / f.price_at - 1 < 0 });
      else stillOpen.push(f);
    }
  }
  return { resolved, stillOpen };
}

export function updateScorecard(sc, resolved) {
  const s = sc && sc.by_tilt ? JSON.parse(JSON.stringify(sc))
    : { by_tilt: { overweight: { n: 0, hits: 0 }, underweight: { n: 0, hits: 0 } }, total: { n: 0, hits: 0 } };
  if (!s.by_signal) s.by_signal = {};
  for (const r of resolved || []) {
    s.total.n++; if (r.correct) s.total.hits++;
    if (r.type === "scarcity_rel") {
      (s.by_signal[r.claim] ||= { n: 0, hits: 0 }); s.by_signal[r.claim].n++; if (r.correct) s.by_signal[r.claim].hits++;
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

// A high Opportunity Score (ALPHA.md Edge 1) is a structural CLAIM — binds soon, durable,
// not yet priced → it should outperform the complex. Grade it even when the tape is quiet.
export const OPPORTUNITY_FORECAST_THRESHOLD = 60;

export function makeScarcityForecasts(scarcities, signals, today, horizon = 42, complexTickers = []) {
  const quotes = signals?.quotes || {}, sigs = signals?.scarcity_signals || {};
  const complex_at = meanPrice(quotes, complexTickers);
  if (complex_at == null) return [];
  const out = [];
  for (const s of scarcities || []) {
    const sig = sigs[s.id] || {};
    const basket_at = meanPrice(quotes, s.tickers);
    if (basket_at == null) continue;
    const base = { date: today, type: "scarcity_rel", subject: s.id, proxies: s.tickers,
      complex_tickers: complexTickers, basket_at, complex_at, horizon_days: horizon, resolve_on: addDays(today, horizon) };
    if (sig.flag === "de-rating" || sig.flag === "inflecting") {
      // The tape is moving: crowded de-rates (underperform), under-priced inflects (outperform).
      out.push({ ...base, id: `${today}:scarcity_rel:${s.id}`, claim: sig.flag === "de-rating" ? "underperform" : "outperform", source: "de-rating" });
    } else if (typeof sig.score === "number" && sig.score >= OPPORTUNITY_FORECAST_THRESHOLD) {
      // Structural opportunity the tape hasn't confirmed yet → predict outperformance, and grade it.
      out.push({ ...base, id: `${today}:scarcity_rel:opp:${s.id}`, claim: "outperform", source: "opportunity", opportunity: sig.score });
    }
  }
  return out;
}
