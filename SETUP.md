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
- **(Optional) LLM "analyst + red-team" digest:** create a free key at **aistudio.google.com** (Gemini), then in the repo → **Settings → Secrets and variables → Actions → New repository secret** → name `GEMINI_API_KEY`, paste the key. (Groq also supported via `GROQ_API_KEY`.) Without a key the scanner still runs; only the written digest is skipped.

## 3. (Optional) Wire up the dashboard **Refresh** button
The Refresh button can kick the scan on demand from the dashboard via GitHub's `repository_dispatch`. It needs a token, which is **never committed** — it lives only in your browser's `localStorage`.
1. GitHub → **Settings → Developer settings → Fine-grained personal access tokens → Generate new token.**
2. **Resource owner** = your account; **Repository access** = only `deep-tech-market-research`; **Permissions → Repository → Contents = Read and write.** Generate and copy it.
3. On the dashboard, tap **⟳ Refresh** and paste the token when prompted. It's saved to this browser only and POSTed straight to GitHub; the `scan` workflow runs and commits fresh `signals.json` in ~1–2 min (reload to see it).
- A bad/expired token is auto-cleared so you can re-paste. No token? Refresh just points you to the manual **Actions → scan → Run workflow**.

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
