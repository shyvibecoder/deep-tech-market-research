# The timing / market-regime layer — design & evidence base

**Roadmap north star:** the scarcity research gives the **alpha** (*what* to own); this layer
gives the **timing** (*when* to deploy / go all-in vs. when to "apply the brakes and get into
cash"). It is intentionally built on **independent, replicated academic findings**, not curve-fit
backtests, and is tuned to the specific risk shape of this portfolio.

> Not financial advice. This is a transparent risk dial, not a market-timing oracle. Every signal
> here can and will whipsaw; the goal is *risk control on a high-beta basket*, not return forecasting.

---

## Why a timing layer at all (and why for *this* book)

The holdings are deliberately a **single, high-beta, ~1.0-internally-correlated bet** on AI-datacenter
capex + electrification (see `research/MASTER-THESIS.md`): power/IPPs, grid, semis, copper, uranium,
rare earths, robotics. That basket has **fat left tails** and a shared **2027–28 capex-digestion**
failure mode. For a book like this, the highest-value thing a timing overlay can do is **cut
drawdowns and avoid adding into deteriorating regimes** — which is exactly what the trend-following
and volatility literature shows works *out of sample*. It does **not** try to predict returns.

## The evidence base (independent, replicated — not our backtest)

| Signal in our layer | What it is | Independent source(s) | Why it's not overfit |
|---|---|---|---|
| **Trend filter** | price vs **200-DMA** (≈10-month SMA) | Faber, *A Quantitative Approach to Tactical Asset Allocation* (2007/2013); Hurst, Ooi, Pedersen, *A Century of Evidence on Trend-Following* (2017) | One obvious parameter; works across markets and **a century+** of data and asset classes — the opposite of a tuned rule. |
| **Absolute (time-series) momentum** | trailing **12-month** return sign/size | Moskowitz, Ooi, Pedersen, *Time Series Momentum*, JFE (2012) | Documented across **58 instruments / multiple asset classes**; a single look-back, replicated widely. |
| **Volatility state** | realized **3-month vol ÷ 1-year vol** (de-risk when rising) | Moreira & Muir, *Volatility-Managed Portfolios*, J. Finance (2017) | Scaling exposure down when vol rises raises risk-adjusted returns; mechanism-based, broadly replicated. |
| **Drawdown gate** | distance from 52-week high | tail-risk control; complements the existing `drawdown` deploy trigger | Simple, model-free; mirrors how we already define the dry-powder trigger. |
| **Breadth** (minor, 5%) | % of holdings above their 200-DMA | trend confirmation | **Deliberately down-weighted** — at ~1.0 internal correlation it is largely redundant with the aggregate trend, so it is confirmation only. |

Acknowledged failure mode: **momentum/trend crashes** — Daniel & Moskowitz, *Momentum Crashes*
(2016) — trend rules lag at sharp V-shaped bottoms and can whipsaw in choppy ranges. That is why
this is a *dial that biases the DCA pace*, not an all-or-nothing switch, and why the drawdown
**deploy** trigger is independent (we still buy the deep dip).

## How the posture is built (`scripts/lib/regime.mjs`, v3)

**The brake and the fast re-entry ARE the canonical F+C Thrust ladder** — the owner's production rule
(`v23.mjs` / `FABER-CRASH-STRATEGY.md`), computed on the theme-ETF **composite price series** (the same rule
the backtest runs and the V2.3 panel cross-checks). There is no separate composite risk-score and no
breadth re-entry — one design, end to end. Three independently-replicated signals, each one obvious
parameter:

```
TREND     = composite close > its 200-DMA                                 (Faber 2007)
CRASH_OFF = trailing 252-day return < 0  AND  60-day annualized vol > 25%  (Daniel-Moskowitz 2016)
THRUST    = close > 20-DMA  AND  20-DMA today > 20-DMA 10 sessions ago     (rising-20-DMA fast re-entry)
```

**Ladder (first match wins) → posture** (paces DCA, not a trade signal):

| Leg | posture | what it means for deployment |
|---|---|---|
| CRASH_OFF | 🔴 **defensive** | crash regime → favor cash; deploy only into the independent drawdown trigger |
| TREND | 🟢 **risk-on** | above the 200-DMA → deploy on schedule / accelerate low-regret anchors |
| THRUST | ⚪ **neutral** | reclaimed a rising 20-DMA below trend → **fast re-entry**, resume deploys (no acceleration) |
| else | 🔴 **defensive** | below trend, no thrust → favor cash / dry powder |

On top sits an **exit-only composite-stress overlay** (VIX/VIX3M ≥ 1.0 for 3 days **AND** HY-velocity in the
top 5% of its trailing year) which can only force defensive. The posture carries a **per-name TSMOM tilt**
(selection — which names to lean into vs trim) that is separate from the brake.

## Honest limitations / what would make it better (tracked in TODO.md)

- **Aggregated, not per-name signed exposure** yet — a fuller version would size each holding by its own
  TSMOM sign (Moskowitz-Ooi-Pedersen) rather than a single portfolio posture.
- **Look-backs bounded by our 1-year quote window.** 12-month momentum and 200-DMA need ~full history;
  newly-listed names (e.g., GEV) return `null` and are simply excluded until they have history.
- **No regime for rates/credit/USD** — macro drivers of this basket. A later version could add a
  cross-asset trend (bonds, USD) per the trend-following papers.
- **No transaction-cost / whipsaw dampening** — intentionally, since this paces DCA rather than trades.

## The F+C Thrust rule IS the regime (v3 — adopted, not "adjacent")

Earlier versions ran a separate composite **risk_score** (a weighted blend of trend/momentum/vol/drawdown/
breadth) and a breadth-based fast re-entry, treating the owner's **V2.3 F+C Thrust** rule as a *cross-check*.
**v3 throws that out:** the F+C Thrust ladder (Faber 200-DMA trend + Daniel-Moskowitz crash break +
rising-20-DMA thrust re-entry, + the exit-only composite-stress overlay) — the same `v23.mjs` functions the
backtest and the V2.3 panel use — now **drives the live brake and fast re-entry directly**, computed on the
ETF composite. One design, one rule, end to end. The backtest (`fcThrustBacktest`, surfaced in the Objective
scorecard) runs that *exact* ladder on deep benchmark history (SPY/QQQ/SOXX through 2000/2008/2020/2022), no
look-ahead, turnover-costed. Concrete overlay thresholds (coarse, economically-motivated, *not* fitted):
composite-stress = **VIX/VIX3M ≥ 1.0 for 3 days** (inverted) **AND HY-velocity in the top 5%** of its
trailing-year distribution — exit-only, it always wins over the re-entry.

**Architecture worth adopting (→ Timing v2 in TODO):**
1. **Exit-only, AND-gated macro-stress overlay.** It flips defensive only when *two independent* stress
   signals fire together — **VIX term-structure** (backwardation: VIX > VIX3M) **AND high-yield credit
   velocity** (HY spreads widening fast). Requiring a conjunction makes false positives rare; making it
   exit-only makes the asymmetry safe (it can only de-risk, never lever up). This is the cleanest fix for
   our "no rates/credit/USD regime" gap — credit + vol-term-structure are *leading* risk signals, unlike
   our price-derived ones which are coincident.
2. **Fast re-entry override (20-DMA).** A faster signal used *only to re-risk* directly counters the
   Daniel-Moskowitz momentum-crash problem (trend rules re-enter too slowly after V-bottoms) — our biggest
   acknowledged weakness. Slow signal to get defensive, fast signal to come back.
3. **Compute the signal on a clean underlying, apply to the vehicle.** They run the state on QQQ, not on
   the leveraged QLD. Analogue for us: derive the regime from a clean composite (e.g., an equal-weight
   proxy of the basket / the AI-capex complex) rather than averaging 19 noisy single-name series.
4. **Account-aware execution.** Tactical turnover sits in the IRA/Roth (tax-free); taxable stays buy-and-
   hold anchors. This is already our asset-location rule — so the timing posture should drive **IRA-sleeve
   deploy/brake** actions while taxable holds. Make `regime` account-aware.

**What does NOT port (skeptic's note):**
- **It trades one liquid, deeply-researched index with decades of history; we hold ~19 short-history,
  policy-driven, idiosyncratic names.** Parameters/overlays validated on QQQ should *not* be assumed to
  transfer — reinforces our bounded-look-back and newly-listed caveats.
- **No leverage for us.** The basket is already high-beta and cyclical; 2× (QLD) adds volatility decay and
  path-dependency that punish whipsaw. We take their *risk-control architecture*, not the leverage. The
  overlay thresholds ("elevated") are also where overfit hides — keep them coarse and economically motivated.

## References

- Faber, M. (2007, rev. 2013). *A Quantitative Approach to Tactical Asset Allocation.* J. Wealth Mgmt.
- Moskowitz, T., Ooi, Y. H., Pedersen, L. H. (2012). *Time Series Momentum.* J. Financial Economics.
- Hurst, B., Ooi, Y. H., Pedersen, L. H. (2017). *A Century of Evidence on Trend-Following Investing.* AQR.
- Moreira, A., Muir, T. (2017). *Volatility-Managed Portfolios.* Journal of Finance.
- Daniel, K., Moskowitz, T. (2016). *Momentum Crashes.* J. Financial Economics.
- On credit/vol as leading risk: HY OAS & the VIX term structure are standard risk-off leads (e.g.,
  FRED `BAMLH0A0HYM2`; CBOE VIX vs VIX3M). Use coarse, economically-motivated thresholds — not fitted ones.
