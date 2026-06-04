# Faber–Crash–Thrust Strategy (the canonical timing rule)

*The strategy reference the regime layer, the backtests, and the V2.3 cross-check all implement. The
**source of truth is the code** — `scripts/lib/v23.mjs` (`v23Signals`, `fcThrustLadder`,
`termBackwardation`, `hyVelocityElevated`, `compositeStress`); this doc explains it. Not financial advice.*

Companion to `REGIME.md` (how it's wired into the app) and the owner's V2.3 production spec.

---

## 1. What it is

A first-match-wins **ladder** of three literature-grounded trend/crash/thrust signals, plus an
**exit-only composite-stress overlay**. It answers one question — *risk-on or defensive?* — and is built
for **drawdown control** (the north star: maximize 10-yr return subject to maxDD < 35%, optimizing
Calmar/Sortino), **not** return prediction.

The owner's production design runs the signal on **QQQ** and holds **QLD (2×) / SGOV**. **Puck runs the
exact same ladder on the portfolio composite and holds the portfolio itself (no leverage)** — a 2× sleeve
would breach the −35% mandate unless gated by full exit to cash. The faithful QLD/SGOV replica is kept as
an independent daily **cross-check** (`v23State`).

## 2. The three signals (on daily closes)

| Signal | Rule | Source |
|---|---|---|
| **TREND** | close > 200-day SMA | Faber (2007) |
| **CRASH_OFF** | trailing 252-day return < 0 **AND** 60-day annualized vol > 25% | Daniel–Moskowitz (2016), *Momentum Crashes* — taken verbatim, no params tuned to our data |
| **THRUST** | close > 20-day SMA **AND** 20-day SMA today > 20-day SMA 10 trading days ago | price-based breadth-thrust analog (the 20d/10d params are *disclosed as tuned* — the one non-paper piece) |

THRUST is the **fast re-entry**: it recovers the upside the slow 200-DMA reclaim leaves on the table after
a sharp V-shaped bottom (the COVID-2020 failure mode), and only ever acts in the below-trend, no-crash zone.

## 3. The ladder (first match wins)

```
if CRASH_OFF:        defensive   (→ SGOV in the replica)
elif TREND:          risk-on     (→ QLD)
elif THRUST:         neutral — fast re-entry  (→ QLD)
else:                defensive   (cash)
```

CRASH is checked **first** so a momentum-crash blowup always wins over a marginal above-trend reading.

## 4. The composite-stress overlay (exit-only)

On top of the ladder sits a market-wide stress brake that can **only flip risk-on → defensive, never the
reverse**. It fires only when **both** independent, *leading* signals fire together (a rare conjunction →
~2–3 firings/yr):

- **VTS** — VIX term-structure backwardation: **VIX / VIX3M ≥ 1.0 for 3 consecutive trading days**.
- **HV** — high-yield credit velocity: the **20-day change in −log(HYG)** sits in the **top 5% of its
  trailing 252-day distribution** *and* is an actual widening (velocity > 0).

```
if overlay_fires AND ladder == risk-on:   defensive
else:                                      ladder
```

**Staleness guard:** if any of VIX / VIX3M / HYG is missing or too short, the overlay is **suppressed
(UNAVAILABLE)** — never silently evaluated to "calm". A missing feed must not hide stress *or* fake it.
VIX and VIX3M are date-aligned before the VTS check so the "last 3 days" are the same 3 sessions.

## 5. Locked parameters (no ad-hoc tuning)

| Parameter | Value | Source |
|---|---|---|
| Trend SMA | 200 | Faber |
| Crash return lookback / threshold | 252d / < 0 | D&M 2016 |
| Crash vol lookback / threshold | 60d / > 25% ann. | D&M 2016 |
| Thrust fast SMA / slope lookback | 20 / 10 | tuned (disclosed) |
| VTS ratio / confirm days | 1.0 / 3 | V2.3 §23.D |
| HV velocity window / lookback / percentile | 20 / 252 / 0.95 | V2.3 §23.D |

Any change requires re-running the full backtest harness from scratch.

## 6. One design, end to end

The **live regime** (`regime.mjs` → `computeRegime`), the **backtest** (`backtest.mjs` →
`fcThrustBacktest`), and the **V2.3 cross-check** (`v23State`) all call the *same* `v23.mjs` functions and
the same shared `sma` / `annualizedVol` (in `technicals.mjs`). The brake and the fast re-entry **are** this
ladder — there is no separate composite risk-score. Backtests decide on prior-bar closes only (no
look-ahead), are turnover-costed, and model **1×** (not 2×). Only the IRA sleeve is timed; the taxable
sleeve is buy-and-hold (so a combo's realistic drawdown-cut is the IRA share of the fully-timed cut).

> Drawdown control *is* return over 10 years (a −35% drawdown needs +54% to recover). The proven value of
> this rule is cutting tail drawdowns, not selecting winners.
