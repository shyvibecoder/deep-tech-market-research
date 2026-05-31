# Setup — deploy the Puck dashboard & scanner (iPhone-friendly, all in Safari)

This repo (renamed to `deep-tech-market-research`) contains the full research + the Puck scarcity-radar app. Deploy in two steps, no terminal required.

## 1. Host the dashboard on Vercel
1. Go to **vercel.com** → sign in with GitHub.
2. **Add New → Project** → pick **`deep-tech-market-research`** → **Deploy**.
3. Vercel reads `vercel.json` automatically (Output Directory = `web`, no build step) and gives you a live dashboard URL. Done.

## 2. Turn on the auto-scanner (free)
The scanner lives in `.github/workflows/scan.yml` and runs on GitHub Actions (free) — it pulls free market quotes, recomputes crowding scores + trigger status, commits `web/data/signals.json`, and opens an Issue when a deploy/exit trigger fires.
- It runs on a weekday schedule automatically once the repo is on GitHub.
- **To run it on demand:** repo → **Actions** tab → **scan** → **Run workflow**.
- It also watches **SEC EDGAR** filings (8-K/10-Q/etc) per holding and pulls **Google-News RSS** per scarcity — both free/keyless — and surfaces them on the dashboard's "Filings & news" tab.
- **(Optional) LLM "analyst + red-team" digest + research:** add **any one** free key as a repo secret under **Settings → Secrets and variables → Actions** to enable it; add **two+** for a true cross-model adversarial review (the analyst runs on one model, the red-team on another). The engine prefers the highest-free-limit providers first (**Groq → OpenRouter → Gemini**), retries on rate-limits, and reports loudly if a model is unreachable.
  - `GROQ_API_KEY` — **primary**, high free limit (gpt-oss-120b thinking model). Free at **console.groq.com**.
  - `OPENROUTER_API_KEY` — **one key unlocks DeepSeek R1 / Qwen3 / GLM / Kimi**. Free at **openrouter.ai**; pick a model with the `OPENROUTER_MODEL` variable (e.g. `deepseek/deepseek-r1:free`, `qwen/qwen3-coder:free`, `z-ai/glm-4.5-air:free`).
  - `GEMINI_API_KEY` — powers the **in-browser** digest too. Free at **aistudio.google.com** (note: tiny free RPM, so it's best as a 2nd opinion, not the primary).
  - **(Paid, optional — materially better reasoning)** `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` — frontier models that **lead** the committee seats / the Chief-Risk-Officer review when set (~$1–4 per research run). They're preferred ahead of the free tiers; with one set, your strongest seat runs on a frontier model while the free keys staff the rest.
  - Model overrides (variables, optional): `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `GEMINI_MODEL` — so a model retirement needs no code change. With no key, the digest/research are skipped (everything else still runs).

## 3. (Optional) Wire up the dashboard **Refresh** button
The Refresh button can kick the scan on demand from the dashboard via GitHub's `repository_dispatch`. It needs a token, which is **never committed** — it lives only in your browser's `localStorage`.
1. GitHub → **Settings → Developer settings → Fine-grained personal access tokens → Generate new token.**
2. **Resource owner** = your account; **Repository access** = only `deep-tech-market-research`; **Permissions → Repository → Contents = Read and write.** Generate and copy it.
3. On the dashboard, tap **⟳ Refresh** and paste the token when prompted. It's saved to this browser only and POSTed straight to GitHub; the `scan` workflow runs, and the dashboard **auto-polls and live-reloads** when the fresh `signals.json` lands (~1–3 min) — no manual reload.
- A bad/expired token is auto-cleared so you can re-paste. No token? Refresh just points you to the manual **Actions → scan → Run workflow**.

## 3b. (Optional) Enable the cost-basis trim rule + live sleeve cap
Copy `web/data/positions.local.example.json` to **`web/data/positions.local.json`** (this filename is **gitignored — never committed**) and fill in your real `shares` / `cost_basis` per ticker (and `cash_usd` dry powder). The scanner then computes the **trim rule** (a name > 2× cost basis **and** > 50× forward P/E → trim ~⅓) and the **live sleeve-cap** trigger (sleeve value vs the ~$1.72mm cap). `forward_pe` is fetched automatically where a free source allows; set it per position to override.

## 3c. (Optional) Email alerts when a trigger fires
The scanner already opens a GitHub Issue when a deploy/exit trigger fires (and you get GitHub's email if you "watch" the repo). To get a **direct email** instead — sent only when a trigger **newly** fires (a state change, not every run) — add these to the repo:
1. **Secrets** (Settings → Secrets and variables → Actions → *Secrets*): `SMTP_USER` and `SMTP_PASS`. The easy free route is **Gmail**: use your Gmail address as `SMTP_USER` and a **Gmail App Password** as `SMTP_PASS` (Google Account → Security → 2-Step Verification → App passwords). Optional `SMTP_HOST`/`SMTP_PORT` (default `smtp.gmail.com` / `465`).
2. **Variable** (same page → *Variables*): `ALERT_EMAIL_TO` = the address to notify.
That's it — no email is sent unless `SMTP_USER` is set, so this stays off until you opt in. (The email step uses the `dawidd6/action-send-mail` action; pin it to a commit SHA if you prefer.)

## 3d. (Optional) Price-history database (Supabase)
Persist daily price history to a free Postgres DB so backtests, the objective metrics, and the V2.3 cross-check use a growing record instead of re-fetching 1–2 years from Yahoo each run. Fully optional — leave it off and the scanner behaves exactly as before.
1. Create a free **[Supabase](https://supabase.com)** project. In the dashboard → **SQL Editor**, paste and run **`db/schema.sql`** (creates `price_history` with row-level security on).
2. **Variable** (Settings → Secrets and variables → Actions → *Variables*, or via the dashboard's **Admin** panel): `SUPABASE_URL` = your project URL (e.g. `https://xxxx.supabase.co`).
3. **Secret** (same page → *Secrets*): `SUPABASE_SERVICE_KEY` = your project's **service_role** key (Project Settings → API). It bypasses row-level security, so it's used **only by the scanner (server-side)** and is never exposed to the browser.
That's it — the next scan starts accumulating history. For a one-time **deep backfill** of each ticker's full available history, run the **scan** workflow manually and (if you maintain a fork) invoke `node scripts/scan.mjs --backfill`, or add a one-off dispatch that passes `--backfill`. The dashboard never reads the DB; it keeps reading the committed JSON.

## 4. Reliability (already on)
- A **stale-data banner** appears on the dashboard if the last scan is more than ~3 days old.
- The **`ci`** GitHub Action runs on every PR/push: it does an offline scan and asserts the data files + generated `signals.json` are schema-valid and that every portfolio ticker resolved or errored. The scanner itself fails loudly on malformed `web/data/*.json`.
- Run the same checks locally with `npm test`.

## 5. Keeping it current
- Edit theses/holdings/triggers directly in `web/data/*.json` (GitHub web editor works on iPhone). Schema validation will reject malformed edits on the next scan/CI run.
- The dashboard re-reads those files on every load; the scanner refreshes `signals.json` on its schedule.

## Where things are
- `research/MASTER-THESIS.md` — start here. `research/PORTFOLIO.md` + `research/POSITION-SIZING.md` — the $1.5M plan.
- `web/` — the dashboard. `scripts/scan.mjs` — the scanner. `APP.md` — full architecture.

> Not financial advice. The radar reflects the committed research; verify before acting.
