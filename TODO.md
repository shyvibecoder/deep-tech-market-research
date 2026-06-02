# Puck — TODO / what-to-do-next

Living checklist. **Objective: max 10-yr return, maxDD < 35%, best Calmar/Sortino.** Full build plan: `VISION.md`.
Update every session.
Audit findings are detailed in `ARCHITECTURE.md`; the timing layer in `REGIME.md`.

## ⭐ North star: alpha (scarcity thesis) → timing (regime) → cash
The thesis picks *what* to own; a literature-grounded timing layer decides *when* to deploy / go
all-in vs. apply the brakes into cash. See `REGIME.md` for the evidence base.

### 🔭 Scarcity SCOUT — surveil for NEW emerging scarcities / alpha ideas (gap; design needed)
**The committee is a great *evaluator* of a fixed 24-item watchlist but there is no *scout* feeding
it new theses.** Every automated path (scan, committee, liveness work) only re-scores the EXISTING
`scarcities.json`; `edgar-fts.mjs` discovers proxy *tickers* for known chokepoints, not new
chokepoints. Real alpha is spotting the *next* bottleneck before consensus.
- [ ] **Design a scout stage**: periodic LLM+evidence pass over fresh news/filings that *proposes
  candidate new scarcities* with the same falsifiability discipline (thesis, tickers, kill-criterion,
  priced_in/bind_window), landing as **human-review proposals** — never auto-added to the watchlist
  (F9: humans own which scarcities exist). Reuse the committee/CRO trust layers on each candidate.
- [ ] Open question: candidate *sourcing* — broad news/filing sweep vs. a curated "frontier signals"
  feed (export controls, capacity 8-Ks, DoE/DoD awards, lead-time blowouts). Decide before building.
- [ ] Decide cadence + cost ceiling (a sweep is more open-ended than scoring 24 known items).
  → Discuss & design with the user before implementing (per the "no whack-a-mole" guidance).
- [x] **Timing/regime layer v1** — trend(200-DMA) + 12m abs-momentum + vol-state + drawdown → risk
  posture (risk-on / neutral / caution / defensive). Grounded in Faber'07, MOP'12, Moreira-Muir'17,
  Hurst-Ooi-Pedersen'17; breadth down-weighted (basket ~1.0 corr). Surfaced on dashboard + digest inputs.
- [ ] **Timing v2** — per-name signed TSMOM sizing (not just one portfolio posture); cross-asset
  trend (rates/USD); longer look-back history store; whipsaw dampening. (See REGIME.md "limitations".)
