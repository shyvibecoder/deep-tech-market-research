# Puck — Structural-Scarcity Radar (the app)

A **$0-to-run** dashboard + scanning engine that keeps the tech-scarcity thesis and your portfolio triggers up to date, so you stay on top of "where the puck is going."

## What it does
- **Scarcity radar** — every tracked scarcity with its binding window, priced-in level, durability, substitution risk, and a *live crowding score* (from market data).
- **Portfolio & triggers** — your $1.5mm sleeve (IRA + taxable), live prices/YTD/% off high per holding, and the deploy/exit **trigger status** (armed / monitor / fired).
- **Filings & news** — recent **SEC EDGAR** filings per holding (8-K/10-Q/10-K/6-K/20-F, with 8-K item topics) and **Google-News RSS** headlines keyed off each scarcity's thesis terms (both free, keyless). These also feed the digest.
- **Agent digest** — an optional free-LLM "analyst + red-team" summary of what changed, prioritizing filings that touch backlog/capacity/guidance/pricing.

## Architecture (why it's free and how the agents run)
```
 Vercel (static dashboard)  ◀── reads ── web/data/*.json
        ▲                                      ▲ commits
        │ Refresh (repository_dispatch)        │
        └──────────────▶  GitHub Actions (cron) — the "agent worker"
                                 │  free data: Stooq / Yahoo / SEC EDGAR / Google-News RSS  (no key)
                                 │  free LLM:  Gemini free tier OR Groq free tier            (one free key)
                                 └─ runs scripts/scan.mjs → analyst+red-team digest → signals.json
```
Vercel functions are too short-lived for long agent runs, so the **scan + agent passes run in GitHub Actions** (free: unlimited for public repos, 2,000 min/mo private) and commit results back. The dashboard just renders them. Thesis history = git history.

## Run it locally (no keys needed)
```bash
node scripts/scan.mjs            # live data (needs open network)
node scripts/scan.mjs --offline  # parse/logic check, writes valid signals.json
npm test                         # offline scan + schema/selfcheck gate (same as CI)
npm run serve                    # static server at http://localhost:3000
```

## Deploy the dashboard on Vercel
1. Import the repo in Vercel. It auto-detects `vercel.json` → **Output Directory = `web`**, no build step.
2. Done — it serves the static dashboard reading the committed `web/data/*.json`.

## Turn on the free scanner + agent digest
1. **(Optional, for the LLM digest)** create a **free** key — Google AI Studio (`GEMINI_API_KEY`) or Groq (`GROQ_API_KEY`) — and add it under **GitHub → Settings → Secrets → Actions**. Without a key the scanner still runs (quotes + auto-triggers); only the narrative digest is skipped.
2. The `scan` workflow runs weekdays 13:00 UTC, on manual dispatch, and on `repository_dispatch` (the dashboard **⟳ Refresh** button — **keyless** by default via the `/api/refresh` serverless endpoint that holds the dispatch token server-side; falls back to a per-browser token if unconfigured, see SETUP §3a/§3b). It commits `signals.json` and opens a GitHub Issue when a trigger fires.

## Data model (`web/data/`)
- `scarcities.json` — the scarcity map (edit to add/retune theses).
- `portfolio.json` — your holdings, targets, tiers, account location.
- `triggers.json` — deploy/exit rules (auto + manual).
- `signals.json` — **generated** by the scanner (live quotes, crowding, trigger status, digest).

## Roadmap (free-tier friendly)
- **v1 (now):** static dashboard + scanner (quotes, crowding, auto-triggers) + optional LLM digest + alert issues.
- **v2 (now):** SEC EDGAR 8-K/10-Q watch + Google-News RSS per scarcity, summarized by a **cross-model** free-LLM digest (analyst on one model, red-team on another); forward-P/E fetch; cost-basis trim rule + live sleeve-cap via a gitignored `positions.local.json`; on-demand Refresh that auto-reloads.
- **v3:** scheduled re-run of the full deep-dive + red-team pipeline (the same multi-agent pattern as the research) on the free LLM, versioning each thesis; portfolio tracker with live position values and DCA-progress.

> Not financial advice. The radar reflects the committed research; verify before acting.
