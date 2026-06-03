# Drawdown Defense — how this book holds the −35% limit

**Objective:** maximize return subject to **max drawdown < −35%** (peak-to-trough), scored
via Calmar/Sortino in `web/metrics.mjs` (`maxDdLimit: 0.35`).

This doc states the **doctrine** that orders the tools the app already ships. It exists
because the dashboard *shows* every number (stress breach, maxDD, regime brake, options
fairness) but nowhere *states which defense does what, in what order, and where the defense
runs out.* That last part — where it runs out — is the whole point.

> **One-line truth:** You cannot buy your way out of this book's tail. The −35% limit is held
> by how the book is **built and trimmed**, not by a hedge bolted on after a shock. And for the
> single largest block of the book (~38%), there is **no active defense at all** — only ex-ante
> sizing, which is thin.

---

## The defense hierarchy (ordered, each with its real limit)

### 1. Ex-ante construction — the primary defense (and the only one for the core)
Position caps + the deliberate **defensive 2nd axis** (JNJ/KO/PG/PEP/WMT/MRK = **8.00%**) +
**dry-powder cash** (CASH-MMF 3.02% + CASH-MUNI 1.55% = **4.57%**).

- **Limit:** that ballast totals only **~12.6%** against a book the portfolio file's own
  disclaimer calls "*every name is cyclical and would fall together in a recession or rate
  shock*" (`web/data/portfolio.json:10`). "Primary" means *first and (for the core) only* — **not
  adequate.** In a true correlated −35% event, 12.6% of ballast does not hold the line by itself.

### 2. Trim into cash on a regime turn — **IRA sleeve only**
When the regime brake flips defensive, the lever is to raise cash. But:

- **Limit:** the **taxable sleeve is 51.3%** of the book (the *majority*) and is run buy-and-hold
  — selling realizes capital gains, so the regime `account_policy` (`scripts/lib/regime.mjs`)
  explicitly tells taxable to *not* sell. So the trim lever only works on the **IRA half (48.7%)**.
  It is muted on the larger sleeve.
- Note: the committed weights sum to taxable **51.3% / IRA 48.7%**; the `accounts` block in
  `portfolio.json` ($700k/$800k) disagrees with the holdings sum — trust the holdings.

### 3. The regime brake (200-DMA trend) — a *continuation* dampener, **not** a tail control
The trend/vol brake in `scripts/lib/regime.mjs` reduces *participation in a continuing*
decline. It is real and worth having — but:

- **Limit (structural):** a 200-DMA filter is slow. Price must fall *below* the average before
  the brake flips, so it **cannot prevent the first leg down** to the MA — which is exactly the
  fast, correlated gap a −35% event is.
- **Limit (evidential):** the committed backtest ran on a **~2.3y bull window** where neither the
  braked nor unbraked book came within ~13 points of −35% (braked maxDD ≈ −14.9%, unbraked
  ≈ −21.9%). **The brake has never been tested against the tail it's meant to defend.** It also
  ran at a faster MA than the live dial. As of this doc, `scripts/scan.mjs` runs the backtest at
  the **live 200-DMA** and emits `metrics.backtest_unproven` when the basket lacks enough history
  — because `basketIndex` takes the **date intersection** of all holdings (`web/metrics.mjs`),
  truncating the series to the *youngest* holding (e.g. GEV, spun off 2024). It is therefore
  unprovable on this book's own price history — so the scanner now runs the **same brake on
  long-history instruments read DEEP from the accumulated DB** (`seriesFor`, not a live fetch):
  **QQQ** (a backfilled regime instrument) and **MU/SMH** (deep universe holdings), through real
  ≥20% drawdowns (2000/2008/2020/2022), surfaced as the **"Brake proof"** block in the scorecard
  (`brakeProof()` in `scripts/lib/backtest.mjs`). That is *methodology* evidence (Faber-style
  trend following), **not** a backtest of this book, and it reports two falsifiable verdicts
  per instrument — *does it cut max drawdown* and *does it improve Calmar* — plus a per-crash table
  flagging where the brake **whipsawed** (⚠, fast V-bottoms) rather than helped (slow bears). Read
  the dial's tail claim off that block, not off faith.
