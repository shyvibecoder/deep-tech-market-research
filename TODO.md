# Puck — TODO / what-to-do-next

Living checklist and the source of truth for "what's next". Update every session.
Audit findings are detailed in `ARCHITECTURE.md`; the timing layer in `REGIME.md`.

## ⭐ North star: alpha (scarcity thesis) → timing (regime) → cash
The thesis picks *what* to own; a literature-grounded timing layer decides *when* to deploy / go
all-in vs. apply the brakes into cash. See `REGIME.md` for the evidence base.
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

## Nice-to-haves
- [ ] Private/foreign chokepoint watchlist (SpaceX, Anduril, ASML, Lynas, Harmonic Drive) + "how to access" notes
- [ ] Crowding-vs-durability scatter view