- [ ] **Timing v2 — lessons from the V2.3 QLD strategy** (see REGIME.md "Lessons from an adjacent system"):
  - [x] Exit-only, **AND-gated macro-stress overlay**: VIX/VIX3M ≥1.0 **and** HYG 1m ≤ −3% → force defensive. Keyless Yahoo `^VIX`/`^VIX3M`/`HYG`. (`scripts/lib/macro.mjs`; TDD-tested.)
  - [x] **Fast re-entry override** — ≥60% of names above 20-DMA → re-risk one notch (macro brake wins). TDD-tested.
  - [ ] Compute regime on a **clean composite underlying**, not an average of 19 noisy names.
  - [x] **Regime instruments panel — QQQ / TQQQ / SQQQ daily technicals (USER-REQUESTED) — SHIPPED.**
    Wilder **RSI-14** added to `technicals.mjs` (so all quotes carry `rsi_14`); the scan fetches QQQ/TQQQ/SQQQ
    (`signals.regime_instruments`) and the **Timing** card renders a panel — price, RSI-14, %vs 200-DMA,
    off-high, 12m/1m momentum, vol — tied to the posture, with the leverage-decay caveat. Tests: RSI unit +
    surfaced in computeTechnicals. Original spec below for reference: The regime +
    V2.3 macro overlay factor the **QQQ** complex, but the underlying technicals aren't surfaced anymore — the
    user wants daily sight of them. Build a **Regime UI panel** (on the Timing/regime view, where it makes most
    sense) showing, per instrument, the technicals the regime reads: **price, % vs 200/50/20-DMA, above/below
    200-DMA, %-off-52w-high, 12m/1m momentum, vol-state — and RSI (new; RSI-14 not currently computed, add to
    the technicals lib)**, daily-updated from the scan.
    - **QQQ** = the regime's reference underlying (trend/momentum/vol read here); **TQQQ/SQQQ** = the 3× long/
      short proxies (the actionable risk-on/brake instruments) — add both to the scan fetch universe (they're
      not currently fetched). Note the leverage-decay caveat in the UI (TQQQ/SQQQ are tactical, not buy-hold).
    - Tie it visually to the posture (risk-on → TQQQ context; defensive/brake → SQQQ/hedge context) so the
      panel explains *why* the regime reads the way it does. Make the relationship to the posture explicit.
  - [ ] **Account-aware posture**: timing drives the IRA/Roth sleeve; taxable = buy-and-hold anchors.
  - [x] **Options fair-value module** — Black-Scholes IV vs realized-vol "cheap/fair/rich" verdict + greeks (`web/options.mjs`, **Options check** tab; CI-tested via parity + IV round-trip).
  - [x] **Options-based action suggestions** — `suggestOptionStructure(posture,{macroStressed})` (shared `web/options.mjs`, TDD-tested) emits a defined-risk structure + delta/DTE band; carried in `regime.options_suggestion` and shown on the Options tab. No naked options.
  - [ ] **Options execution rules (DEFINED-RISK ONLY — assume NO naked options, both accounts)** — risk-on → long LEAPS calls (GEV/ASML/index); defensive/macro-stress → protective puts / debit put spreads / collars on correlated cyclicals. Active rolling in IRA (tax-free); long-dated catastrophe hedges in taxable (mind holding-period/constructive-sale/wash-sale). See POSITION-SIZING §3a.
  - [ ] Version the regime engine (v1→v2) + keep thresholds coarse/economically-motivated (anti-overfit); do NOT port QQQ-tuned params onto short-history single names; no leverage.

## 🏛 Premier-grade gaps — hedge-fund-process audit + adversarial reviews (2026-06-01)
Two independent adversarial reviews (G3 code + the roadmap) **converged on one structural flaw** that
re-orders everything below. **The headline finding (verified in `forecast.mjs`): the scorecard grades
"alpha" against the AI-capex complex ITSELF** (`scarcity_rel` resolves as basket − `complex_tickers`). So
the moat measures *intra-factor relative strength* (a momentum tilt inside one bet) and labels it alpha —
and is **structurally incapable of detecting that the whole book is one 1.0-beta factor bet** a thematic
ETF replicates for free. ALPHA.md promises to relabel factor/beta as not-alpha; the resolution code can
never trigger that because it never compares to market beta or an external benchmark. Compounding it: the
live ledger has **~zero resolved forecasts**, so the honesty gate is currently a *no-op*, while the scout
keeps adding *correlated* AI-capex names under the banner of "breadth."

**Consequence (both reviewers): the sequencing was backwards** — the roadmap funded *allocating/hedging*
the edge (G3/G4) ahead of *proving the edge is real* (G1 external benchmark + G6 historical backtest). The
reorder below puts the two items that *fund honesty* first. **All free-tier-achievable.** [DESIGN-FIRST]
items touch strategy/vision — discuss before building.

### 🔴 P0 — PROVE the alpha is real (do FIRST; reframed from "premier enhancement" to correctness)
- [x] **G1 — Factor attribution + an EXTERNAL benchmark — SHIPPED (6074d0a).** `scripts/lib/factor.mjs`
  (OLS + t-stats, no deps) regresses the basket on **market (SPY) + momentum (MTUM) + a THEME proxy (QQQ)**
  → residual alpha + t-stat + R² + verdict ("genuine alpha" only if alpha>0 AND |t|≥2, else "factor/beta");
  plus the blunt absolute check vs QQQ. Wired into `scan.mjs` → `signals.json.attribution`, rendered in the
  Objective scorecard + `?` help + USER-GUIDE 5.1d. The theme leg is the crux — without it the book's beta
  would masquerade as alpha. **NOTE — divergence from spec:** used tradeable factor-proxy ETFs (warehouse-
  native, zero new infra) instead of the Ken-French FF5/UMD CSV; the latter is a future precision upgrade
  (the pure OLS core is source-agnostic). Honest small-n caveat surfaced. *Honesty gate now has teeth.*
