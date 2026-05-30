# ORIENTATION — start-here prompt for a new session

> Paste the block below as your first message in a new Claude Code session that is **scoped to `shyvibecoder/deep-tech-market-research`**. It orients the agent on what exists, the guardrails, and the roadmap.

---

## CONTEXT FOR THE AGENT

You are working in **`shyvibecoder/deep-tech-market-research`** (private). It contains a finished deep-research study on 10-year (2026–2036) structural technology scarcities, a personal investment plan derived from it, and a deployed web app ("Puck") that keeps the thesis and portfolio triggers current. The dashboard is **already live on Vercel** (static, serves `web/`, no build). Read `README.md`, `APP.md`, and `research/MASTER-THESIS.md` first.

### What the project IS
1. **Research** (`research/`): a multi-agent, adversarially-reviewed thesis. Entry point `MASTER-THESIS.md`; full synthesis `SYNTHESIS.md`; 8 sourced sector deep-dives (`deepdives/01-08`); 4 red-team critiques (`redteam/01-04`); `etf-map.md`.
2. **Investment plan**: `PORTFOLIO.md` + `POSITION-SIZING.md`. Real money: **$1.5M sleeve = $800K IRA + $700K taxable** (~29% of a $5.2M portfolio). Asset location: trim-heavy/cyclical holdings in the IRA (tax-free turnover); buy-and-hold anchors + foreign dividend payers (ASML, Siemens Energy ADR) in taxable (foreign-tax credit). A 9-month DCA deployment calendar + deploy/exit triggers are defined.
3. **The app "Puck"** (`web/`, `scripts/`, `.github/workflows/scan.yml`): a $0-to-run scarcity radar.
   - `web/` = static dashboard (radar, timeline, portfolio + live trigger status, agent digest) reading `web/data/*.json`.
   - `scripts/scan.mjs` (+ `lib/quotes.mjs`, `lib/llm.mjs`) = the scanner: free keyless quotes (Stooq→Yahoo fallback), a crowding score, auto-trigger evaluation, and an optional free-LLM "analyst + red-team" digest (Gemini/Groq).
   - `.github/workflows/scan.yml` = the "agent worker": a free GitHub Actions cron that runs the scan, commits `web/data/signals.json`, and opens an Issue when a trigger fires. (Vercel hosts the UI; GitHub Actions runs the agents.)

### Data model (`web/data/`)
- `scarcities.json` — the scarcity map (id, sector, bind_window, priced_in, durability, substitution_risk, tickers, non_consensus, thesis).
- `portfolio.json` — holdings, target $, weight, account, tier, role.
- `triggers.json` — deploy/exit rules (auto + manual).
- `signals.json` — **generated** by the scanner (live quotes, crowding, trigger status, digest). Do not hand-edit.

### The thesis in one paragraph (so you don't re-derive it)
"Where the puck is going" is already a crowded, richly-priced consensus (power, uranium, copper, rare earths, electricians, HBM/optics were the 2024–26 trades) — but refusing to own a secular grid/copper/power deficit because it "already ran" is just as costly. Nearly every scarcity is downstream of ONE factor: AI-datacenter capex + electrification (~1.0 internal correlation; shared 2027–28 capex-digestion failure mode). The durable edge is the slow-to-build inputs (electrons/power, grid, skilled labor, processing/separation, proprietary data, single-source materials), not the fast-ramp manufacturing scarcities being actively quadrupled. Two laws: a chokepoint is not a rent (Wolfspeed went bankrupt owning one); the best chokepoints are inaccessible (private/foreign/impaired) — so for the most robust scarcities there is no clean ETF. Highest-conviction actionable idea: own the electrons (GE Vernova, Siemens Energy, IPPs).

