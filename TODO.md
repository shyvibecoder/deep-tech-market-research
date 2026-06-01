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
  - [ ] **Account-aware posture**: timing drives the IRA/Roth sleeve; taxable = buy-and-hold anchors.
  - [x] **Options fair-value module** — Black-Scholes IV vs realized-vol "cheap/fair/rich" verdict + greeks (`web/options.mjs`, **Options check** tab; CI-tested via parity + IV round-trip).
  - [x] **Options-based action suggestions** — `suggestOptionStructure(posture,{macroStressed})` (shared `web/options.mjs`, TDD-tested) emits a defined-risk structure + delta/DTE band; carried in `regime.options_suggestion` and shown on the Options tab. No naked options.
  - [ ] **Options execution rules (DEFINED-RISK ONLY — assume NO naked options, both accounts)** — risk-on → long LEAPS calls (GEV/ASML/index); defensive/macro-stress → protective puts / debit put spreads / collars on correlated cyclicals. Active rolling in IRA (tax-free); long-dated catastrophe hedges in taxable (mind holding-period/constructive-sale/wash-sale). See POSITION-SIZING §3a.
  - [ ] Version the regime engine (v1→v2) + keep thresholds coarse/economically-motivated (anti-overfit); do NOT port QQQ-tuned params onto short-history single names; no leverage.

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
- [ ] **Single-source no-op (CRITICAL).** `corroborate` returns `ok:null` for one source → no divergence
  check, no flag, and it persists as fresh (10/50 tickers on the 05-31 scan). Fix: flag single-source
  quotes (`single-source` flag), exclude them from firing a trigger, and don't let an uncorroborated
  bar count as corroborated history. (Foreign tickers are *legitimately* single-source → flag per-ticker,
  do NOT mark the whole run degraded.)
- [ ] **V2.3 macro-brake instruments bypass corroboration + anomaly (CRITICAL).** `^VIX`/`^VIX3M`/`HYG`/
  `QQQ` are single-Yahoo-fetched and written straight to history — one bad VIX print can flip the regime
  state. Fix: route V2.3/QLD/SGOV bars through plausibility + the >35% anomaly check before they touch
  `v23State` or the DB.
- [ ] **Stooq-only staleness gap.** Single-source *Yahoo* keeps `asof` (staleness-checked); only a
  Stooq-only fallback has `asof:null` and can't be flagged stale. Fix: give Stooq an `asof` or flag
  freshness-unknown.
- [ ] **`degraded` blind to coverage.** Doesn't count single-source/uncorroborated → triggers stay armed.
  Fix: surface a corroboration-coverage signal (without over-triggering on legitimately-foreign tickers).
- [ ] **Ledgers fail-open to empty** (`forecasts.json`/history) → silent permanent wipe of the track
  record. Fix: validate + fail-loud on read.
- [ ] **`meanPrice` price-weights a basket + breaks on changed membership** (`forecast.mjs`) → scorecard
  on a corrupt stat. Fix: equal-weight per-ticker returns over fixed membership.
- [ ] **Other audit items:** theta dividend-sign (latent, `options.mjs`); SHA-pin `action-send-mail`;
  `searchFilings` retry; dedupe `complexMom`; delete dead `runScoutSweep`; direct tests for `annualVol`/`sharpe`.

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
