# Architecture — as-built wiring, end to end

This is the **as-built** map of the whole system (Scout → Committee/Research → Diversifier →
daily Scan → UI), plus the **seam inventory** that drives the hardening passes. Produced from a
holistic end-to-end review. Anchors: `file:line` throughout.

## The pipeline, end to end

```
                 (weekly)                         (weekly / on PR push)
 ┌────────────────────────┐          ┌────────────────────────────────────┐
 │ SCOUT  scout-run.mjs   │          │ RESEARCH  research-run.mjs          │
 │  engines:              │          │  evidence: news + SEC filings +     │
 │   constraint-shadow FTS│          │   live signals.json                 │
 │   BOM-ladder (LLM)     │  human   │  committee: Bull/Bear/Skeptic →     │
 │   arXiv                │   PR     │   dispersion → CIO                  │
 │  → draft → D2 dedup    │ ───────► │  verify gate → CRO audit            │
 │  → committee+verify+CRO│ scarci-  │  → research-proposals.json          │
 │  → scout-candidates.json│ ties.json└───────────────┬────────────────────┘
 └────────────────────────┘                human PR   │ edits scarcities.json
                                                       ▼ (priced_in, bind_window,
 ┌────────────────────────┐                            non_consensus, confidence,
 │ DIVERSIFIER            │  human PR                  variant_view, bear_case,
 │ diversifier-run.mjs    │ ─────────► portfolio.json  kill_criterion)
 │  screen(β,maxDD,bookDD) │ (buildoutScale)
 │  → conviction committee │
 │  → fundSleeve (15%)    │
 │  → diversifier-cand.json│
 └────────────────────────┘

 ┌─────────────────────────────────────── DAILY SCAN  scan.mjs (20 stages) ───────────────────────────────────────┐
 │ quotes/technicals(+crowding) → [backfill seed if --backfill] → REGIME = F+C THRUST ladder (TREND/CRASH_OFF/   │
 │ THRUST on the composite) + exit-only macro overlay + per-name TSMOM tilt → ALPHA(de-rating, opportunity =      │
 │ static_gate×quality×contrarian, forced-flow) → rank → METRICS+BACKTESTS(portfolioMetrics, fcThrustBacktest,    │
 │ factorAttribution, xs-backtest)                                                                                │
 │ → SIZING rebalanceBoth(research | signal = research×opportunity×regimeFactor) → forced-flow×timing reconcile    │
 │ → V2.3 cross-check → dislocation entry → chokepoints → FORECASTS+SCORECARD(TSMOM 21d, scarcity 42d, sizing 42d, │
 │ resolveDue, updateScorecard) → triggers/alerts → catalyst watch → LLM digest → DB top-off → signals.json        │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                       │
                                                       ▼
 UI app.js: posture+overlays · scorecard+proofs · buy plan(signal×regime tilt) · forced-flow badges · triggers.
 F9 gate: every scarcity/portfolio edit is a HUMAN PR — no bot writes scarcities.json or portfolio.json.
```

### Data-store contracts (who writes / who reads)

| Store | Written by | Read by | Notes |
|---|---|---|---|
| `scarcities.json` | **human PR only** (F9) | scan (opportunity gates), research (baseline) | bot never writes |
| `portfolio.json` | **human PR only** (F9) | scan, diversifier | bot never writes |
| `scout-candidates.json` | scout-run | UI (review), human → PR | admission drops most fields |
| `research-proposals.json` | research-run | UI (review), human → PR | priced_in/kill_criterion/etc. |
| `diversifier-candidates.json` | diversifier-run | UI (review), human → PR | funding (newHoldings, buildoutScale) |
| `signals.json` | **scan only** | UI (everything) | schema-validated (loosely) |
| `forecasts.json` | scan only | scan (resolve), UI (scorecard) | persistent accountability ledger |
| price-history DB (Supabase) | scan top-off / `--backfill` seed | scan (deep metrics/proofs) | single-writer top-off |

## Seam inventory (ranked by impact)

### 🔴 A. "Recorded but never graded / consumed" — the dominant theme
1. **`kill_criterion` is never graded.** *(flagged independently by all 3 maps.)* Every accepted
   committee proposal MUST emit a falsifiable, dated "wrong if X by Y" (`research.mjs` sanitize;
   `cioPrompt`). Nothing in `forecast.mjs`/scorecard ever resolves it. **The system's headline
   "falsifiable, accountable" claim is unenforced.** → Pass 1.
