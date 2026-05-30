# Where the alpha is — and why a retail investor can actually capture it

> The honest research foundation for Puck. Everything else (timing, risk control, metrics, UX)
> is *scaffolding that protects compounding*; this document is about the **edge itself**.
> The governing rule, stated up front:

**Alpha persists only where there is a *structural reason* that sophisticated, well-capitalized
money cannot arbitrage it away.** If smart money *can* close a gap and *is allowed to*, it already
has — and there is no edge left for a retail investor. So the entire search for retail alpha reduces
to one question: **where are the binding constraints on institutional capital, and can a patient
individual stand in the gap they leave?** (This is the "limits to arbitrage" lens — Shleifer &
Vishny 1997; De Long et al. 1990.)

A retail investor is *worse* than an institution at almost everything — execution, data, cost of
borrow, modeling, access to management. There are exactly four things a retail investor can be
**structurally better at**, because each corresponds to a constraint institutions cannot escape.
Puck's edge must come from these four and nothing else.

---

## The four structural edges (and the constraint each exploits)

### 1. Time-horizon arbitrage — the single most durable retail edge
**The constraint it exploits:** professional managers are judged quarterly and face redemptions.
A PM who is *right but early* gets fired before being vindicated (career risk; agency costs of
delegated management — Stein 2005; Shleifer-Vishny limits-to-arbitrage). They literally cannot hold
through 2–3 years of underperformance even when the thesis is correct. **A retail investor with no
redemptions, no benchmark, and a genuine 10-year horizon can harvest the premium for bearing the
career risk the professional cannot.** This is not a trade; it is a *holding period*. It is the
reason Puck's objective is explicitly 10-year and the deploy mechanism is DCA, not timing.
- **Where the mispricing lives:** long-duration cash flows. Markets discount the near term well and
  the far term poorly — analysts forecast 1–2 years; structural shifts that *certainly* arrive in
  2027–2030 are systematically under-weighted today (hyperbolic discounting of distant, certain
  change). A constraint that *provably* binds in 2028 but whose enablers trade on this-year
  multiples is the textbook case.
- **Puck computes this:** the **bind-window × not-yet-priced** core of the Opportunity Score (below).

### 2. Complexity / inaccessibility premium — the differentiated edge
**The constraint it exploits:** mandates and liquidity. The best bottlenecks are *un-investable* by
institutions — private (SpaceX, Physical Intelligence), foreign-illiquid (Ajinomoto, Harmonic Drive,
ASML pre-ADR-liquidity), or impaired (a chokepoint is not a guaranteed rent — Wolfspeed went
bankrupt *owning* one). There is no clean ETF, so passive flows ignore them; funds can't hold the
private/foreign/illiquid names; and finding the *obtainable* public proxy takes filing-level work
nobody is paid to do.
- **Where the mispricing lives:** the public companies that are customers/suppliers/partners of an
  inaccessible chokepoint carry exposure the market hasn't routed capital toward, *because the
  exposure is buried in 10-K footnotes, not in an index*. This is a pure **effort/complexity
  premium**: it is available to anyone willing to read filings, and to almost no one because almost
  no one does.
- **Puck computes this:** the **chokepoint tracker** — discovers proxies from SEC full-text mentions
  and now **ranks them by specificity (TF-IDF)** so the concentrated pure-play surfaces over the
  diversified megacap. This is Puck's least-replicable layer.

### 3. Forced-flow / neglect — the timing-of-entry edge
**The constraint it exploits:** mechanical, non-informational selling. Index deletions force index
funds to dump a name regardless of value (the "index effect" — Harris & Gurel 1986; Shleifer 1986).
Thematic-ETF redemptions, tax-loss selling (December), fund liquidations, and margin/forced
deleveraging all create selling by holders who *must* sell for reasons unrelated to the business.
"Uninvestable" screens (ESG exclusions, country/size limits) do the same permanently.
- **Where the mispricing lives:** a *thesis-intact* name that has been mechanically de-rated — price
  down, below trend, off its highs — while the structural thesis is **not** broken. Retail can be
  the patient liquidity provider buying what someone else is forced to sell.
- **Puck computes this (partially):** the **de-rating vs. inflecting** signal already separates
  "crowded thesis rolling over" (avoid) from "under-priced thesis gaining" (accumulate); the
  drawdown trigger and DCA-into-weakness encode "deploy into forced selling, don't chase."
  *Gap:* explicit forced-flow events (index deletions, tax-loss seasonality) are not yet ingested.