### GUARDRAILS (important)
- **Not financial advice.** This is research + a personal plan. Keep the disclaimer in any user-facing output. Don't overstate certainty; flag what's already-priced.
- **Don't silently change investment numbers.** If you update `portfolio.json`/`POSITION-SIZING.md`, explain the change and keep it tied to the user's stated $800K IRA / $700K taxable split.
- **Verify before claiming.** WebFetch may be blocked in-sandbox; cross-check load-bearing facts across ≥2 sources. A few figures in the deep-dives are flagged second-hand — verify before sizing real positions on them.
- **Free-tier only** for data/LLM (user's constraint): Stooq/Yahoo/SEC EDGAR/RSS for data; Gemini/Groq free tier for the LLM. No paid keys assumed.
- **Commit hygiene:** small, descriptive commits; push to a feature branch and open a PR into `main` if `main` is protected.
- **Don't touch real brokerage accounts or place trades.** This project only tracks and informs.

### Sanity checks on first run
- `node scripts/scan.mjs --offline` should write a valid `web/data/signals.json` (logic check; no network).
- `node scripts/scan.mjs` should fetch live quotes when network is open (works in GitHub Actions; may be blocked in a restricted sandbox — that's expected, degrade gracefully).
- Confirm the Vercel deploy reads the committed `signals.json` after a scan commits.

---

## ROADMAP (build in this order; each item is independently shippable)

**v1 — harden what's live (do first)** ✅ _shipped_
- [x] Add a tiny test/CI: `node scripts/scan.mjs --offline` in a GitHub Action on PR, asserting `signals.json` is valid JSON and every portfolio ticker resolved (or errored explicitly). → `.github/workflows/ci.yml` + `scripts/selfcheck.mjs` (`npm test`).
- [x] Make the dashboard "stale data" aware: show a banner if `scanned_at` is older than ~3 days. → `#staleBanner` in `web/`.
- [x] Wire the dashboard **Refresh** button to `repository_dispatch` (needs a fine-grained token; document it, don't hardcode). → token in `localStorage`; see SETUP.md §3.
- [x] Add `web/data/schema` validation in the scanner (fail loudly on malformed data files). → `scripts/lib/schema.mjs` (validates inputs + generated output).

**v2 — make the scanner smarter (free sources)**
- [ ] **SEC EDGAR watch:** poll 8-K/10-Q full-text search for each holding; surface filings that mention backlog, capacity, guidance, pricing. Summarize with the free LLM.
- [ ] **News RSS per scarcity:** Google-News/Bing RSS queries keyed off `scarcities.json` thesis terms; dedupe; LLM-summarize into the digest.
- [ ] **Cost-basis-aware trim trigger:** let the user enter actual buy prices (a gitignored `web/data/positions.local.json`); compute the "2× cost AND >50× forward" trim rule and the sleeve-cap (>~33%) trigger for real.
- [ ] **Forward-multiple fetch:** pull forward P/E where a free source allows, to make the "went up a lot ≠ expensive" check live (this was the key analytical correction in the thesis).

**v3 — re-run the research loop on a schedule (the differentiator)**
- [ ] Port the original multi-agent pattern (8 deep-dives → 4 red-teams → synthesis → adversarial pass) into a scheduled job on the **free LLM**, writing a dated `research/auto/<date>.md` and a diff vs the last run ("what changed in the thesis this month").
- [ ] Version each scarcity's `priced_in`/`bind_window` over time so the radar can show drift (e.g., "enrichment moved from non-consensus → crowded").
- [ ] Auto-open a PR with proposed `scarcities.json` edits when the loop's confidence crosses a threshold — human (you) approves the merge.

**v4 — portfolio tracking & alerts**
- [ ] DCA-progress view: planned vs deployed per holding against the `POSITION-SIZING.md` calendar.
- [ ] Push alerts beyond GitHub Issues (e.g., free ntfy.sh/Telegram webhook) when a trigger fires.
- [ ] Rebalance helper: flag any holding >±25% from target weight.

**Nice-to-haves**
- [ ] Watchlist of private/foreign chokepoints (SpaceX, Anduril, Physical Intelligence, ASML, Lynas, Harmonic Drive) with "how to access" notes.
- [ ] A "crowding vs durability" scatter view to visualize where the puck is vs where it's going.

### First task suggestion for the new session
Start with **v1** (CI test + stale-data banner) to lock in reliability, then **v2 SEC EDGAR watch** — it's the highest-signal, fully-free upgrade and directly serves "stay on top of it."

> Reminder: not financial advice; free-tier only; verify load-bearing facts; keep investment numbers tied to the $800K IRA / $700K taxable split.