2. **`verify_flags` / `dispersion` / `divergence_flag` / `variant_view` / `bear_case`** are produced
   and shown to humans but feed back into nothing — no prompt-iteration loop, no mechanical gate. → Pass 1.
3. **`opportunities[]` array is dead-wired** — written to `signals.json` (`scan.mjs` rank stage),
   never consumed; the UI recomputes rank from `scarcity_signals[id].score`. → Pass 2.
4. **Scout's rich signals dropped on admission** — `constraint_phrases`, `legibility`,
   `complaining_filer`, `dispersion` are computed for review but not carried into `scarcities.json`. → Pass 2.

### 🟠 B. Staleness / freshness
5. **Static-gate lock vs live crowding** — sizing uses `static_gate` (frozen weekly by research),
   while live `crowding` is computed each scan but never written back to `scarcity_signals`; a
   committee "crowded" downgrade is invisible until a PR merges + next scan. → Pass 3.
6. **Data freshness (DB vs live-1y fallback) never surfaced** — user can't tell how deep/fresh the
   technicals behind a posture are. → Pass 3.

### 🟡 C. Wiring gaps / dead code (code ≠ claim)
7. **Diversifier `axis`/gate is dead code** — `draftFromLead` stamps `axis` only if an engine sets
   it; no engine does. Documented diversifier-sleeve gating is non-functional. → Pass 2.
8. **Brake + fast re-entry — REPLACED with the canonical F+C Thrust ladder (regime v3).** The earlier
   composite risk-score brake and the breadth-based fast re-entry (and their iterations) were the wrong
   design: the owner's production rule (`v23.mjs`, F+C Thrust) was sitting right there. v3 throws them out —
   the live brake + re-entry ARE the F+C Thrust ladder (TREND/CRASH_OFF/THRUST) computed on the composite,
   the same `v23.mjs` functions the `fcThrustBacktest` runs and the V2.3 panel cross-checks. THRUST (close
   above a rising 20-DMA below trend) IS the fast re-entry; the rising-MA requirement is the built-in
   bear-rally guard. One design, end to end. *Open validation:* a deep bear-market window for `fcThrustBacktest`
   (now seeded via the backfilled benchmarks).
9. **`rel_strength` computed but only a UI label** — never enters sizing/scoring. → Pass 2.

### 🟢 D. Robustness / safety
10. **Triggers fire silently** — `newly_fired` is computed but wired to no email/issue/webhook;
    display-only. A drawdown trigger can fire unseen if CI isn't watched. → Pass 4.
11. **Schema validation too loose** — `scarcity_signals` / `rebalance` / `v23` validated as
    `object` only; malformed members pass → UI crash risk. → Pass 4.
12. **Forecast store grows unbounded** — forecasts that never resolve are never pruned. → Pass 4.
13. **Scout budget cap logged, not enforced** — no monetary circuit breaker on LLM spend. → Pass 4.
14. **`applyFunding` duplicated** across `scripts/lib/diversifier.mjs` and `web/diversifier-review.mjs`
    (manual sync, no shared test). → Pass 4.

### Honest positives (verified working)
- F9 human-PR gate is real and consistent — no bot writes `scarcities.json`/`portfolio.json`.
- The accountability loop **does** grade TSMOM tilts (21d), scarcity rel-strength calls (42d), and
  signal-vs-research sizing (42d) via `resolveDue`/`updateScorecard` — it's the *kill_criterion* leg
  that's missing.
- Regime brake + fast-reentry are now backtested (brakeProof/fastReentryProof) and surfaced.
- No-look-ahead is enforced and regression-tested in the backtests.

## Hardening passes (Phase 2)
- **Pass 1 — Close the accountability loop:** grade `kill_criterion`; aggregate `verify_flags`.
- **Pass 2 — Make code match claims:** remove/own dead-wiring (`opportunities[]`, diversifier `axis`,
  `fast_reentry` sizing, `rel_strength`); preserve scout provenance on admission.
- **Pass 3 — De-stale:** write live crowding back into `scarcity_signals`; surface data freshness.
- **Pass 4 — Robustness:** tighten `validateSignals`; prune `forecasts.json`; surface/route triggers;
  enforce scout budget; de-dup `applyFunding`.
- **Phase 3 — Full backtest as designed** (timing layer + best-effort full pipeline, labeled).
- **Phase 4 — Update overview + help pages** to the hardened design.
