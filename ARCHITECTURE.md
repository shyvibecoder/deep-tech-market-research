# Data architecture & forward-phase audit

This is the canonical reference for Puck's **data model** and a **deep audit** of whether it's
sound for the roadmap (v3 thesis-versioning + auto-research, v4 tracking + alerts). It is the
"don't break these contracts" doc for any future session.

> Not financial advice. See `README.md` for the thesis and `ORIENTATION.md` for the roadmap.

---

## 1. Data-flow (who writes what)

```
 HAND-EDITED (source of truth, committed)        GENERATED (committed, do not hand-edit)
 ─ web/data/scarcities.json   ─┐                 ─ web/data/signals.json   ← scripts/scan.mjs
 ─ web/data/portfolio.json    ─┤  read by         (quotes, crowding, forward P/E, filings,
 ─ web/data/triggers.json     ─┘  scan.mjs  ───▶   news, trigger_status, digest, errors)
                                                  
 LOCAL-PRIVATE (gitignored, optional)            RENDER
 ─ web/data/positions.local.json                 ─ web/ static dashboard reads ALL of the above
   (real shares / cost_basis / cash)               via fetch(); signals.json is cache-busted.

 The scan runs in GitHub Actions (cron + repository_dispatch from the Refresh button),
 commits signals.json, and (deduped) opens an Issue when a trigger fires.
```

**Tiering invariant (keep this):** four distinct ownership classes — *hand-edited source of
truth*, *generated*, *local-private*, and (coming) *append-only history / auto-research*. Never
let a generator hand-edit a source-of-truth field without human approval (that's what the v3
auto-PR is for), and never commit local-private data.

---

## 2. Current schemas (as validated by `scripts/lib/schema.mjs`)

- **scarcities.json** — `{ updated, legend, scarcities[] }`; each scarcity:
  `{ id, sector, scarcity, bind_window∈legend, priced_in∈legend, durability∈legend,
  substitution_risk∈{low,medium,high}, tickers[], non_consensus:bool, news_query?, thesis }`.
- **portfolio.json** — `{ updated, sleeve_usd, total_portfolio_usd, accounts:{ira,taxable},
  disclaimer, holdings[], tiers{} }`; each holding:
  `{ ticker, name, account∈{ira,taxable}, target_usd, weight, tier, role }`.
- **triggers.json** — `{ updated, triggers[] }`; each trigger:
  `{ id, name, type∈{auto,manual}, metric?, threshold?, action, status∈{armed,monitor,fired}, note? }`.
- **signals.json** (generated) — `{ scanned_at(ISO), source, universe_count, quotes{}, filings[],
  news[], trigger_status{drawdown,sleeve_cap,trim_rule}, digest, errors[] }`. Each quote is
  resolved `{price,high52,pct_off_high,ytd,source,crowding,forward_pe?}` **or** errored `{ticker,error}`
  **or** `null` (known non-tradeable placeholder).
- **positions.local.json** (gitignored) — `{ as_of, cash_usd?, positions:{ ticker:{shares,cost_basis,forward_pe?} } }`.

---

## 3. Audit findings (severity · finding · recommendation · phase)

