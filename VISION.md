# Puck — Vision & build plan ("to 1000x")

Synthesis of an iterative **Visionary ↔ Adversarial** agent loop (round 1), anchored to the owner's
explicit objective. This is the live build plan; `TODO.md` tracks execution.

## 🎯 The objective function (north star)
**Maximize 10-year total portfolio return, subject to max drawdown < 35%, optimizing for the highest
Calmar (CAGR ÷ maxDD) and Sortino (return ÷ downside deviation).**
Everything is judged against this: the scarcity thesis supplies the return engine; the timing/regime +
options + cash layer exists to **keep maxDD < 35% while preserving compounding** (a 35% drawdown needs
+54% to recover — drawdown control *is* return over 10 years). You cannot optimize what you don't
measure → measurement is the foundation.

## ⚡ TRUE ALPHA (the hard part — a standing, first-class need)
Risk control, timing, metrics, accountability, and UX are **scaffolding around** alpha — they protect
compounding but do not, by themselves, beat the market. The app must keep pushing on the *actual edge*,
and must keep itself honest that durable selection alpha is rare.

> **Full research foundation: [`ALPHA.md`](ALPHA.md).** The governing principle: *alpha persists only
> where a **structural constraint** stops sophisticated capital from arbitraging it away.* The four
> retail-accessible edges are **(1) time-horizon arbitrage** (PM career/redemption risk → you can wait,
> they can't — now the **Opportunity Score**), **(2) complexity/inaccessibility** (mandate + liquidity
> limits → the chokepoint tracker), **(3) forced-flow/neglect** (mechanical selling → de-rating/inflecting +
> drawdown-deploy), and **(4) behavioral discipline** (DCA + regime brake + −35% gate). Everything else is
> explicitly *not* alpha (liquid mega-caps on news, crowded themes, TA, leverage) and the scorecard is the
> referee: any "edge" that can't beat ~50%/beta out-of-sample is relabeled factor/beta.

Where Puck's alpha can legitimately come from:
1. **Thesis alpha** — the researched, non-consensus view that under-priced slow-to-build chokepoints
   outperform. *Must be PROVEN, not assumed* → the forecast **scorecard** grades it; the **de-rating /
   inflecting** signal trades it (crowded de-rates first, under-priced inflects).
2. **Inaccessible-chokepoint alpha** — the non-commoditizable layer: discover public proxies (SEC-filing
   mentions) for private/foreign/impaired bottlenecks nobody else tracks. **Shipped; keep deepening** (rank
   proxy quality, add supplier/customer graphs, score discovered proxies' forward returns).
3. **Early-thesis alpha** — v3 auto-research surfaces *new* scarcities before consensus prices them.
4. **Behavioral alpha** — discipline to deploy into drawdowns, not chase, and avoid the −35% ruin.

**Standing rule:** every round must advance at least one *alpha* item (1–3), not only scaffolding — and
the scorecard is the referee. If the de-rating/tilt calls don't beat ~50% out-of-sample, the app must say
so and the "alpha" is just factor/beta. Open alpha work: prove de-rating vs outcomes; rank/score discovered
proxies; ensemble-gated v3; wire de-rating + per-name TSMOM into a target-weight vector (analysis → allocation).

**The two load-bearing strategic gaps (hedge-fund-process audit, 2026-06-01 — detail in TODO.md "Premier-grade gaps"):**
the standing rule above currently has *no teeth* and *no breadth*. (1) **Factor attribution** — we grade
hit-rate but never decompose returns vs Fama-French + momentum, so we cannot actually distinguish alpha
from a momentum/beta load (free: Ken French data). Until then "relabel as beta" is aspirational. (2)
**Uncorrelated alpha breadth** — the whole book is ~1.0-correlated on ONE factor (AI-capex); IR ∝ IC × √breadth,
and breadth ≈ 1. A premier book combines *structurally uncorrelated* edges. These two gate how far the alpha
program can actually go; the rest of the backlog optimizes a single-factor bet.

## The single biggest lever (Visionary)
**Turn Puck from a snapshot renderer into an accountable, self-grading forecasting record.** It already
commits dated JSON to git every scan — an immutable, free, longitudinal claim ledger by accident. Record
every dated, resolvable claim (regime posture, per-name tilt, crowding, scarcity `priced_in`), then
**resolve them against realized outcomes and score** (Brier / hit-rate / and — per the objective —
did `defensive` postures actually cut drawdown and lift Calmar/Sortino?). This converts the whole app's
asserted edge into evidence, and is the one asset that compounds and can't be cloned.

## The measurement substrate (objective-critical, build first)
- **`metrics.mjs`** — pure: CAGR, max drawdown, Calmar, Sortino, Sharpe, vol, time-in-drawdown.
- **Basket/portfolio value series** — a target-weighted index from holdings' histories (+ the user's
  actual sleeve from positions), committed and grown over time → feeds metrics + the scorecard.
