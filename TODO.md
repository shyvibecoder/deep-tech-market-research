# Puck — TODO / what-to-do-next

Living checklist and the source of truth for "what's next". Update every session.
Audit findings are detailed in `ARCHITECTURE.md`; the timing layer in `REGIME.md`.

## ⭐ North star: alpha (scarcity thesis) → timing (regime) → cash
The thesis picks *what* to own; a literature-grounded timing layer decides *when* to deploy / go
all-in vs. apply the brakes into cash. See `REGIME.md` for the evidence base.
- [x] **Timing/regime layer v1** — trend(200-DMA) + 12m abs-momentum + vol-state + drawdown → risk
  posture (risk-on / neutral / caution / defensive). Grounded in Faber'07, MOP'12, Moreira-Muir'17,
  Hurst-Ooi-Pedersen'17; breadth down-weighted (basket ~1.0 corr). Surfaced on dashboard + digest inputs.
- [ ] **Timing v2** — per-name signed TSMOM sizing (not just one portfolio posture); cross-asset
  trend (rates/USD); longer look-back history store; whipsaw dampening. (See REGIME.md "limitations".)

## Audit fixes (ARCHITECTURE.md F1–F11)
- [x] **F1** — dedupe trigger-alert issues in `scan.yml` (don't reopen while one is open)
- [x] **F2** — capture per-quote `currency`; **skip + flag** non-USD lots in the sleeve value
- [x] **F3** — `securities.json` registry (type/foreign) + validator; wired to skip forward-P/E on ETFs
- [x] **F4** — `scarcity-history.json` per-run snapshots (change-only) + radar "drift" marker
- [x] **F5** — `last_reviewed` set on every scarcity + optional `confidence` (0..1) schema support (`confidence` filled by v3)
- [ ] **F6** — `dca.json` planned schedule + planned-vs-deployed in `signals.json` + dashboard view
- [x] **F7** — `seen.state.json` delta tracking → filings/news show **NEW** badges; trigger fire-times recorded
- [x] **F8** — `schema_version` on all data files + validator errors on unknown version
- [x] **F9** — ownership model documented (ARCHITECTURE §1: bot-proposable vs human-only fields)
- [x] **F10** — `signals.json` kept snapshot-only; time-series live in `scarcity-history.json` / `seen.state.json`
- [ ] **F11** — (later) key manual policy triggers to news/filing signals
- [ ] **F2b** — full FX conversion (fetch `${CUR}USD=X`) so foreign lots count in the sleeve value

### Remaining audit/back-fill (next)
- [ ] **F6** dca.json + DCA planned-vs-deployed view (pairs with v4)
- [ ] **F2b** FX conversion for foreign lots
- [ ] **F11** wire manual policy triggers to news/filings

## v2 status — complete
- [x] SEC EDGAR 8-K/10-Q watch
- [x] News RSS per scarcity
- [x] Cost-basis trim rule + live sleeve cap
- [x] Forward-multiple (forward P/E) fetch
- [x] Multi-model cross-adversarial digest (extra)
- [x] On-demand Refresh: dispatch + auto-poll + live-reload (extra)

## v3 — re-run the research loop (the differentiator)
- [ ] Scheduled 8 deep-dives → 4 red-teams → synthesis on free LLMs → dated `research/auto/<date>.md` + diff vs last run
- [ ] Versioned `priced_in`/`bind_window` drift (uses F4) + `confidence` (F5)
- [ ] Auto-open PR with proposed `scarcities.json` edits when confidence crosses a threshold (bot-owned fields only; human approves)

## v4 — tracking & alerts
- [ ] DCA planned-vs-deployed view (uses F6)
- [ ] Push alerts (ntfy.sh / Telegram) on trigger fire (uses F7 for dedupe across channels)
- [ ] Rebalance helper: flag any holding >±25% from target weight

## Nice-to-haves
- [ ] Private/foreign chokepoint watchlist (SpaceX, Anduril, ASML, Lynas, Harmonic Drive) + "how to access" notes
- [ ] Crowding-vs-durability scatter view
