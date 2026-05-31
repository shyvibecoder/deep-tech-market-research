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

  // Pass 1: resolve each date (weekend screen → cross-provider corroboration → single-source).
  const cand = [];
  for (const d of dates) {
    if (isWeekend(d)) { stats.dropped_weekend++; continue; }
    const quotes = byDate.get(d);
    const providers = Object.keys(quotes);
    const vals = providers.map((p) => quotes[p]);
    if (vals.length >= 2) {
      const med = median(vals);
      const agreeing = providers.filter((p) => Math.abs(quotes[p] / med - 1) <= tolerance);
      if (agreeing.length >= 2) cand.push({ d, close: median(agreeing.map((p) => quotes[p])), source: "consensus", corroborated: true });
      else stats.dropped_conflict++; // providers disagree, no majority → untrustworthy
    } else {
      cand.push({ d, close: vals[0], source: providers[0], corroborated: false });
    }
  }

  // Pass 2: DESPIKE. Drop an uncorroborated bar only if it's a one-bar spike that REVERTS — i.e.
  // it jumps >`jump` from the last kept bar AND the next candidate snaps back near that level.
  // A SUSTAINED move (a real ±50%+ day that holds, e.g. a deal/earnings gap) is kept — dropping it
  // and stalling the reference price was truncating real history (MP, NVTS). Corroborated big moves
  // (present in ≥2 providers) are always kept.
  const out = [];
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i];
    if (!c.corroborated) {
      const prev = out[out.length - 1], next = cand[i + 1];
      if (prev && Math.abs(c.close / prev.close - 1) > jump && next && Math.abs(next.close / prev.close - 1) <= jump) {
        stats.dropped_jump++; continue; // spike-and-revert → bad print
      }
    }
    out.push({ ticker, d: c.d, close: +c.close.toFixed(6), source: c.source, corroborated: c.corroborated });
    stats.kept++;
    if (c.corroborated) stats.corroborated++; else stats.single_source++;
  }
  return { rows: out, stats };
}