- [x] **G6 — Historical cross-sectional signal backtest — SHIPPED (2c18ffd).** `scripts/lib/xsbacktest.mjs`
  tests on history whether a basket's trailing relative strength vs the complex predicts its FORWARD
  relative return → rank IC + hit-rate + 95% CI. Point-in-time on prices (union date axis, no peek);
  **survivorship caveat baked into the payload + UI** (current-membership universe → IC is an UPPER BOUND).
  Warehouse-gated in `scan.mjs` → `signals.json.signal_backtest`; scorecard line + `?` help + USER-GUIDE 5.1e.
- [~] **(G1 follow-up) scorecard auto-relabel — SHIPPED.** `alphaEdgeLabel(attribution, by_signal)` in
  `factor.mjs` (TDD, 4 tests) joins the factor-attribution verdict onto the **Alpha edge** scorecard line
  (`scorecard.alpha_label` in scan.mjs, rendered + `?` help + USER-GUIDE 4.1d). A strong forward hit-rate now
  auto-reads "factor-adjusted: beta — NOT alpha" whenever the regression isn't significant — no more manual
  eyeballing. **Still open: Ken-French FF5+UMD precision** — the OLS core is source-agnostic, but the FF
  daily files ship as `.zip` (no built-in Node zip parser → fragile new infra) for marginal gain over the
  current tradeable proxies (SPY/MTUM/QQQ). Deferred deliberately; revisit if a precision need appears.
- [ ] **(G6 follow-up) Point-in-time universe construction — BLOCKED on history accrual (not code).**
  Reconstructing as-of-date basket→ticker membership needs versioned `scarcities.json` snapshots;
  `scarcity-history.json` currently holds only ~2 dates. The F4 snapshot machinery is running, so this just
  needs calendar time to bank membership history before it's buildable. v1's current-membership IC stays
  labeled an explicit upper bound meanwhile.