- **Regime backtest** scored *on the objective*: does the dial keep maxDD < 35% and raise Calmar/Sortino
  vs. always-deployed DCA, out-of-sample on this basket? (Visionary #4.)

## Prioritized backlog (objective-weighted; merges Visionary roadmap + Red-team fixes)

### P0 — correctness/security the red-team found (finish first; some shipped)
- [x] XSS sanitization (S2), corroboration true-median + outlier exclusion (C1/C2), currency leak (C3),
  securities validation (S1), Actions commit-race concurrency+rebase (R3).
- [ ] **R1/R5 — silent-disable surfacing:** when macro/EDGAR/IV feeds fail, mark the run degraded and the
  regime `macro_available:false` (don't show RISK-ON with the brake silently off); guard `high52`/series
  against a single spurious historical bar.
- [ ] **R2 — targeted-poison fail-safe:** a single flagged holding should be excludable from the drawdown
  average / sleeve, not require >25% of the universe to flag.
- [ ] **U2 — browser sleeve currency:** the "Your holdings" panel must FX-convert or exclude foreign lots
  (today it mis-sums) — match the help copy.
- [ ] **S4 — pin `dawidd6/action-send-mail` to a commit SHA** (supply-chain); S6 — SEC UA contact.
- [ ] **O1/O2 — honest calibration:** stop presenting `risk_score X/100` as precise; show posture bands +
  a "low-confidence/whipsaw-risk" note; document that the score constants are heuristics pending the backtest.
- [ ] **O3 — options fairness vs the live IV surface** (compare to fetched ATM IV, not just realized).
- [ ] **R4 — retention:** cap `scarcity-history.json`; consider periodic squash of `signals.json` churn.

### P1 — make the alpha & timing MEASURABLE (the objective)
- [ ] **metrics.mjs** (CAGR/maxDD/Calmar/Sortino/Sharpe) — pure, TDD.
- [ ] **Regime backtest** on-basket, scored on maxDD<35% / Calmar / Sortino (Visionary #4).
- [ ] **Composite scarcity index + relative-strength de-rating** detector (Visionary #2/#3) — replaces the
  crude crowding proxy; operationalizes "crowded theses de-rate first."

### P2 — accountability (the moat)
- [ ] **Forecast ledger + scorecard** (Visionary #1) — record → resolve → Brier/hit-rate + objective-scored.
- [ ] **Action-integrity layer** (Visionary #9) — every actionable output (triggers, sizing, de-rating,
  auto-PR) must pass: N-scan confirmed + ≥2-source corroborated + not-degraded.
- [ ] **Provenance manifest** per scan (Visionary #12).

### P3 — last mile to action (compounding the objective)
- [ ] **Target-weight sizing vector** (Visionary #5) — promote per-name TSMOM tilt into numeric,
  cap-bounded, account-aware weight deltas.
- [ ] **Scenario stress simulator** (Visionary #10) — show the user's sleeve under the named 2027–28
  capex-digestion / rate-shock; does it breach −35%?
- [ ] **Catalyst calendar** (Visionary #6) — extract the dated policy events into `catalysts.json` + countdowns.
- [ ] **Weekly decision memo** (Visionary #11) — posture + why-changed + de-rating + catalysts + scorecard.

### P4 — differentiators (need P1–P2 as ground truth)
- [~] **v3 auto-research (started):** `scripts/research-run.mjs` + monthly `research.yml` run the versioned research prompts (`research-prompts.mjs`, `RESEARCH_PROMPT_VERSION`, now **v2**) deep-dive→red-team→synthesis on the free LLMs, gated + sanitized to bot-owned fields (F9 enforced in `research.mjs`, tested), opening a human-approved PR. **Prompts are VERSIONED, calibrated, and ensemble-gated:** (a) the calibration prior now uses the **matching call type** — the bot's own de-rating/inflecting (relative) hit-rate (`scorecard.by_signal`) — not the per-name tilt rate it doesn't control; (b) with ≥2 free keys the deep-dive is **ensembled** so a `priced_in` call needs a *strict majority* of independent models to surface, and confidence is scaled by agreement (no single-model hallucination). Each proposal records its prompt_version + ensemble agreement. **(c) v3 prompt = DEEP evidence:** the bundle now carries multi-angle news **article excerpts** (not just headlines) + **SEC filing PASSAGES** read via full-text search (`research-sources.mjs` + `edgar.mjs` content layer) + the live de-rating/forced-flow/opportunity signals; the prompt commands grounding in those with citations and forbids inventing facts. Substance over a headline skim. *Next (calendar-gated): close the full loop by attributing resolved relative-call accuracy back to the prompt_version that proposed it.*
- [ ] **v3 ensemble auto-research (full)** gated by cross-model agreement × empirical calibration (Visionary #7).
- [ ] **Inaccessible-chokepoint tracker** via public proxies (Visionary #8).

### Cross-cutting
- [ ] **Mobile/desktop responsive deep pass** (U1) — card fallbacks for wide tables, modal/regime layout on phones.

## Sequencing
**Every round includes a COHERENCE PHASE** (build → adversarial review → fix → **coherence test** → re-vision): run `tests/integration/coherence.test.mjs` so the app develops as one coherent system, not a feature pile.

P0 (trust) → P1 (measure the objective) → P2 (accountability/moat) → P3 (act) → P4 (differentiate).
Every item: pure-core TDD (red-first, ARCHITECTURE §6), `?` help + USER-GUIDE section, tiering invariant,
free/keyless, degrade-gracefully. The loop repeats: build → adversarial review → fix → re-vision.