### 4. Behavioral discipline — the edge that is yours to lose
**The constraint it exploits:** your own and others' biases. The premia above (value, momentum,
post-earnings drift, betting-against-beta) persist partly because most participants chase, panic,
and extrapolate. The retail edge is *not* a clever signal — it is the discipline to deploy into the
−30% drawdown, to not chase the crowded theme, and to **avoid the −35% ruin that breaks
compounding** (a 35% drawdown needs +54% just to recover). This edge is real but fragile: it is the
first thing lost under stress, which is why Puck mechanizes it (DCA calendar, regime brake, defined-
risk-only options, the −35% objective constraint) rather than trusting willpower.

---

## What is NOT alpha (the disqualification list — equally important)
Be ruthless here. The fastest way to *lose* money is to mistake one of these for an edge:
- **Trading liquid mega-caps on public news.** Fully priced in seconds; you are the slow money.
- **Crowded thematic ETFs / consensus longs.** Whatever everyone owns has no premium left — this is
  exactly what Puck's `priced_in: crowded` and the live **crowding** proxy flag *against*.
- **Technical-analysis day-trading / chart patterns.** Negative-sum after costs; no structural basis.
- **The same screens everyone runs** (low P/E large-caps, "AI stocks"). Arbitraged in liquid names.
- **Leverage and naked options.** Convert a good thesis into a margin-call timing bet. Puck is
  defined-risk only, by rule.
- **Anything the scorecard says isn't working.** If the de-rating/inflecting and tilt calls don't
  beat ~50% out-of-sample, the "alpha" was factor exposure or beta, and the app must say so.

---

## How Puck operationalizes this (research → computable, gradeable signal)
The discipline: every claimed edge must be (a) tied to one of the four structural reasons above,
(b) computable from **free** data, and (c) **graded against outcomes** so it can be falsified. An
ungraded edge is a story.

| Edge | Structural reason it persists | Puck signal | Graded? |
|------|-------------------------------|-------------|---------|
| 1 Duration mispricing | PM career/redemption horizon | **Opportunity Score** = not-yet-priced × (bind-proximity, durability, defensibility) | via relative `scarcity_rel` ledger |
| 2 Complexity/inaccessibility | Mandate + liquidity limits | Chokepoint proxy discovery + **specificity rank** | proxy forward-return (next) |
| 3 Forced-flow / neglect | Mechanical, non-informational selling | de-rating/inflecting + drawdown-deploy | `by_signal` hit-rate |
| 4 Behavioral discipline | Bias under stress | DCA + regime brake + −35% gate | regime backtest vs buy-hold |

### The Opportunity Score (this round's build)
Operationalizes Edge 1, the duration-mispricing core, **entirely from human-owned source fields**
(no curve-fitting, fully transparent):

```
gate   = how UN-priced it still is        (priced_in: low→1.0 … crowded→0.0)   ← the necessary condition
quality = 0.40·bind_proximity             (binds now→1.0 … 2030+→0.45)
        + 0.35·durability                 (very-high→1.0 … low→0.25)
        + 0.25·defensibility              (substitution_risk: low→1.0 … high→0.0)
score   = 100 · gate · quality · contrarian_bonus   (non_consensus → ×1.15, capped 100)
```
**Reading it:** a high score means *"binds soon, durable rent, hard to substitute, genuinely
non-consensus — and the market has not yet priced it."* The `gate` is multiplicative on purpose:
if a thesis is already `crowded`, the score is ~0 no matter how good the business — **there is no
alpha left in what's priced in.** This is the model refusing to confuse a great company with a great
*investment*.

**Falsifiability:** the top-ranked opportunities are recorded as relative-outperformance forecasts
vs. the AI-capex complex and graded in the same ledger as everything else. If high-Opportunity
baskets do **not** out-perform over time, the score is noise and the app will show it.

---

## Standing research agenda (in priority order)
1. **Grade everything that's built** — let the ledger accumulate; the binding constraint here is
   *calendar time*, not code. Report the by-signal and Opportunity hit-rates as they fill in.
2. **Deepen Edge 2 (the differentiated one):** supplier/customer graph from filings; grade discovered
   proxies' forward returns; second-order exposure mapping.
3. **Ingest Edge 3 forced-flow events:** index add/delete, tax-loss-selling seasonality, thematic-ETF
   flow — all approximable from free data.
4. **Keep the honesty gate:** any edge that the scorecard cannot show beating ~50%/beta out-of-sample
   is relabeled as factor/beta, not alpha. The scorecard is the referee, not the narrative.

*Not financial advice. This is a research framework; every signal here is a lead to investigate, and
the whole point is that most candidate "edges" fail the grading and should.*
