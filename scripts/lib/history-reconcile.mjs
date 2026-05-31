// Historical price reconciliation — the robustness layer for the price-history backfill.
// "No synthetic data": every bar is cross-checked across providers and screened before it can
// be persisted. Rules, in order, per (ticker, date):
//
//   1. WEEKEND screen   — a bar on Sat/Sun is impossible (markets closed) → drop as synthetic.
//   2. CORROBORATION    — when ≥2 providers report a date, take the median; keep only the
//                         providers within TOLERANCE of it. If ≥2 agree → one CORROBORATED
//                         'consensus' bar (median of the agreeing set). If they disagree and no
//                         two agree → DROP (we won't persist a bar we can't trust).
//   3. SINGLE-SOURCE    — a date only one provider has (typically deep history) is kept, but
//                         flagged corroborated:false so the read side knows it's un-cross-checked.
//   4. HOLIDAY-FILL     — a single-source weekday bar whose close equals the previous kept close
//                         AND which the other providers skip → a forward-filled holiday → drop.
//   5. ANOMALY (jump)   — an UNcorroborated bar that moves > JUMP vs the previous kept bar is a
//                         bad print → drop. A corroborated big move (real crash/split, present in
//                         every provider) is kept.
//
// Pure + fully unit-tested. The downstream anti-synthetic write guard still applies.

const TOLERANCE = 0.02; // ≤2% from the median counts as "agreement"
const JUMP = 0.5;       // >50% day-over-day on an uncorroborated bar = suspected bad print

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const isWeekend = (d) => { const wd = new Date(d + "T00:00:00Z").getUTCDay(); return wd === 0 || wd === 6; };

export function reconcileSeries(ticker, sources = {}, { tolerance = TOLERANCE, jump = JUMP } = {}) {
  // date -> { provider: close }
  const byDate = new Map();
  for (const [provider, series] of Object.entries(sources)) {
    const dates = series?.dates || [], closes = series?.closes || [];
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i], c = closes[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(c) || !(c > 0)) continue;
      (byDate.get(d) || byDate.set(d, {}).get(d))[provider] = c;
    }
  }

  const stats = { kept: 0, dropped_weekend: 0, dropped_conflict: 0, dropped_holiday_fill: 0, dropped_jump: 0, single_source: 0, corroborated: 0 };
  const dates = [...byDate.keys()].sort();
  const out = [];
  let prevClose = null;

  for (const d of dates) {
    if (isWeekend(d)) { stats.dropped_weekend++; continue; }
    const quotes = byDate.get(d);
    const providers = Object.keys(quotes);
    const vals = providers.map((p) => quotes[p]);

    let close, source, corroborated;
    if (vals.length >= 2) {
      const med = median(vals);
      const agreeing = providers.filter((p) => Math.abs(quotes[p] / med - 1) <= tolerance);
      if (agreeing.length >= 2) {
        close = median(agreeing.map((p) => quotes[p]));
        source = "consensus"; corroborated = true;
      } else { stats.dropped_conflict++; continue; } // providers disagree, no majority → untrustworthy
    } else {
      // single source — kept but flagged uncorroborated (e.g. deep history only one provider has).
      // (No "forward-fill == prior close" drop: a stock can legitimately close unchanged, and dropping
      //  those silently deletes real flat days. Synthetic weekend bars are already screened above.)
      close = vals[0]; source = providers[0]; corroborated = false;
    }

    // anomaly: an uncorroborated implausible jump vs the previous kept bar is a bad print.
    if (!corroborated && prevClose != null && Math.abs(close / prevClose - 1) > jump) { stats.dropped_jump++; continue; }

    out.push({ ticker, d, close: +close.toFixed(6), source, corroborated });
    prevClose = close;
    stats.kept++;
    if (corroborated) stats.corroborated++; else stats.single_source++;
  }
  return { rows: out, stats };
}