| # | Sev | Finding | Recommendation | Phase |
|---|-----|---------|----------------|-------|
| F1 | **High (fixed)** | `scan.yml` opened a new Issue **every run** while a trigger stayed fired — alert spam. | **Done:** dedupe — only open if no open "Scarcity trigger fired" issue exists. | now |
| F2 | **High** | **Currency mixing in sleeve value.** `positions.local.json` sleeve sum is `Σ shares×price`, but quotes for foreign tickers (`PRY.MI`€, `6324.T`¥, `OXIG.L`£, `SYR.AX`A$, `U.UN`C$) are in local currency. Summing into a USD cap is wrong. *Today the user's actual holdings are all US-listed, so it's latent.* | Add `currency` to quotes (Yahoo returns it) and either FX-convert or reject non-USD positions with a loud note. Tag holdings `currency`. | v4 (before foreign lots) |
| F3 | **Med** | **No security registry.** `isTradeable` is a regex; ETF-vs-stock, CIK, exchange, currency are inferred ad hoc (forward P/E is fetched even for ETFs; EDGAR guesses CIK each run). | Add `web/data/securities.json` (or fields on holdings): `{ticker:{type:etf|stock|adr, cik, exchange, currency, foreign}}`. Removes guesswork for EDGAR / forward-P/E / FX. | v3–v4 |
| F4 | **Med** | **No thesis history / versioning.** `scarcities.json` is a single snapshot (`updated` only). The radar can't show drift ("enrichment: non-consensus→crowded"). | Introduce append-only `web/data/history/scarcities-YYYY-MM-DD.json` snapshots **or** a derived `web/data/scarcity-history.json` (`id → [{date,priced_in,bind_window,non_consensus}]`) the scanner appends each run. Git history already preserves raw edits; this makes drift queryable by the UI. | v3 |
| F5 | **Med** | **No machine-readable confidence** on scarcities → the v3 auto-PR ("propose edits when confidence crosses a threshold") has nothing to threshold on. | Add optional `confidence:0..1` and `last_reviewed` per scarcity; the auto-research writes them. | v3 |
| F6 | **Med** | **DCA calendar is prose only** (`POSITION-SIZING.md`), so v4's "planned vs deployed" view has no data to read. | Add `web/data/dca.json`: per-holding `{month_1..9: planned_usd}` derived from the tiers/calendar; deployed comes from `positions.local.json` over time. | v4 |
| F7 | **Med** | **No "new since last run" state** for filings/news/triggers. Each scan re-lists a rolling 21-day window, so the digest re-summarizes the same items and alerts can't say "newly fired". | Persist a small `web/data/seen.state.json` (last accession #s / title hashes / last-fired timestamps). Lets the digest and alerts focus on deltas; also powers v4 alert dedupe across channels. | v3–v4 |
| F8 | **Low** | **No `schema_version`** on any file → future migrations are implicit. | Add `schema_version:1` to each data file; have the validator warn on unknown versions. Cheap insurance before the model grows. | v3 |
| F9 | **Low** | **Auto-research ↔ source-of-truth ownership** isn't declared. v3 will write to `scarcities.json` via PR — which fields may a bot propose vs. human-only? | Document/enforce: bot may propose `priced_in`,`bind_window`,`non_consensus`,`confidence`; **never** `thesis`/`tickers` without human edit. Keep the human-approves-PR gate. | v3 |
| F10 | **Low** | **signals.json monolith** will bloat as filings/news/forward-P/E grow. | Keep `signals.json` = *latest snapshot only*; route time-series to `history/` (F4/F7). Don't let history pile into signals.json. | v3+ |
| F11 | **Low** | **Trigger model split** (auto vs manual) is fine, but manual policy triggers (`mp_policy`, `leu_policy`, …) have no data feed, so they're dashboard-only reminders. | Optional: key manual triggers to news/filing signals so the digest can nudge them. Acceptable as-is. | v3+ |

**Bottom line:** the core model is **sound and correctly tiered** for what's shipped (v1–v2).
The generated/source/local separation is clean, the validator is enforced on both inputs and
output, and the dashboard reads defensively. The gaps are all *additive* for future phases —
no rework of existing files is required, only **new** files (`history/`, `securities.json`,
`dca.json`, `seen.state.json`) and a few **optional** fields (`confidence`, `last_reviewed`,
`schema_version`, `currency`). The two to address before they bite: **F2 (currency)** the moment
a foreign-denominated lot is entered, and **F7 (delta state)** to make v3/v4 deltas meaningful.

---

## 4. Concrete proposals for the next phases

**v3 (thesis re-run + drift):** add `scarcity-history.json` (F4) + `confidence`/`last_reviewed`
(F5) + `schema_version` (F8); auto-research writes dated `research/auto/<date>.md` and a diff,
and opens a PR editing only bot-owned fields (F9). The radar gains a "drift" column from history.

**v4 (tracking + alerts):** add `dca.json` (F6) for planned-vs-deployed; compute live position
value + rebalance bands (>±25% from target weight) from `positions.local.json` × quotes; add a
`seen.state.json` (F7) so ntfy/Telegram alerts fire once per *new* event and dedupe across the
GitHub-issue channel; resolve currency (F2) before summing foreign lots.

*These are recommendations, not yet built. Implement per phase; keep the tiering invariant.*
