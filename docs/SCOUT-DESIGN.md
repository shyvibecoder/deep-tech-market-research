# Scarcity Scout — design (DRAFT, for review)

Status: **design only — not built.** Captures the agreed shape so implementation stays honest.
Companion to `docs/RESEARCH-DESIGN.md` (the committee that *evaluates* scarcities). The scout
*discovers candidate* scarcities; the committee adjudicates them; a human approves via PR (F9).

## The reframe (why this isn't a "trend finder")

`ALPHA.md` is explicit: **alpha persists only where a structural constraint stops sophisticated
capital from arbitraging it away, and there is no edge left in what is already priced.** A generic
"emerging-trend" scout is therefore an anti-pattern — by the time something reads as a trend, it is
priced. The scout's target is not *what's emerging* but **what carries the fingerprint of a binding
constraint that institutions cannot yet route capital toward.**

The Opportunity Score (`ALPHA.md`) already defines that fingerprint for *known* scarcities:
`gate · bind_proximity · durability · defensibility`. The scout runs that logic **in reverse** —
it hunts the wild for things that *would* score high if they were on the list, and it treats
**legibility (mainstream financial coverage) as a negative signal**, not a positive one.

## Architecture: widen the funnel, reuse the trusted back-end

```
  candidate engines  →  dedupe + novelty + anti-consensus  →  EXISTING committee  →  human PR
  (find leads)          (drop knowns/priced; cap budget)       (Bull/Bear/Skeptic       (F9: approve
                                                                + CRO + verify gate)     into scarcities.json)
```

The scout has **no judgment of its own.** It emits *candidates*; the hardened committee + deterministic
verification gate + CRO is what kills the ~90% that are false scarcities (the Bear seat's mandate —
"supply response / substitution / policy reversal" — is exactly that filter). Falsifiability is
unchanged: each surviving candidate carries a pre-registered kill-criterion and is graded by the
scorecard. **If scout-originated scarcities don't outperform over time, the ledger says so and we
kill the scout.**

## Candidate engines (v1 = the three selected; news-sweep deliberately excluded as the "trend trap")

### 1. Constraint-shadow FTS  *(highest leverage; build first — reuses `edgar-fts.mjs`)*
Don't search for the scarcity — search SEC full-text for the **complaint about it**. A binding
constraint shows up first as downstream griping in 10-Q/10-K risk factors and MD&A:
*"lead times extended", "unable to secure allocation", "qualified a second source", "took-or-pay",
"force majeure", "on allocation", "capacity-constrained supplier".* Point `searchFts` /
`discoverProxies` at these **constraint-language queries**, then **cluster which input / material /
component keeps getting complained about across unrelated filers.** The candidate scarcity is
*inferred from the pattern of complaints*, not searched by name. Cheap, novel, primary-source.

### 2. BOM laddering  *(high signal, bounded; build second — reuses the 24 seeds + proxy graph)*
For each of the 24 known scarcities, ask: *what does this chokepoint itself depend on one layer up
the stack?* (HBM → advanced packaging → ABF substrate → a specific resin → …). Walk **up** the
dependency ladder from things we already believe are scarce, because the supplier of a known-scarce
thing is the highest-prior place to find the next-scarce thing. Structured graph expansion from
high-prior seeds — not an open-ended search.

### 3. Patent / technical-literature scan  *(earliest signal; build last — NEW data source)*
Scan patent filings / preprints for capabilities that imply a **coming physical bottleneck** before
it hits any filing. Keyless sources fit the repo's pattern: **PatentsView (USPTO)** and **arXiv**.
Honest caveat: this is net-new infra (more build, more failure surface, noisiest mapping from
"research activity" → "investable constraint") — hence sequenced after the two filing-based engines
prove the funnel.

## The anti-consensus gate — SOFT penalty (chosen)
Each candidate gets a **legibility score** = how much *mainstream financial* coverage exists
(analyst notes / financial media) vs. *primary* sources (filings / trade press / patents).
Legibility **downweights** a candidate's priority but does **not** drop it; the committee still
evaluates it, and the Bear seat is relied on to reject the genuinely priced-in ones. Each candidate
is tagged `early/contrarian` vs `already-legible` so the human reviewer sees the call. (Hard-gate
was considered and rejected: too aggressive for v1, risks dropping a real thesis that's just
becoming known.)