- The **fast-entry** side of the dial is tested too. The live regime **clears a braked posture to
  neutral** on a broad **≥60% 20-DMA breadth thrust** (`fast_reentry`, `regime.mjs`). `fastReentryProof()` puts
  that to a falsifiable test on the book's own deep history: a plain 200-DMA brake vs. brake +
  fast-reentry, reporting whether re-entering on breadth captures more recovery (CAGR / time-in-
  market) **without giving the drawdown protection back** (Calmar) — surfaced as the **"Fast
  re-entry proof"** block with a `worth it / not worth it` verdict.
- The whipsaw cost the brake pays is now charged in `scripts/lib/backtest.mjs`
  (`costPerSwitchBps`, TODO.md:133) — so the brake is not "free," and its Calmar is no longer
  overstated by uncosted turnover.

### 4. Options — a *rare, fairness-checked, basis-matched* overlay, never the floor
The options tab (`web/options.mjs` / `options-ui.js`) is a **fairness checker**: it backs out
implied vol from a *user-pasted market price* and judges cheap/fair/rich vs realized vol. It is
**not** a hedge sizer and prints no contract count or fabricated premium.

- **Limit (basis):** only **~28%** of the book (SMH/COPX/MU/ASML) has a clean, liquid index to
  hedge with. The other **~59%** has none. A QQQ/SMH put against copper miners, water, grid,
  nuclear, defense, or single-name positions is uncorrelated insurance — it can expire worthless
  while the book falls (negative protection: cost, no payoff).
- **Limit (cost):** real downside puts trade at *implied* vol, well above *realized*. A continuous
  OTM index-put program bleeds ~3–8%/yr of hedged notional — directly destroying the CAGR the
  Calmar objective optimizes. The fair-value-at-realized figure is now labeled a **floor** and
  flagged for OTM puts (skew/variance premium).
- **Limit (tax):** a collar or short-call on a low-basis **taxable** anchor can trigger a
  constructive sale (IRC §1259), defer losses (§1092), and poison qualified-dividend treatment.
  `taxableHedgeWarning()` now gates these in the UI.

---

## Hedgeability map

| Class | Weight | Holdings |
|---|---:|---|
| **Cleanly hedgeable** (SMH/SOXX, COPX) | **28.3%** | SMH 10.0, COPX 9.1, MU 5.5, ASML 3.7 |
| **Defensive 2nd axis** (ballast) | **8.0%** | JNJ, KO, PG, PEP, WMT, MRK |
| **Dry-powder cash** | **4.6%** | CASH-MMF 3.0, CASH-MUNI 1.6 |
| **Unhedgeable cyclical** (no clean index) | **59.1%** | PAVE 13.7, GRID 10.0, FIW 7.0, NUKZ 5.5, SHLD 4.6, GEV 3.7, CEG 3.7, SMNEY 2.7, EME 1.8, MP 1.8, LEU 1.8, ROBO 1.8, UFO 0.9 |