### 🟠 P1 — fix the structural concentration (the return engine's real risk)
- [ ] **Gate the scout NOW (cheap; stops the hole deepening).** The scout's own candidates (transformers,
  turbine blades, electrical steel) are *all* AI-capex — it automates concentration as "breadth." Add a
  correlation-screen that REJECTS any candidate loading on AI-capex (needs G1's correlation tooling), or
  pause scout expansion until G2. Reframe its mandate: breadth = *uncorrelated*, not *more names*.
- [x] **G2 — Uncorrelated alpha breadth — SHIPPED (Diversifier sleeve).** The structurally-uncorrelated 2nd
  axis is the **Diversifier sleeve** (~15%): scout/screen (book-aware gate on **build-out β ≤ 0.3** = the
  correlation screen) → committee conviction → inverse-vol sizing → one human-merged PR into `portfolio.json`.
  Tagged `axis:"diversifier"`, excluded from the Opportunity machinery, surfaced on its own tab + the radar.
  Candidates realized: regulated-utilities, water/climate, health-defensive, consumer-staples, discount-retail.
  *Remaining:* deepen the universe + use the FF/correlation tooling to re-verify low correlation periodically.

### 🟡 P2 — allocate / protect the edge (AFTER it's proven)
- [x] **G3 — sizing + rebalance plan: SHIPPED + hardened + graded (this session).** Engine in `web/sizing.mjs`
  (`targetWeights`/`rebalancePlan`/`rebalanceBoth`), wired into `scan.mjs` → `signals.json.rebalance`,
  rendered (`#rebalanceBox`). Adversarial findings all fixed: phantom-trim funding leak, post-crash taxable-
  trim trigger, momentum double-count (now uses STATIC thesis-opportunity), unfunded taxable buys
  (`needs_new_cash`), exact sleeve conservation, **and the tilt is now GRADED** (`sizing_tilt` forecast
  vs the research baseline). **Still deferred → folds into G2:** correlation-aware / equal-risk-contribution
  sizing (a near-no-op on a 1.0-correlated book; honestly labeled "volatility-tilted," not "risk-aware"
  — needs G2's uncorrelated streams to matter). *Was P3/Visionary#5 — now deduped here.*
- [x] **G4 — Drawdown-defense doctrine (protect the −35%). SHIPPED — reframed, not a sizing panel.**
  A 3-cycle adversarial design killed the "stress → size puts → carry into Calmar" pipeline as dishonest
  (puts priced at realized not implied vol; single-period shock ≠ path drawdown; ~59% of the book has no
  clean hedge; the regime brake already IS the zero-premium drawdown control but is continuation-only and
  unproven vs a real tail). Shipped instead: **`docs/DRAWDOWN-DEFENSE.md`** (the defense hierarchy + the
  hedgeability map + the named ~38% taxable/cyclical/unhedgeable core that has *no active defense*),
  **`taxableHedgeWarning()`** §1259/§1092/QDI gate in the options UI, and the backtest-honesty fixes below.
  *Open follow-on (the only thing that closes the hole): trim/restructure the 38% core.*
- [ ] **G5 — Rates / real-yield regime leg.** Add a coarse real-yield/10y trend leg to the macro overlay
  (exit-only, AND-gated). Free: Yahoo `^TNX`, FRED `DFII10`/`DGS10`. **NOTE: this is the SAME item as
  "Timing v2 — cross-asset trend (rates/USD)" and REGIME.md's "no rates/credit/USD" gap — merge, don't
  triplicate.** Highest-relevance macro factor for this rate-sensitive book.

### 🟢 P3 — coherence + the methodology gaps the reviews surfaced
- [ ] **Dedup/coherence pass (nearly free; do before more features).** The backlog is 6 overlapping lists
  (ORIENTATION v1-v4, VISION P0-P4, ARCHITECTURE F1-F11, Helm #1-#8, Visionary #1-#12, G1-G6) with real
  duplicates: G5↔Timing-v2-cross-asset↔REGIME-gap; G3↔Visionary#5↔"wire de-rating+TSMOM into a target
  vector"; G4↔Visionary#10; G6↔the missing alpha-half of the existing regime backtest. Collapse each to
  ONE canonical entry + priority. Run the advertised `coherence.test.mjs` against the *roadmap*, not just code.
- [x] **Charge transaction/whipsaw cost in the backtest. SHIPPED.** `backtest.mjs` now charges
  `costPerSwitchBps` (default 10bps) on the braked path per regime flip and reports `turnover_cost_bps`,
  so the braked Calmar/Sortino are no longer overstated by uncosted whipsaws. `scan.mjs` also now runs the
  backtest at the **live 200-DMA** (was a faster 100/50 proxy) and emits `metrics.backtest_unproven` when the
  basket lacks enough post-MA history — i.e. it no longer prints a bull-window tail claim it can't support.
- [~] **After-tax return / tax-lot model for the taxable sleeve — PARTIALLY SHIPPED (asset location).**
  `web/asset-location.mjs`: per-name after-tax TERMINAL-value optimizer (transportation LP) places each
  dollar in Roth/Traditional/taxable to maximize after-tax value, plus a position-aware delta rebalance with
  a **taxable buy-and-hold rule** (only trims a taxable lot when the scan's trim bar is met — won't realize
  ST gains just to relocate). *Still open:* the **backtest objective is still pre-tax** (Calmar/Sortino on
  pre-tax returns), and **wash-sale / constructive-sale** are documented but unmodeled — fold into the
  backtest cost work below.

- **Out of scope by design (not gaps):** live trade execution (F9 keeps humans in the loop), HFT/execution
  edge (retail loses there — correctly disclaimed), paid alt-data (free-tier rule; Edge-2 filing effort is
  the honest substitute). The ceiling is real and the app is right not to pretend otherwise.

## Testing (TDD/BDD) — shipped
- [x] **Unit** (`tests/*.test.mjs`, `node:test`): options (BS/parity/IV/verdict), regime (postures),
  marketdata (corroboration/plausibility/isTradeable), schema (valid+negative), dca (sums), history (drift/seen).
- [x] **Integration** (`tests/integration/`): real offline scan pipeline → asserts sections, degraded
  data-quality + held triggers, ticker resolution, generated files; runs selfcheck. Non-destructive.
- [x] **E2E** (`tests/e2e/`): static HTML↔JS selector/tab/help contract + static-serve smoke (page+assets+data).
- [x] `npm test` runs all three; **CI runs the full suite** on every PR/push (replaced the ad-hoc gate).
- [x] **Browser DOM e2e (Playwright)** — `tests/e2e-browser/dashboard.spec.mjs` (tabs, help, settings add-holding, options evaluate, no console errors); CI `e2e.yml`.
- [ ] Going forward: **red-first** unit test for each new pure function (convention in ARCHITECTURE §6).

## Docs / User Guide (shipped)
- [x] **`docs/USER-GUIDE.md`** — deeply detailed, per-feature guide (what it is, what it means, how to use).
- [x] **Auto-update hook** — `docs.yml` regenerates screenshots (Playwright) + Word `.docx` (pandoc) on any `web/**` or guide change; **`ci.yml` `guide-sync` job fails the build** if UI changes without a `USER-GUIDE.md` update (+ a local `.githooks/pre-commit` reminder).
- [x] Screenshots wired (`tests/e2e-browser/screenshots.mjs`); placeholder PNGs committed until CI generates real ones.
- [x] First CI run of `docs.yml` done (commit a2244a6): real screenshots + `USER-GUIDE.docx` (1.8MB) committed.

## ⚠ Data integrity / anti-injection hardening (next priority)
Current guards: HTTPS-only sources, fail-loud schema validation (in+out), every ticker "resolved or
errored explicitly" (never silently filled), errors captured + graceful degrade, single controlled
writer (Actions → committed `signals.json`). **Shipped (`scripts/lib/marketdata.mjs`):**
- [x] **Cross-source corroboration** — Yahoo + Stooq (+ optional free-key sources) compared; quote flagged on >3% divergence (sources/spread recorded in `corroboration`).
- [x] **Plausibility bounds** — Yahoo path now rejects price≤0/non-finite (matches Stooq); provider parses guard `>0 && finite`.
- [x] **Anomaly vs last run** — price diffed vs prior committed `signals.json`; >35% jump flagged.
- [x] **Per-quote freshness** — Yahoo last-bar `asof`; flagged when >6 days stale.
- [x] **Fail-safe triggers** — `data_quality` summary; drawdown/sleeve auto-triggers **held** on a degraded run.
- [x] **Provenance** — `source` + `corroboration.sources` per quote; `data_quality` reports ok/flagged/corroborated. EDGAR/news stay read-only (no agentic use) → no prompt-injection path.
- [ ] **Two-consecutive-scans confirmation** before firing a trigger (extra safety) — still TODO.

### Regime / market-data integrity — full-app audit findings + planned hardening (2026-06-01)
**What keeps regime ticker data solid TODAY (port these):** (1) corroboration with *outlier exclusion*
— drop any source >3% off the median, price = consensus of survivors; (2) plausibility floor (finite &
>0); (3) >35% anomaly-vs-last-run flag; (4) >6-day staleness flag; (5) **regime computed on the ETF
COMPOSITE, not 19 single names** (one bad ticker is diluted) — highest-value design; (6) no look-ahead
in technicals; (7) trusted-source persist guard (`sanitizePriceRows`) + first-wins-by-trust de-dupe;
(8) `data_quality` gate holds auto-triggers on a degraded run.

**Gaps the audit found → PLANNED HARDENING (do NOT port the gaps):**
- [x] **Single-source no-op (CRITICAL)** — SHIPPED (9aae228): `marketdata.mjs:100` adds a `single-source`
  flag, excludes uncorroborated quotes from firing a trigger, and won't let them count as corroborated
  history. Per-ticker (foreign tickers stay legitimate, run not marked degraded).
- [x] **V2.3 macro-brake instruments bypass corroboration + anomaly (CRITICAL)** — SHIPPED (9aae228):
  `^VIX`/`^VIX3M`/`HYG`/`QQQ` bars route through `plausibleNextBar` + anomaly check before touching
  `v23State` or the DB; glitch bars are rejected + logged (`scan.mjs:72-78`).
- [x] **`degraded` blind to coverage** — SHIPPED (9aae228): `marketdata.mjs:119-138` surfaces a
  corroboration-coverage signal (`uncorroborated`/`corroborated_of`) + a collapse detector, without
  over-tripping on legitimately-foreign single-source tickers.
- [x] **Ledgers fail-open to empty** — SHIPPED (3c592d0): forecasts/history reads validate + fail-loud
  instead of silently wiping the track record.
- [x] **`meanPrice` price-weights a basket + breaks on changed membership** — SHIPPED (167a058):
  equal-weight per-ticker returns over FIXED membership (`forecast.mjs:83`); new forecasts carry
  `basket_prices` anchors.
- [x] **Other audit items SHIPPED:** theta dividend-sign (F1, b57bdfe); SHA-pin first-party actions
  (S3, b57bdfe); `searchFilings`/FTS retry (P9, `edgar.mjs:131`); dedupe `complexMom` (C2, 6951f14);
  direct `annualVol`/`sharpe` tests (C5, 6951f14); stored-XSS + scout-name sanitize + CSP (S1/S2, dd5dcc9).
- [~] **`runScoutSweep` "dead code" finding — WON'T-DO (finding was wrong).** It is live + covered by
  `tests/scout-sweep.test.mjs` (budget-bound + committee-gate orchestration test). Keep it.
- [x] **Stooq-only staleness gap** — SHIPPED: extracted pure `parseStooqQuote` (mirrors `parseStooqHistory`)
  that maps Stooq's dated bar → `asof`, so a Stooq-only quote now gets the SAME >6-day staleness check as
  Yahoo (was bucketed "freshness unknown"). Bonus: scan no longer stamps TODAY onto a stale Stooq bar.
  Covered by `tests/quotes.test.mjs`. This was the last genuinely-open audit item.

### Cross-app hardening — patterns to adopt from "Helm" (sister app; regime-brake design)
Helm lacks our multi-source consensus + blocking anomaly rejection (our strengths), but its structural
regime-brake design protects even when corroboration fails. Status mapped against Puck:
- [x] **#1 Suppress the overlay when ANY required input is missing/synthetic** — SHIPPED (a9463e3):
  `macroStress` returns `available:false`+`suppressed` on any missing input; scan marks the overlay
  unavailable (not fake "calm"). Complements the V2.3 `plausibleNextBar` value-glitch guard.
- [x] **#2 Multi-day persistence on the term-structure leg** — SHIPPED (c13309a): 3 consecutive inverted
  days required when history is available; scan wires trailing VIX/VIX3M ratios.
- [x] **#3 Drop weekend-dated bars at the write chokepoint** — SHIPPED (c13309a): `sanitizePriceRows`
  rejects Sat/Sun bars (shared by `--backfill`). NOTE: pre-inception drop still TODO (needs an inception map).
- [x] **#5 No-look-ahead regression test** — SHIPPED (6951f14): `tests/backtest.test.mjs` fails if a
  changed future bar alters any past position decision.
- [ ] **#7 Golden-baseline numeric drift monitor** — NOT done (larger infra). Puck has schema `selfcheck`
  + extensive unit tests (golden values for pure fns), but no scheduled drift check over the accumulated
  Supabase warehouse. Build deliberately.
- [ ] **#6 Staleness severity tiers + macro grace** — NOT done (low). Puck's flat 6-day is fine for daily
  Yahoo macro; revisit when a lag-publishing source (FRED HY-OAS) is added.
- [ ] **#3b pre-inception drop + per-guard drop counters** — needs a per-ticker inception map.
- [ ] **dawidd6/action-send-mail SHA pin** — flagged in-workflow (`# SECURITY TODO`); needs the verified
  upstream SHA (don't guess — a wrong SHA breaks the mail step).
- ALREADY HAVE: **#8** plausibility at write *and* read (`sanitizePriceRows` + `readSeries`); **#3** single
  chokepoint + mirrored backfill; **#4** degraded→hold (data_quality gate); **#2** exit-only + AND-gate.

### Free market-data sources (multi-source corroboration — all free)
Build a provider abstraction (like the LLM one) that tries keyless first, optionally free-key, and cross-checks.
- [x] **Quotes/history (keyless):** Yahoo chart (primary) + Stooq CSV (now a cross-check validator).
- [x] **Quotes (free-key corroborators):** Finnhub / Twelve Data / Alpha Vantage — wired in scanner (repo secrets) + a Settings UI to add/store keys; Finnhub powers an in-browser "Check live prices".
- [ ] **Yahoo options endpoint** (`/v7/finance/options/{t}` — real chains + IV) to auto-fill the Options tab; **exchangerate.host/Frankfurter** FX (F2b).
- **Fundamentals/forward multiple:** Yahoo quoteSummary (flaky), Finnhub/FMP/Alpha Vantage OVERVIEW, **SEC EDGAR XBRL companyfacts** (keyless, authoritative for *reported* figures).
- **Options chains + IV:** **Yahoo options endpoint** (keyless) to auto-pull real IV into the Options tab; Tradier sandbox (free key) as alt.
- **Macro (Timing v2 overlay):** keyless `^VIX`/`^VIX3M`/`^TNX`/`HYG` (Yahoo); FRED `BAMLH0A0HYM2` (free key) for HY OAS.

## Audit fixes (ARCHITECTURE.md F1–F11)
- [x] **F1** — dedupe trigger-alert issues in `scan.yml` (don't reopen while one is open)
- [x] **F2** — capture per-quote `currency`; **skip + flag** non-USD lots in the sleeve value
- [x] **F3** — `securities.json` registry (type/foreign) + validator; wired to skip forward-P/E on ETFs
- [x] **F4** — `scarcity-history.json` per-run snapshots (change-only) + radar "drift" marker
- [x] **F5** — `last_reviewed` set on every scarcity + optional `confidence` (0..1) schema support (`confidence` filled by v3)
- [x] **F6 (data layer)** — `dca.json` machine-readable plan generated from tier rules (was prose-only). *Planned-vs-deployed VIEW = v4.*
- [x] **F7** — `seen.state.json` delta tracking → filings/news show **NEW** badges; trigger fire-times recorded
- [x] **F8** — `schema_version` on all data files + validator errors on unknown version
- [x] **F9** — ownership model documented (ARCHITECTURE §1: bot-proposable vs human-only fields)
- [x] **F10** — `signals.json` kept snapshot-only; time-series live in `scarcity-history.json` / `seen.state.json`
- [ ] **F11** — (later) key manual policy triggers to news/filing signals
- [x] **F2b** — FX conversion (`scripts/lib/fx.mjs`, `toUsd` TDD-tested): foreign lots converted to USD in the sleeve; no-rate lots skipped+flagged

### Remaining audit/back-fill (next)
- [ ] **F6 view** — DCA planned-vs-deployed dashboard (pairs with v4; data layer done)
- [x] **F2b** FX conversion for foreign lots — done
- [ ] **F11** wire manual policy triggers to news/filings

## UX / onboarding (shipped)
- [x] **🔐 Admin tool** — one panel for all credentials: browser keys (localStorage) + repo-config status (✅/⬜ for every secret/variable via the GitHub API) + set non-secret repo **variables** (ALERT_EMAIL_TO, SEC_USER_AGENT) directly. Secrets stay write-only in GitHub (linked). `web/admin.mjs` catalog/status TDD-tested.

- [x] **⚙ Settings/onboarding** — per-account holdings editor + dry-powder cash + API keys/token (localStorage only); live "Your holdings" panel; export/import `positions.local.json`; in-browser Gemini digest.
- [x] **Options check** tab — Black-Scholes fair-value (IV vs realized vol) + greeks; regime-linked defined-risk suggestion.
- [x] **Site-wide help (`?`)** — contextual explainers on every section. **Convention: all future features ship with a `?` help entry** (ARCHITECTURE §5).

## v2 status — complete
- [x] SEC EDGAR 8-K/10-Q watch
- [x] News RSS per scarcity
- [x] Cost-basis trim rule + live sleeve cap
- [x] Forward-multiple (forward P/E) fetch
- [x] Multi-model cross-adversarial digest (extra)
- [x] On-demand Refresh: dispatch + auto-poll + live-reload (extra)

## v3 — re-run the research loop (the differentiator)
- [ ] Scheduled 8 deep-dives → 4 red-teams → synthesis on free LLMs → dated `research/auto/<date>.md` + diff vs last run
- [ ] Versioned `priced_in`/`bind_window` drift (uses F4) + `confidence` (F5)
- [ ] Auto-open PR with proposed `scarcities.json` edits when confidence crosses a threshold (bot-owned fields only; human approves)

## v4 — tracking & alerts
- [ ] DCA planned-vs-deployed view (uses F6)
- [x] **Email alerts** on a *newly-fired* trigger (state-change, not every run) — SMTP via repo secrets (e.g. Gmail app password); `scripts/lib/alerts.mjs` (`newlyFired`, TDD-tested) → `signals.alerts` → `scan.yml` email step. (No Telegram.)
- [x] Rebalance helper: flag any holding >±25% from target weight (`web/rebalance.mjs`, TDD-tested; ⚖ column in Your holdings)

## Committee reliability follow-ups (from the 2026-05-31 hardening session)
Shipped this session: backoff cap + job timeout; degraded-committee banner (errors surfaced, not
swallowed); preflight liveness ping + dead-seat fallback to the funded frontier; refreshed stale
model slugs (OpenAI `gpt-5.4-mini`, OpenRouter `deepseek-v4-flash` + `qwen3.6-plus`); paid OpenRouter
ranked above free Groq; honest roles (independent Anthropic chair + 2 OpenRouter seats).
- [ ] **Verify model slugs against a REAL run.** Web-checked (cutoff Jan 2026) but not run-confirmed:
  `gpt-5.4-mini`, `deepseek/deepseek-v4-flash`, `qwen/qwen3.6-plus`. The liveness ping prints the exact
  error if any is stale → override via `OPENAI_MODEL`/`OPENROUTER_MODEL`/`OPENROUTER_MODEL_2` repo vars.
- [ ] **Decide: should a DEGRADED run go RED?** Currently green-with-banner (user deferred). Option to
  exit non-zero / fail the Actions check when >1 seat is empty so a broken analysis can't look successful.
- [ ] **Test hygiene:** a test mutates a tracked data file (`web/data/forecasts.json` → today's date),
  forcing a manual `git checkout` before each commit. Make it write to a temp/fixture instead.
- [ ] **Branch/process:** this session's commits went to `main`, not the designated
  `claude/deep-tech-app-v1-hardening-haGqN` branch. Decide whether to keep on main or consolidate.

## Nice-to-haves
- [ ] Private/foreign chokepoint watchlist (SpaceX, Anduril, ASML, Lynas, Harmonic Drive) + "how to access" notes
- [ ] Crowding-vs-durability scatter view