## Cadence + budget — weekly, tight (chosen)
- Separate workflow from the daily scarcity scan (`scout.yml`), **weekly** schedule.
- **Hard cap ≈ $2–3 / run.** A sweep is open-ended (unlike scoring 24 known items), so the budget is
  enforced: bounded FTS queries, bounded ladder depth, a max candidate count fed to the committee,
  and an explicit per-run call ceiling logged up front (mirrors the `RESEARCH_CONCURRENCY` discipline).
- Scout reasoning runs on the funded **Anthropic** model (strongest synthesizer).

## Hard rules (from the codebase's own guardrails)
- **F9 — humans own the watchlist.** The scout NEVER writes `scarcities.json`; it can't even mint an
  `id`. Output is a *proposal* surfaced for human PR approval (same path as committee edits).
- **Cost-bounded & loud.** Per-run call budget logged; degraded/over-budget runs say so (reuse the
  committee-health + liveness patterns just shipped).
- **Self-grading.** Every proposed scarcity is a dated, falsifiable claim in the same ledger; graded
  by the scorecard. Premier *process* ≠ premier *returns* — the scorecard is the referee.

## Build sequence (each independently shippable, TDD red→green→verify)
1. **Constraint-language FTS clustering** — pure cluster/rank fn over `searchFts` hits (testable with
   fixtures), then wire a bounded sweep. Emits ranked candidate constraints + their complaining filers.
2. **Candidate → committee adapter** — shape a candidate into the committee's evidence bundle so the
   existing Bull/Bear/Skeptic/CRO path scores it; surface survivors as proposals (F9).
3. **Legibility scorer** — soft anti-consensus penalty + `early/legible` tag (pure, fixture-tested).
4. **BOM laddering** — dependency-expansion from the 24 seeds (pure graph step + bounded enrichment).
5. **`scout.yml`** — weekly workflow, budget cap, proposals published for review.
6. **Patent/arXiv engine** — new keyless source module (mirror `marketdata.mjs` keyless-first), last.

## Resolved design decisions

### D1 — Constraint-language queries: LLM-generated, human-vetted, then cached
The complaint-phrase list is **LLM-generated** (broader/novel phrasings than we'd hand-write) but
**gated by human approval before it is ever used to search.** Flow: `generate → human approves the
phrase list (a cheap, reviewable artifact) → only then run the bounded FTS sweep`. The approved list
is **cached/committed** so a normal weekly run does NOT regenerate (no per-run cost or drift); regen
is an explicit, occasional action that re-enters the approval gate. This keeps the breadth of LLM
generation without letting an unvetted/garbage query trigger noisy filing sweeps.

### D2 — Candidate memory: track BOTH proposed and committee-rejected
Persist a `scout-seen.json` store of every candidate ever surfaced, tagged `proposed` /
`rejected` / `accepted`. A **rejected** candidate stays suppressed and is NOT re-proposed — UNLESS a
**re-entry rule** fires: materially new evidence (a new dated filing/contract/policy catalyst not
present at rejection time). This mirrors the committee's own "burden of proof is on change" rule —
a killed idea must clear a higher bar to come back, so the weekly feed never re-litigates dead ideas.
Open sub-question for build: exact re-entry trigger (lean: a new dated evidence item + a bumped
`evidence_hash` since the rejection).

### D3 — Proposal surface: a SEPARATE scout feed
Scout candidates (proposed NEW scarcities) get their **own data file + dashboard section**, distinct
from the committee's re-scores of the existing 24. Rationale: admitting a brand-new scarcity to the
watchlist is a *different, higher-scrutiny decision* than re-rating a known thesis ("is this even
real?" vs "has priced_in moved?") and must never be rubber-stamped like a routine edit. The scout
feed carries scout-specific context the committee tier doesn't: the **legibility tag**
(`early/contrarian` vs `already-legible`), the **complaining filers** (constraint-shadow evidence),
and the **ladder path** (for BOM-derived candidates). Reuses the same F9 human-PR approval mechanism,
just on its own surface.

## Remaining build-time sub-questions (small, decide in-flight)
- D1: how many phrases to cap the approved list at (lean: ~15–20).
- D2: precise re-entry trigger (lean: new dated evidence item changes the candidate's evidence_hash).
- BOM ladder depth cap per seed (budget control; lean: 1–2 layers up).
