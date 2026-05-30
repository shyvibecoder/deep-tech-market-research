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
    const q = currentPrices?.[f.subject];
    const price = q && !q.error ? q.price : null;
    if (today >= f.resolve_on && price > 0 && f.price_at > 0) {
      const ret = price / f.price_at - 1;
      resolved.push({ ...f, resolved_on: today, realized_return: +ret.toFixed(4), correct: f.claim === "up" ? ret > 0 : ret < 0 });
    } else stillOpen.push(f);
  }
  return { resolved, stillOpen };
}

export function updateScorecard(sc, resolved) {
  const s = sc && sc.by_tilt ? JSON.parse(JSON.stringify(sc))
    : { by_tilt: { overweight: { n: 0, hits: 0 }, underweight: { n: 0, hits: 0 } }, total: { n: 0, hits: 0 } };
  for (const r of resolved || []) {
    const k = r.claim === "up" ? "overweight" : "underweight";
    s.by_tilt[k].n++; s.total.n++;
    if (r.correct) { s.by_tilt[k].hits++; s.total.hits++; }
  }
  s.hit_rate = s.total.n ? +(s.total.hits / s.total.n).toFixed(3) : null;
  return s;
}