For the **59% unhedgeable** block, neither an index put nor a slow trend brake is a tail control.
**The only honest −35% defense for it is to trim it into cash** — and that means trimming
*before* a shock (it can't be done cheaply mid-crash), and primarily in the IRA where it's tax-free.

---

## ⚠ The hole this doc exists to name

**~38% of the book is simultaneously taxable AND cyclical AND non-defensive AND unhedgeable**
(PAVE 13.7 + GRID 10.0 + FIW 7.0 + SHLD 4.6 + SMNEY 2.7 = **38.1%**).

For this block, **every active defense layer is off**:
- Trim-to-cash (layer 2) — off: it's tax-locked taxable.
- Options (layer 4) — off: no clean basis.
- The brake (layer 3) — continuation-only, and unproven/unprovable for the tail.

So the *only* thing standing in front of the largest single block of the book is **layer 1
ex-ante sizing** — i.e. the decision of *how big to let it be in the first place*. There is no
dynamic tool that protects it once a correlated drawdown starts.

**This is a portfolio-construction decision, not a tooling gap.** A doc documents the hole; only
**trimming/restructuring the core** (or accepting the concentration with eyes open) closes it.

---

## Backtest realism — what the F+C Thrust numbers prove and don't (adversarial round)

The scorecard now shows the F+C Thrust ladder three ways: on **deep benchmarks** (SPY/QQQ/SOXX), on the
**actual book** (`fc_thrust_book`, ~2.4y bull-only), and on a **long-history build-out analogue** through
real bears (`fc_thrust_book_proxy`). Red-teaming their realism, honestly:

- **No look-ahead** — positions decide on the *prior* bar's close; only the next bar's return accrues.
  Regression-tested (changing the final bar can't change any prior position). ✅
- **Only the IRA sleeve is timed (now modeled).** Timing the **taxable** sleeve would realize capital gains
  on every exit, so by design **taxable is buy-and-hold *for timing*** — it changes only on **scarcity/thesis**
  decisions (the selection layer), never on the timing dial. The combo backtests now model this with
  `timeableFrac` = the IRA share of the book: the **realistic** result blends `frac × timed + (1−frac) ×
  buy-&-hold`, so the drawdown-cut the *whole book* actually gets is ~`frac` of the fully-timed cut (it shows
  *realistic* next to *fully-timed* in the scorecard). The taxable sleeve's scarcity-driven changes are a
  **fundamental/committee** signal — **not** mechanically reproducible in a price-only timing backtest — so
  their value is measured *separately* by the cross-sectional **signal backtest** (rank IC) and the live ledger.
- **Execution optimism.** Decide-on-`t-1` / earn-return-`t` is the standard MA convention, but in a gappy
  crash you don't actually exit at the prior close — so the avoided-drawdown is a mild **upper bound**. The
  flat cost only partly covers slippage.
- **The analogue proxy carries survivor + hindsight bias.** SMH/XLI/XLU/XME/ITA/PHO/XLK were chosen knowing
  which themes/ETFs survived; weights only approximate the book. Its value is the **drawdown-cut and Calmar
  delta** (did the ladder cut 2008/2020/2022), **not** the absolute CAGR, which is the analogue's, not yours.
- **Conservative omission:** the exit-only composite-stress (VIX/HY) overlay is *not* in the backtest, so the
  live system would brake *more*, not less.
- **1×, not 2×.** We model 1× the underlying (the V2.3 panel's QLD is 2× — leverage would breach −35%).

**Net:** the proofs evidence the *timing methodology's* tail-cut through real bears and confirm no
look-ahead; they do **not** prove the *exact book's* future, and they **overstate** the edge in a taxable
account (no tax) and in gappy crashes (execution). Read them as an upper-bound on a methodology, decomposed
from the selection edge (graded separately, and currently marginal — IC ≈ 0.05, hit-rate ≈ 52%).

## What would change this doctrine

- ~~A backtest of the **live 200-DMA brake through an actual ≥35% drawdown**, on a long-history
  proxy decoupled from `basketIndex`.~~ **Done** — the "Brake proof" block now reports it from the
  scan. Its *result* can still change the doctrine: if the brake fails to cut max drawdown or
  whipsaws away its Calmar edge across the proxies, layer 3 should be demoted from "defense" to
  "noise reduction."
- A material **trim of the 38% core**, which would shrink the undefended block and is the single
  highest-leverage risk action available.
- A liquid, basis-matched hedge appearing for the currently-unhedgeable clusters (none today).

## Verify these claims
- Weights / accounts / disclaimer: `web/data/portfolio.json`
- −35% objective: `web/metrics.mjs` (`maxDdLimit`)
- Brake + account policy: `scripts/lib/regime.mjs`; backtest + turnover cost: `scripts/lib/backtest.mjs`; backtest invocation + `backtest_unproven`: `scripts/scan.mjs`
- Options fairness + tax gate: `web/options.mjs` (`evaluateOption`, `taxableHedgeWarning`), `web/options-ui.js`
