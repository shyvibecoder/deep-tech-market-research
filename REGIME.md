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

## How the score is built (`scripts/lib/regime.mjs`)

Each signal maps to 0–100 (50 = neutral) using **round, non-tuned constants** on purpose, then a
weighted blend → `risk_score` (0–100):

```
risk = 0.35·trend(200-DMA) + 0.30·abs-momentum(12m) + 0.15·drawdown + 0.15·vol-state + 0.05·breadth
```

Weights reflect the evidence hierarchy (trend + absolute momentum are the load-bearing, best-replicated
signals; drawdown + volatility are the brakes; breadth is a minor confirm). They are coarse by design —
no optimizer chose them.

**Posture ladder** (drives DCA pace, not a trade signal):

| risk_score | posture | what it means for deployment |
|---|---|---|
| ≥ 70 | 🟢 **risk-on** | uptrend + positive 12m momentum, contained vol → deploy on schedule / accelerate low-regret anchors |
| 45–69 | ⚪ **neutral** | stick to the 9-month DCA calendar; no acceleration |
| 25–44 | 🟠 **caution** | tap the brakes — slow deploys, build dry powder, wait for trend/vol to confirm |
| < 25 | 🔴 **defensive** | favor cash; deploy only into the independent drawdown trigger |

## Honest limitations / what would make it better (tracked in TODO.md)

- **Aggregated, not per-name signed exposure** yet — a fuller version would size each holding by its own
  TSMOM sign (Moskowitz-Ooi-Pedersen) rather than a single portfolio posture.
- **Look-backs bounded by our 1-year quote window.** 12-month momentum and 200-DMA need ~full history;
  newly-listed names (e.g., GEV) return `null` and are simply excluded until they have history.
- **No regime for rates/credit/USD** — macro drivers of this basket. A later version could add a
  cross-asset trend (bonds, USD) per the trend-following papers.
- **No transaction-cost / whipsaw dampening** — intentionally, since this paces DCA rather than trades.

## Lessons from an adjacent system (the "V2.3 F+C Thrust on QLD" strategy)

A separate, more mature tactical strategy (Faber 200-DMA trend + Daniel-Moskowitz crash break +
20-DMA fast re-entry, plus an *exit-only* composite-stress overlay, trading QLD in the tax-advantaged
sleeve and buy-and-hold VGT in taxable) shares our evidence base and suggests four upgrades — and two
cautions about what does **not** port to a thematic single-stock basket.

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
