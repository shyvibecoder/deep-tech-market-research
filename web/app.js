// Sanitizers for untrusted third-party strings before innerHTML (mirror of
// web/sanitize.mjs, which is unit-tested). XSS guard for RSS/EDGAR data.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => { try { const x = new URL(String(u)); return (x.protocol === "http:" || x.protocol === "https:") ? x.href : "#"; } catch { return "#"; } };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtPct = (x) => (x == null ? "—" : (x * 100).toFixed(0) + "%");
const fmtUsd = (x) => "$" + (x / 1000).toFixed(0) + "k";
const WIN = { now: ["now", "Binding now"], "2027": ["y27", "2027"], "2028-29": ["y28", "2028-29"], "2030+": ["y30", "2030+"], "physics-floor": ["floor", "Physics floor"] };

const REPO = "shyvibecoder/deep-tech-market-research"; // owner/repo the Refresh button dispatches to
const TOKEN_KEY = "puck_dispatch_token";
const STALE_DAYS = 3; // show a banner if the last scan is older than this

let DATA = {};
const bust = () => `?t=${Date.now()}`; // cache-bust signals.json so reloads see fresh commits

async function fetchData() {
  const live = new Set(["signals", "research-proposals", "scout-candidates", "scout-phrases", "diversifier-candidates"]);
  const [scar, port, trig, sig, dca, proposals, scout, scoutPhrases, diversifier] = await Promise.all(
    ["scarcities", "portfolio", "triggers", "signals", "dca", "research-proposals", "scout-candidates", "scout-phrases", "diversifier-candidates"].map((f) =>
      fetch(`data/${f}.json${live.has(f) ? bust() : ""}`).then((r) => r.json()).catch(() => ({})))
  );
  return { scar, port, trig, sig, dca, proposals, scout, scoutPhrases, diversifier };
}

async function load() {
  DATA = await fetchData();
  render();
}

const POSTURE = {
  "risk-on": ["pos", "🟢 RISK-ON — trend"], neutral: ["", "⚪ NEUTRAL — thrust re-entry"],
  defensive: ["neg", "🔴 DEFENSIVE — cash"], unknown: ["", "POSTURE —"],
};

function render() {
  const sig = DATA.sig;
  $("#scanned").textContent = sig?.scanned_at ? `· last scan ${new Date(sig.scanned_at).toLocaleString()}` : "";
  const reg = sig?.regime; const pill = $("#posturePill");
  if (pill) {
    const [cls, lbl] = POSTURE[reg?.posture] || POSTURE.unknown;
    pill.className = `posture ${reg?.posture || "unknown"}`;
    pill.textContent = reg ? lbl : "";
  }
  renderStale(sig); renderRadar(); renderPortfolio(); renderV23(); renderCatalysts(); renderChokepoints(); renderResearch(); renderScout(); renderDiversifier(); renderDigest();
}

// Research review: show the LLM's proposed scarcity reassessments as before→after diffs with an
// Accept/Reject control. Accept opens a PR via the user's admin token (F9-guarded in-browser to
// bot-owned fields only). The view model + the guarded mutation live in research-review.mjs (tested).
function renderResearch() {
  const box = $("#researchReview"); if (!box) return;
  const RR = window.PuckResearch;
  const doc = DATA.proposals;
  // The roster (which LLM played each role this run) is shown whenever it's published — even with
  // zero proposals — so you can always see the committee make-up + whether the CRO check was active.
  const roster = doc?.roster ? rosterHtml(doc.roster, `last run (${esc(doc.generated || "—")})`) : "";
  if (!RR || !doc || !DATA.scar?.scarcities) { box.innerHTML = roster; return; }
  const diffs = doc.proposals?.length ? RR.proposalDiffs(doc.proposals, DATA.scar) : [];
  if (!diffs.length) { box.innerHTML = roster + `<p class="foot">No open research proposals (last run ${esc(doc.generated || "—")} proposed no changes).</p>`; return; }
  box.innerHTML = roster + `<h3>Research proposals <button class="help" data-help="research">?</button> <span class="foot">— LLM-proposed reassessments (prompt v${esc(String(doc.prompt_version ?? "?"))}); you approve. Bot-owned fields only.</span></h3>` +
    diffs.map((d, i) => {
      const chg = d.changes.map((c) => `<code>${esc(c.field)}</code>: <span class="pi-${esc(String(c.from))}">${esc(String(c.from))}</span> → <strong class="pi-${esc(String(c.to))}">${esc(String(c.to))}</strong>`).join(" · ");
      const src = (d.sources || []).slice(0, 4).map((s) => esc(s)).join("; ");
      return `<div class="proposal" data-pidx="${i}">
        <div><strong>${esc(d.scarcity)}</strong> ${d.confidence != null ? `<span class="foot">conf ${Math.round(d.confidence * 100)}%</span>` : ""}</div>
        <div>${chg}</div>
        ${d.rationale ? `<div class="foot">${esc(d.rationale)}</div>` : ""}
        ${src ? `<div class="foot">sources: ${src}</div>` : ""}
        <div class="modal-actions">
          <button class="accept-proposal" data-id="${esc(d.id)}">✓ Accept → open PR</button>
          <button class="reject-proposal" data-id="${esc(d.id)}">✕ Reject</button>
        </div>
      </div>`;
    }).join("");
  $$(".accept-proposal", box).forEach((b) => b.onclick = () => acceptProposal(b.dataset.id));
  $$(".reject-proposal", box).forEach((b) => b.onclick = () => { b.closest(".proposal").style.opacity = 0.4; b.closest(".proposal").querySelectorAll("button").forEach((x) => x.disabled = true); });
}

// Scout review: the SEPARATE feed of CANDIDATE NEW scarcities the scout surfaced + the committee
// vetted (SCOUT-DESIGN D3). A higher-scrutiny decision than a research re-score ("is this even a real
// scarcity?") — so each row shows the constraint evidence (complaining filer + the phrases that fired)
// and the committee read. Accepting opens a PR that ADDS the new scarcity to scarcities.json (F9).
function renderScout() {
  const box = $("#scoutReview"); if (!box) return;
  const SC = window.PuckScout;
  const doc = DATA.scout;
  const head = `<h3>Scout — candidate new scarcities <button class="help" data-help="scout">?</button> <span class="foot">— constraint-shadow leads the committee vetted; you approve admission to the watchlist.</span></h3>`;
  // D1 constraint-phrase status: the LLM proposes search phrases; only APPROVED ones get searched.
  const ph = DATA.scoutPhrases?.phrases || [];
  const pendingPhrases = ph.filter((p) => p.status === "pending");
  const approvedN = ph.filter((p) => p.status === "approved").length;
  const phraseHtml = ph.length ? `<div class="proposal"><div><strong>Constraint phrases</strong> <span class="foot">— ${approvedN} approved (searched)${pendingPhrases.length ? `, ${pendingPhrases.length} pending review` : ""}</span></div>` +
    (pendingPhrases.length ? `<div class="foot">pending: ${pendingPhrases.slice(0, 12).map((p) => `<code>${esc(p.phrase)}</code>`).join(" ")}</div>
      <div class="modal-actions"><button class="approve-phrases">✓ Approve pending phrases → open PR</button></div>` : `<div class="foot">All generated phrases vetted. Run the scout workflow with mode <code>generate-phrases</code> to propose more.</div>`) + `</div>` : "";
  if (!SC || !doc || !DATA.scar?.scarcities) { box.innerHTML = head + phraseHtml; return; }
  const cands = doc.candidates?.length ? SC.scoutCandidateView(doc, DATA.scar) : [];
  if (!cands.length) {
    const considered = (doc.considered || []).length;
    box.innerHTML = head + phraseHtml + `<p class="foot">No open scout candidates (last sweep ${esc(doc.generated || "—")}${considered ? `; ${considered} lead(s) considered, none cleared the committee` : ""}).</p>`;
    wirePhraseBtn(box);
    return;
  }
  box.innerHTML = head + phraseHtml + cands.map((c, i) => {
    const fields = [c.priced_in ? `priced_in=<strong class="pi-${esc(c.priced_in)}">${esc(c.priced_in)}</strong>` : "", c.bind_window ? `bind=${esc(c.bind_window)}` : ""].filter(Boolean).join(" · ");
    const phrases = (c.constraint_phrases || []).slice(0, 4).map((p) => `<code>${esc(p)}</code>`).join(" ");
    const disp = c.dispersion ? ` · ${esc(c.dispersion.level)} conviction` : "";
    return `<div class="proposal" data-sidx="${i}">
      <div><strong>${esc(c.scarcity)}</strong> ${c.confidence != null ? `<span class="foot">conf ${Math.round(c.confidence * 100)}%${disp}</span>` : ""}${c.legibility ? ` <span class="foot">· ${c.legibility === "early-contrarian" ? "🟢 early/contrarian" : "🟡 already-legible"}</span>` : ""}</div>
      ${fields ? `<div>${fields} · tickers: ${esc((c.tickers || []).join(", ") || "—")}</div>` : ""}
      ${c.complaining_filer ? `<div class="foot">flagged via filer <code>${esc(c.complaining_filer)}</code>${phrases ? ` — constraint language: ${phrases}` : ""}</div>` : ""}
      ${c.rationale ? `<div class="foot">${esc(c.rationale)}</div>` : ""}
      <div class="modal-actions">
        <button class="accept-scout" data-id="${esc(c.id)}">✓ Accept → open PR (add scarcity)</button>
        <button class="reject-scout" data-id="${esc(c.id)}">✕ Reject</button>
      </div>
    </div>`;
  }).join("");
  $$(".accept-scout", box).forEach((b) => b.onclick = () => acceptScoutCandidate(b.dataset.id));
  $$(".reject-scout", box).forEach((b) => b.onclick = () => { b.closest(".proposal").style.opacity = 0.4; b.closest(".proposal").querySelectorAll("button").forEach((x) => x.disabled = true); });
  wirePhraseBtn(box);
}
function wirePhraseBtn(box) {
  const b = box.querySelector(".approve-phrases"); if (b) b.onclick = () => approveScoutPhrases();
}

// V2.3 cross-check + the headline "when to act on a dislocation" verdict.
function renderV23() {
  const box = $("#v23Box"); if (!box) return;
  const v = DATA.sig?.v23, de = DATA.sig?.dislocation_entry, reg = DATA.sig?.regime;
  if (!v && !de) { box.innerHTML = ""; return; }
  // Dislocation entry verdict — the thing the owner wants to see.
  const w = de?.window;
  const verdict = w === "open" ? `<div class="de-verdict de-open">✅ Dislocation entry: <strong>ACT NOW</strong></div>`
    : w === "wait" ? `<div class="de-verdict de-wait">⏳ Dislocation entry: <strong>WAIT</strong></div>`
    : w === "none" ? `<div class="de-verdict de-none">— No dislocation to act on</div>` : "";
  const deReason = de ? `<p class="foot">${esc(de.reason)}</p>` : "";
  // V2.3 cross-check vs Puck's regime posture.
  let cross = "";
  if (v && v.state !== "UNAVAILABLE") {
    const brakes = reg?.posture === "defensive" || reg?.macro_stressed;
    const puckRisk = !brakes; // risk-on-ish
    const v23Risk = v.state === "FULL";
    const agree = puckRisk === v23Risk;
    const inst = v.instrument ? `holds <strong>${esc(v.instrument)}</strong>${v.rule ? ` (${esc(v.rule)}${v.overlay_applied ? "+overlay" : ""})` : ""}` : esc(v.state);
    cross = `<p class="foot">V2.3 F+C Thrust (replica, on QQQ): ${inst} vs Puck regime <strong>${esc(reg?.posture || "?")}</strong> — <span class="${agree ? "agree" : "diverge-w"}">${agree ? "✓ agree" : "⚠ diverge"}</span>. <span style="color:var(--mut)">${esc((v.reasons || [])[0] || "")}</span></p>`;
  } else if (v) {
    cross = `<p class="foot">V2.3 cross-check: <span style="color:var(--mut)">unavailable (needs live QQQ/VIX/HYG series)</span></p>`;
  }
  box.innerHTML = `<div class="v23-card"><strong>Dislocation timing <button class="help" data-help="dislocation">?</button></strong>${verdict}${deReason}${cross}</div>`;
}

function renderChokepoints() {
  const box = $("#chokeList"); if (!box) return;
  const cps = DATA.sig?.chokepoints || [];
  if (!cps.length) { box.innerHTML = `<p class="foot">No chokepoint data yet — proxies are discovered in the scan (GitHub Actions).</p>`; return; }
  // Second-order exposure (Edge 2): public names that sit ACROSS multiple bottlenecks — the
  // diversified "picks-and-shovels" way to play the complex, vs concentrated single-chokepoint plays.
  const hubs = DATA.sig?.proxy_hubs || [];
  const hubHtml = hubs.length ? `<div class="choke hub-panel">
      <div class="choke-h"><strong>🕸 Cross-chokepoint hubs</strong> <span class="foot">— public names exposed to ≥2 inaccessible bottlenecks (second-order, diversified plays)</span></div>
      <div class="foot">${hubs.map((h) => `<span title="${esc((h.chokepoints || []).join(", "))}${h.hub ? " · HUB" : ""}">${h.hub ? "<strong>" : ""}${esc(h.ticker)}${h.hub ? "</strong>" : ""} <span style="color:var(--mut)">(×${h.degree})</span></span>`).join(" · ")}</div>
    </div>` : "";
  box.innerHTML = hubHtml + cps.slice().sort((a, b) => (b.heat || 0) - (a.heat || 0)).map((c) => {
    // Discovered proxies are ranked by SPECIFICITY (purest play first), not raw mentions.
    // Generic tickers (appear across many chokepoints → diversified, weaker proxy) are dimmed + ⚠.
    const disc = (c.discovered || []).slice(0, 6).map((d) => {
      const m = d.mentions ? ` <span style="color:var(--mut)">(${d.mentions}×${d.score != null ? `, score ${d.score}` : ""})</span>` : "";
      return d.generic ? `<span style="opacity:.55" title="appears across many chokepoints — diversified, weaker proxy">${esc(d.ticker)}⚠${m}</span>` : `<strong>${esc(d.ticker)}</strong>${m}`;
    }).join(", ");
    const news = c.top_headline ? `<a href="${safeUrl(c.top_headline.link)}" target="_blank" rel="noopener">${esc(c.top_headline.title)}</a>` : "";
    return `<div class="choke">
      <div class="choke-h"><strong>${esc(c.name)}</strong> <span class="access ${esc(c.access)}">${esc(c.access)}</span>
        <span class="heatbar"><span style="width:${c.heat || 0}%"></span></span> heat ${c.heat ?? "—"}${c.rel != null ? ` · proxy rel ${(c.rel * 100).toFixed(0)}%` : ""}</div>
      <div class="foot">Gates: ${esc(c.gates || "")}. ${esc(c.how_to_access || "")}</div>
      <div class="foot">Seeded proxies: ${(c.proxies || []).map(esc).join(", ") || "—"} · <strong>Discovered (SEC filing mentions):</strong> ${disc || "—"}</div>
      ${news ? `<div class="foot">📰 ${news}</div>` : ""}
    </div>`;
  }).join("");
}

// Warn when the committed signals.json is stale (scanner hasn't run recently).
function renderStale(sig) {
  const el = $("#staleBanner"); if (!el) return;
  if (!sig?.scanned_at) {
    el.className = "banner show stale";
    el.textContent = "⚠ No scan data yet — run the scanner (Refresh, or the ‘scan’ GitHub Action).";
    return;
  }
  const days = (Date.now() - new Date(sig.scanned_at).getTime()) / 86400000;
  if (days > STALE_DAYS) {
    el.className = "banner show stale";
    el.textContent = `⚠ Stale data — last scan was ${Math.floor(days)} days ago (${new Date(sig.scanned_at).toLocaleString()}). Prices/triggers may be out of date; trigger a refresh.`;
  } else {
    el.className = "banner";
    el.textContent = "";
  }
}

function q(ticker) { return DATA.sig?.quotes?.[ticker]; }

function renderRadar() {
  if (!DATA.scar?.scarcities) { $("#radarTable tbody").innerHTML = ""; return; } // degrade gracefully if scarcities.json failed to load
  const sectors = [...new Set(DATA.scar.scarcities.map((s) => s.sector))].sort();
  const sel = $("#sectorFilter");
  if (sel.options.length <= 1) sectors.forEach((s) => sel.add(new Option(s, s)));
  const draw = () => {
    const f = sel.value, nc = $("#ncOnly").checked;
    const tb = $("#radarTable tbody"); tb.innerHTML = "";
    const oppOf = (s) => DATA.sig?.scarcity_signals?.[s.id]?.score;
    DATA.scar.scarcities
      .filter((s) => (!f || s.sector === f) && (!nc || s.non_consensus))
      // Rank by Opportunity Score (where the alpha is, ALPHA.md Edge 1); bind-window breaks ties.
      .sort((a, b) => (oppOf(b) ?? -1) - (oppOf(a) ?? -1) || Object.keys(WIN).indexOf(a.bind_window) - Object.keys(WIN).indexOf(b.bind_window))
      .forEach((s) => {
        const cz = s.tickers.map((t) => q(t)?.crowding).filter((x) => x != null);
        const crowd = cz.length ? Math.round(cz.reduce((a, b) => a + b) / cz.length) : null;
        const [cls, lbl] = WIN[s.bind_window] || ["", s.bind_window];
        const sig = DATA.sig?.scarcity_signals?.[s.id];
        const opp = sig?.score;
        const isDiv = s.axis === "diversifier";
        // Second axis: held to LOWER the book's drawdown, deliberately NOT scored by the Deep-tech build-out
        // Opportunity model — so show its drawdown/beta evidence in place of the (absent) score.
        const dv = s.diversifier_evidence;
        const pctOf = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
        const axisMark = isDiv
          ? `<span class="axis2" title="Second axis — a diversifier held to reduce drawdown, judged by the Deep-tech build-out gate (build-out β ≤ 0.3 — must not meaningfully amplify the build-out), not the Opportunity Score${dv?.caveat ? `. ${esc(dv.caveat)}` : ""}">◇ diversifier · 2nd axis</span>` : "";
        // Flag where the live tape materially disagrees with the human priced-in label (informative).
        const diverge = sig && sig.live_gate != null && Math.abs(sig.live_gate - sig.static_gate) >= 0.3
          ? `<span class="diverge" title="tape disagrees with the priced-in label: live gate ${sig.live_gate} vs label ${sig.static_gate}">${sig.live_gate > sig.static_gate ? "↑tape" : "↓tape"}</span>` : "";
        const oppCell = isDiv
          ? `<span class="dv" title="Second axis — judged on drawdown reduction, not Opportunity Score.${dv?.blend_with ? ` Blended 50/50 with ${esc(dv.blend_with)}: maxDD ${pctOf(dv.blend_maxDD)} (compρ ${dv.blend_compRho}).` : ""}">maxDD ${pctOf(dv?.maxDD)} · β ${dv?.mktBeta ?? "—"} · build-out β ${dv?.buildoutBeta ?? "—"}</span>`
          : opp == null ? "—"
          : `<span class="oppbar" title="gate(not-priced) ${sig.gate} [label ${sig.static_gate}${sig.live_gate != null ? ` · live ${sig.live_gate}` : ""}] × quality ${sig.quality}${sig.contrarian ? " · contrarian +" : ""}"><span style="width:${opp}%"></span></span> <strong>${opp}</strong>${diverge}`;
        const alphaMark = sig && sig.flag !== "none"
          ? `<span class="alpha ${sig.flag}" title="relative strength vs complex ${sig.rs}">${sig.flag === "de-rating" ? "↓ de-rating" : "↑ inflecting"}</span>` : "";
        // Forced-flow (Edge 3): accumulate is regime-aware — a deploy-on-trigger PRIORITY when the
        // timing overlay has the brakes on, an accumulate-now when it permits (overlays compose).
        const ff = sig?.forced_flow;
        const ffMark = ff?.flag === "accumulate"
          ? `<span class="ff ${ff.subordinate_to_timing ? "ff-wait" : "ff-go"}" title="${esc(ff.guidance || "")}${ff.window === "selling" ? " · tax-loss-selling window" : ff.window === "rebound" ? " · Jan rebound window" : ""}">${ff.subordinate_to_timing ? "⏳ accumulate on trigger" : "✚ accumulate"}</span>`
          : ff?.flag === "broken" ? `<span class="ff ff-broken" title="dislocated AND thesis weak — not forced flow, real deterioration">⚠ broken</span>` : "";
        const dr = DATA.sig?.scarcity_drift?.[s.id];
        const driftMark = dr
          ? `<span class="drift" title="since ${dr.since}">▲ drift: priced-in ${dr.priced_in[0]}→${dr.priced_in[1]}</span>`
          : "";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><strong>${esc(s.scarcity)}</strong>${axisMark}${s.non_consensus ? '<span class="nc">◆ non-consensus</span>' : ""}${alphaMark}${ffMark}${driftMark}<br><span style="color:var(--mut)">${esc(s.thesis)}</span></td>
          <td class="opp-cell">${oppCell}</td>
          <td>${esc(s.sector)}</td><td><span class="pill ${cls}">${lbl}</span></td>
          <td class="pi-${esc(s.priced_in)}">${esc(s.priced_in)}</td><td>${esc(s.durability)}</td><td>${esc(s.substitution_risk)}</td>
          <td>${crowd == null ? "—" : crowd}</td><td style="font-size:11px">${esc(s.tickers.join(", "))}</td>`;
        tb.appendChild(tr);
      });
  };
  sel.onchange = draw; $("#ncOnly").onchange = draw; draw();
}

function renderRegime() {
  const box = $("#regimeBox"); if (!box) return;
  const r = DATA.sig?.regime;
  if (!r || !r.posture || r.posture === "unknown") {
    box.className = "regime unknown";
    box.innerHTML = `<strong>Timing posture: —</strong><span>${r?.note || "awaiting first live scan"}</span>`;
    return;
  }
  const [, lbl] = POSTURE[r.posture] || POSTURE.unknown;
  box.className = `regime ${r.posture}`;
  const ap = r.account_policy;
  const apHtml = ap ? `<div class="acctpol"><span><strong>IRA/Roth:</strong> ${esc(ap.ira)}</span><span><strong>Taxable:</strong> ${esc(ap.taxable)}</span></div>` : "";
  // The F+C Thrust ladder IS the brake + re-entry — show its three signals and the resulting decision.
  const fc = r.fc_thrust;
  const decision = !fc ? "—"
    : fc.crash_off ? `<strong class="neg">brakes — CRASH_OFF</strong>`
    : fc.trend ? `<strong class="pos">risk-on — TREND</strong>`
    : fc.thrust ? `<strong class="pos">fast re-entry — THRUST→neutral</strong>`
    : `<strong class="neg">brakes — below trend</strong>`;
  const overlay = `<div class="rnote"><strong>F+C Thrust ladder:</strong> `
    + (fc
      ? `TREND ${fc.trend ? "✓" : "✗"} · CRASH_OFF ${fc.crash_off ? "ON" : "off"} · THRUST ${fc.thrust ? "✓" : "✗"} → ${decision}`
      : `awaiting composite price history`)
    + ` &nbsp;·&nbsp; Macro overlay: ${r.macro_stressed ? `<strong class="neg">STRESS — forced defensive</strong>` : (r.macro_available ? "clear" : "⚠ unavailable")}</div>`;
  box.innerHTML = `<div><strong>Timing posture: ${lbl}${r.confidence ? ` · ${esc(r.confidence)} conf` : ""}${r.version ? ` · v${esc(r.version)}` : ""} <button class="help" data-help="regime">?</button></strong>
      <span>${esc(r.action || "")}</span></div>
    ${apHtml}
    ${overlay}
    <div class="rnote">${esc(r.note || "")}<br><em>Alpha = scarcity thesis · timing = trend+momentum+vol+drawdown+macro overlay, on the ETF composite${r.composite_basis?.length ? ` (${esc(r.composite_basis.join(", "))})` : ""}. ${esc(r.basis || "")}. ${r.confidence_note ? "⚠ " + esc(r.confidence_note) + ". " : ""}Not advice.</em></div>`;
}

// QQQ (the regime's reference underlying) + TQQQ/SQQQ (3× long/short proxies) with daily technicals incl RSI —
// the signals the regime/V2.3 overlay actually read. Its OWN card (not crammed in the posture banner), with
// DYNAMIC columns: a metric column only shows when ≥1 instrument has it (so e.g. 12m momentum, which a 1-year
// fetch can't compute, isn't a broken all-"—" column). Mobile-scrollable.
function renderRegimeInstruments() {
  const box = $("#regimeInstruments"); if (!box) return;
  const RI = DATA.sig?.regime_instruments || {};
  const rows = [["QQQ", "reference"], ["TQQQ", "3× long"], ["SQQQ", "3× short"]]
    .filter(([t]) => RI[t] && !RI[t].error).map(([t, desc]) => ({ t, desc, q: RI[t] }));
  if (!rows.length) { box.innerHTML = ""; return; }
  const pct = (x) => (x == null ? null : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`);
  const cols = [
    { h: "Price", get: (q) => (q.price != null ? "$" + q.price.toFixed(2) : null) },
    { h: "RSI", get: (q) => q.rsi_14, cls: (q) => (q.rsi_14 >= 70 ? "neg" : q.rsi_14 <= 30 ? "pos" : "") },
    { h: "vs&nbsp;200d", get: (q) => pct(q.pct_vs_ma200), cls: (q) => (q.above_ma200 ? "pos" : "neg") },
    { h: "off&nbsp;high", get: (q) => pct(q.pct_off_high) },
    { h: "12m", get: (q) => pct(q.mom_12m) },
    { h: "1m", get: (q) => pct(q.mom_1m) },
    { h: "vol", get: (q) => (q.vol_1y != null ? Math.round(q.vol_1y * 100) + "%" : null) },
  ].filter((c) => rows.some((r) => c.get(r.q) != null)); // drop all-empty columns (e.g. 12m on a 1y fetch)
  const thead = `<tr><th>Instrument</th>${cols.map((c) => `<th>${c.h}</th>`).join("")}</tr>`;
  const tbody = rows.map(({ t, desc, q }) => `<tr><td><strong>${t}</strong> <span class="foot">${desc}</span></td>${
    cols.map((c) => { const v = c.get(q); const cl = v == null ? "foot" : (c.cls ? c.cls(q) : ""); return `<td class="${cl}">${v == null ? "—" : v}</td>`; }).join("")}</tr>`).join("");
  const shallow = rows.filter((r) => r.q.technicals_src === "live-1y").map((r) => r.t);
  box.innerHTML = `<h3>Regime instruments <button class="help" data-help="regime">?</button> <span class="foot">— QQQ + TQQQ/SQQQ, the signals the timing layer reads (daily)</span></h3>
    <div class="tscroll"><table class="mine"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>
    <p class="foot">QQQ = reference underlying; <strong>TQQQ/SQQQ are 3× proxies — tactical, leverage decays, not buy-and-hold</strong>. RSI&nbsp;&gt;70 overbought · &lt;30 oversold.${shallow.length ? ` <em>${esc(shallow.join("/"))}: 1-yr fetch only (12m pending a deep-history backfill).</em>` : ""}</p>`;
}

function renderDca() {
  const box = $("#dcaProgress"); if (!box) return;
  const pos = getPositions().positions || {};
  const prog = (typeof window.dcaProgress === "function") ? window.dcaProgress(DATA.dca, pos) : [];
  if (!prog.length || prog.every((p) => p.deployed === 0)) { box.innerHTML = ""; return; }
  const totT = prog.reduce((a, b) => a + b.target, 0), totD = prog.reduce((a, b) => a + b.deployed, 0);
  const rows = prog.map((p) => `<tr><td><strong>${p.ticker}</strong></td><td>${p.tier}</td><td>${fmtUsd(p.target)}</td><td>${fmtUsd(p.deployed)}</td>
    <td><div class="bar"><span style="width:${p.pct}%"></span></div> ${p.pct}%</td></tr>`).join("");
  box.innerHTML = `<h3>DCA progress <button class="help" data-help="dca">?</button> <span class="foot">— deployed (shares × cost basis) vs target, per the 9-month calendar</span></h3>
    <div class="cards"><div class="card"><b>${totT ? Math.round(totD / totT * 100) : 0}%</b><span>${fmtUsd(totD)} of ${fmtUsd(totT)} deployed</span></div></div>
    <table class="mine"><thead><tr><th>Ticker</th><th>Tier</th><th>Target</th><th>Deployed</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMetrics() {
  const box = $("#objMetrics"); if (!box) return;
  const m = DATA.sig?.metrics;
  const sc = DATA.sig?.scorecard;
  if (!m && !(sc && (sc.total?.n >= 0))) { box.innerHTML = ""; return; }
  const pct = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
  const num = (x) => (x == null ? "—" : x.toFixed(2));
  const scLine = sc ? `<p class="foot">Track record (self-graded TSMOM tilts): ${sc.total?.n ? `hit-rate <strong>${Math.round(sc.hit_rate * 100)}%</strong> over ${sc.total.n} resolved calls (OW ${sc.by_tilt.overweight.hits}/${sc.by_tilt.overweight.n}, UW ${sc.by_tilt.underweight.hits}/${sc.by_tilt.underweight.n})` : "building — first calls resolve in ~21 days"} <button class="help" data-help="scorecard">?</button></p>` : "";
  // Kill-criterion accountability: the committee's pre-registered, dated falsifications, deadline-tracked.
  const kc = sc?.kill;
  const scKill = kc && (kc.pending || kc.matured) ? `<p class="foot">Kill-criteria (committee falsification deadlines): <strong>${kc.pending || 0}</strong> pending · ${kc.survived || 0} survived · ${kc.killed || 0} killed${kc.needs_review ? ` · <strong class="neg">${kc.needs_review} need adjudication</strong>` : ""} <button class="help" data-help="killcriteria">?</button></p>` : "";
  // Proof-of-edge: the de-rating/inflecting alpha calls graded RELATIVE to the Deep-tech build-out complex.
  const bs = sc?.by_signal, alphaN = (bs?.underperform?.n || 0) + (bs?.outperform?.n || 0);
  // G1 follow-up: the alpha edge is auto-stamped with the current factor-adjusted verdict (alpha vs beta),
  // so a good forward hit-rate can't read as skill when the factor regression says it's just beta.
  const al = sc?.alpha_label;
  const alTag = al && al.verdict !== "unproven"
    ? ` → <strong class="${al.verdict === "alpha" ? "pos" : "neg"}" title="${esc(al.note)}">factor-adjusted: ${al.verdict === "alpha" ? "alpha" : "beta — NOT alpha"}</strong>`
    : "";
  const scAlpha = bs ? `<p class="foot">Alpha edge (de-rating/inflecting, graded vs the complex): ${alphaN ? `de-rating ${bs.underperform?.hits || 0}/${bs.underperform?.n || 0}, inflecting ${bs.outperform?.hits || 0}/${bs.outperform?.n || 0} correct over ${alphaN} resolved relative calls` : "building — first relative calls resolve in ~42 days"}${alTag} <button class="help" data-help="alpha">?</button></p>` : "";
  // G1 honesty gate: factor attribution — is the basket's return alpha or just market+momentum+theme beta?
  const at = DATA.sig?.attribution;
  const scAttr = at ? `<p class="foot">Factor attribution (vs market + momentum + QQQ-theme, ${at.n}d): residual alpha <strong>${(at.alpha_annual * 100).toFixed(1)}%/yr</strong> (t=${at.alpha_t}, R²=${at.r2}) → <strong class="${at.verdict === "alpha" ? "pos" : "neg"}">${at.verdict === "alpha" ? "genuine alpha" : "factor/beta — NOT alpha"}</strong>${at.benchmark_qqq ? ` · vs QQQ ${at.benchmark_qqq.excess >= 0 ? "+" : ""}${(at.benchmark_qqq.excess * 100).toFixed(0)}%` : ""} <button class="help" data-help="attribution">?</button></p>` : "";
  // G6: historical cross-sectional backtest of the relative-strength signal (upper bound — survivorship).
  const sb = DATA.sig?.signal_backtest;
  const scBt = sb ? `<p class="foot">Signal backtest (history, ${sb.n} obs): rank IC <strong>${sb.ic}</strong>, hit-rate <strong>${Math.round((sb.hit_rate || 0) * 100)}%</strong>${sb.hit_rate_ci95 ? ` (95% CI ${Math.round(sb.hit_rate_ci95[0] * 100)}–${Math.round(sb.hit_rate_ci95[1] * 100)}%)` : ""} — <em>upper bound (survivorship)</em> <button class="help" data-help="sigbacktest">?</button></p>` : "";
  // F+C THRUST BACKTEST — the EXACT live timing design (Faber trend + Daniel-Moskowitz crash + rising-20-DMA
  // thrust re-entry; the same v23.mjs rule the regime runs) on deep benchmark history vs buy-&-hold. Per
  // instrument: did it cut maxDD (✓/✗), hold the −35% mandate, improve Calmar, and which crashes it cut.
  const fcp = m && Array.isArray(m.fc_thrust_proof) ? m.fc_thrust_proof : null;
  const mand = (v) => v ? `<span class="neg">✗ breaches −35%</span>` : `<span class="pos">✓ holds −35%</span>`;
  const scFc = fcp && fcp.length ? `<p class="foot"><strong>F+C Thrust backtest (the live design)</strong> — the exact Faber + Crash + Thrust ladder (the same rule the regime runs), on deep benchmark history vs buy-&amp;-hold, no look-ahead, turnover-costed: ${fcp.map((p) => {
    const eps = (p.episodes || []).map((e) => `${String(e.from || "").slice(0, 4)} −${(e.buyhold_dd * 100).toFixed(0)}%→−${(e.fc_dd * 100).toFixed(0)}%${e.helped ? "" : "⚠"}`).join(", ");
    return `<br>• <strong>${esc(p.proxy)}</strong> (${p.years}y${p.src ? `, ${esc(p.src)}` : ""}): maxDD −${(p.buyhold.max_drawdown * 100).toFixed(0)}%→−${(p.fc_thrust.max_drawdown * 100).toFixed(0)}% ${p.reduces_tail ? "✓" : "✗"} ${mand(p.breach_35?.fc_thrust)}, Calmar ${num(p.buyhold.calmar)}→${num(p.fc_thrust.calmar)} ${p.improves_calmar ? "✓" : "✗"}, CAGR cost ${(p.cagr_cost * 100).toFixed(1)}pts${eps ? ` — crashes: ${eps}` : ""}`;
  }).join("")}<br><span class="foot">⚠ = the ladder didn't cut that crash. Methodology evidence on deep proxies, not a forecast of your book. See <code>docs/DRAWDOWN-DEFENSE.md</code>.</span></p>` : "";
  if (!m) { box.innerHTML = `<h3>Track record <button class="help" data-help="scorecard">?</button></h3>${scLine}${scKill}${scAlpha}${scAttr}${scBt}`; return; }
  box.innerHTML = `<h3>Objective scorecard <button class="help" data-help="metrics">?</button> <span class="foot">— ${esc(m.note || "")} ${esc(m.window || "")}</span></h3>
    <div class="cards">
      <div class="card"><b>${pct(m.cagr)}</b><span>CAGR (trailing)</span></div>
      <div class="card ${m.breaches_35 ? "dq-bad" : ""}"><b>${pct(m.max_drawdown)}</b><span>max drawdown ${m.breaches_35 ? "⚠ &gt;35%" : "✓ &lt;35%"}</span></div>
      <div class="card"><b>${num(m.calmar)}</b><span>Calmar (CAGR÷maxDD)</span></div>
      <div class="card"><b>${num(m.sortino)}</b><span>Sortino</span></div>
    </div>${scFc}${scLine}${scKill}${scAlpha}${scAttr}${scBt}`;
}

// (Removed: "Suggested IRA tilts" — its per-name TSMOM × regime tilt is already applied to the IRA sleeve
// in the Rebalance plan's SIGNAL column, so a standalone table just duplicated it. One "what to change" view.)

// (The standalone "Rebalance plan" table was removed — the single Tax-located buy plan below IS the
// buy/rebalance view. The scan still emits signals.json.rebalance for the record; the UI no longer renders it.)

// ---------- Asset location (Roth / Traditional / taxable) → maximize after-tax terminal value ----------
const ALOC_KEY = "puck.assetloc";
const ALOC_DEFAULTS = { ordinary: 35, qualified: 15, ltcg: 15, horizon: 20, roth: 0, traditional: 0, taxable: 0, exclude: "" };
function getAloc() { try { return { ...ALOC_DEFAULTS, ...JSON.parse(localStorage.getItem(ALOC_KEY) || "{}") }; } catch { return { ...ALOC_DEFAULTS }; } }

function renderAssetLocation() {
  const box = $("#assetLocation"); if (!box) return;
  const L = window.PuckLocation, DV = window.PuckDiversifier, p = DATA.port || {};
  const cfg = getAloc();
  const excl = new Set(String(cfg.exclude || "").toUpperCase().split(/[\s,]+/).filter(Boolean));
  const head = `<h3>Tax-located buy plan <button class="help" data-help="location">?</button> <span class="foot">— deploy your cash into the committee's plan, each name in its best account</span></h3>`;
  // Inputs render unconditionally so the section is ALWAYS visible (never hidden by hideEmptyGroups).
  const inputs = `<div class="controls aloc-inputs">
    <label>Roth $ <input data-aloc="roth" type="number" step="any" value="${cfg.roth || ""}" placeholder="0" /></label>
    <label>Traditional $ <input data-aloc="traditional" type="number" step="any" value="${cfg.traditional || ""}" placeholder="0" /></label>
    <label>Taxable $ <input data-aloc="taxable" type="number" step="any" value="${cfg.taxable || ""}" placeholder="0" /></label>
    <label>Marginal % <input data-aloc="ordinary" type="number" step="any" value="${cfg.ordinary}" /></label>
    <label>Horizon yr <input data-aloc="horizon" type="number" step="1" value="${cfg.horizon}" /></label>
    <label>Exclude (own elsewhere) <input data-aloc="exclude" type="text" value="${esc(cfg.exclude || "")}" placeholder="e.g. SMH" /></label>
  </div>`;
  const wire = () => box.querySelectorAll("[data-aloc]").forEach((inp) => inp.onchange = () => { const c = getAloc(); c[inp.dataset.aloc] = inp.type === "text" ? inp.value.trim() : (parseFloat(inp.value) || 0); localStorage.setItem(ALOC_KEY, JSON.stringify(c)); renderAssetLocation(); });
  const deployTotal = (cfg.roth || 0) + (cfg.traditional || 0) + (cfg.taxable || 0);
  if (!L || !p.holdings?.length || !deployTotal) {
    // If the planner module didn't load (L missing) but inputs/holdings ARE present, it's not "still loading"
    // — it's a failed/stale module load (e.g. a cached asset-location.mjs). Self-heal once, then tell the user
    // how to recover instead of freezing forever on "Loading…".
    const moduleFailed = !L && p.holdings?.length && deployTotal;
    if (moduleFailed && !renderAssetLocation._retried) { renderAssetLocation._retried = true; setTimeout(renderAssetLocation, 1500); }
    const msg = !p.holdings?.length ? "Add the plan holdings to see the buy plan."
      : !deployTotal ? "Enter your <strong>Roth / Traditional / Taxable</strong> balances above to see the tax-located buy plan."
      : moduleFailed ? "Couldn’t load the planner module — <strong>pull to refresh</strong> (or clear this site’s cached data). It self-heals on a fresh load."
      : "Loading…";
    box.innerHTML = head + inputs + `<p class="foot">${msg}</p>`;
    wire(); return;
  }
  renderAssetLocation._retried = false;
  // Combined target = the build-out plan + the diversifier funding proposal (if any); drop names you hold
  // ELSEWHERE, then renormalize so the cash deploys across what's left. WIRING: once you MERGE the
  // diversifier PR, those names are already in portfolio.json — re-applying would double-count (scale the
  // build-out twice), so apply the proposal only while it's still PENDING (names not yet in the plan).
  const funding = DATA.diversifier?.funding;
  const alreadyFunded = funding?.newHoldings?.length && funding.newHoldings.some((h) => (p.holdings || []).some((ph) => ph.ticker === h.ticker));
  const combined = (funding && DV && !alreadyFunded) ? DV.applyDiversifierFunding(p, funding) : p;
  // COMMITTEE-AWARE [D1]: drive the BUILD-OUT names by the scan's signal-adjusted weights (a committee
  // 'crowded' downgrade → smaller signals.json.rebalance.signal target → smaller buy here), scaled to the
  // build-out budget; diversifiers keep their funding weights. Signal weights are normalized per
  // account×axis cell, so we use each row's DOLLAR share of the whole signal plan (not the cell %).
  const sigRows = DATA.sig?.rebalance?.signal?.rows || [];
  const sigTot = sigRows.reduce((a, r) => a + (r.target_usd || 0), 0);
  // targetWeights emits one row per (ticker × account), so a name split across accounts has >1 signal row —
  // SUM them (not assign, which kept only the last row and understated a split name's committee weight).
  const sigShare = {}; if (sigTot > 0) for (const r of sigRows) sigShare[r.ticker] = (sigShare[r.ticker] || 0) + (r.target_usd || 0) / sigTot;
  const isDivH = (h) => h.axis === "diversifier" || /diversifier|de-correlator/i.test(h.role || "");
  const all = (combined.holdings || []).filter((h) => h.ticker && h.weight > 0 && h.tier !== "DRY" && !/^CASH/i.test(h.ticker) && !excl.has(h.ticker));
  const divH = all.filter(isDivH), bldH = all.filter((h) => !isDivH(h));
  const bldBudget = Math.max(0, 1 - divH.reduce((a, h) => a + (h.weight || 0), 0)); // keep the 85/15 split
  const bldRel = bldH.map((h) => ({ h, w: (sigShare[h.ticker] ?? h.weight) || 0 }));
  const bldRelSum = bldRel.reduce((a, x) => a + x.w, 0) || 1;
  const kept = [...bldRel.map((x) => ({ ...x.h, weight: bldBudget * x.w / bldRelSum })), ...divH];

  // POSITION-AWARE rebalance: net the (committee-adjusted) target against what you ALREADY hold, per account.
  // The Roth/Traditional/Taxable inputs are your TOTAL account balances; rebalanceLocated targets weight ×
  // (sum of balances), so it deploys the whole book. All-cash (no held lots) → pure deploy (all buys); once
  // you hold, it nets BUYS + tax-aware SELLS/trims (taxable lots are buy-and-hold unless the scan's trim bar
  // is met). Buys are placed OPTIMALLY for after-tax terminal value (the transportation optimizer).
  const heldByAcct = {}; const positions = getPositions().positions || {};
  for (const [t, h] of Object.entries(positions)) {
    if (excl.has(t) || /^CASH/i.test(t)) continue;
    const Q = q(t); const price = Q && !Q.error ? Q.price : null; const mv = price && h.shares ? price * h.shares : 0;
    if (!mv || (Q?.currency && Q.currency !== "USD")) continue; // browser has no FX → skip foreign lots (server sizes them)
    const acct = h.account === "taxable" ? "taxable" : h.account === "roth" ? "roth" : "traditional"; // legacy "ira" → traditional
    (heldByAcct[t] = heldByAcct[t] || {})[acct] = (heldByAcct[t][acct] || 0) + mv;
  }
  const res = L.rebalanceLocated(kept, {
    held: heldByAcct,
    capacities: { roth: cfg.roth, traditional: cfg.traditional, taxable: cfg.taxable },
    tax: { ordinary: cfg.ordinary / 100, qualified: cfg.qualified / 100, ltcg: cfg.ltcg / 100 },
    horizonYears: cfg.horizon,
    taxableAnchorTrimOk: DATA.sig?.rebalance?.taxable_trim_ok || [],
    quotes: DATA.sig?.quotes || {}, // per-name dividend_yield/growth override the axis defaults where present
  });
  const hasHeld = Object.keys(heldByAcct).length > 0;
  // Sleeve tag per name (Deep-tech build-out = green · ◇ Diversifier = purple), matching the overview diagram
  // colors, so each row makes its sleeve obvious at a glance. Classify from the combined plan; dropped names
  // not in the plan fall back to the live portfolio, else no tag.
  const sleeveOf = {};
  for (const h of (combined.holdings || [])) sleeveOf[h.ticker] = isDivH(h) ? "div" : "bld";
  for (const h of (p.holdings || [])) if (!(h.ticker in sleeveOf)) sleeveOf[h.ticker] = isDivH(h) ? "div" : "bld";
  const sleevePill = (t) => sleeveOf[t] === "div" ? `<span class="spill div" title="Diversifier sleeve — drawdown hedge (2nd axis)">◇ Diversifier</span>`
    : sleeveOf[t] === "bld" ? `<span class="spill bld" title="Deep-tech build-out sleeve — the alpha engine">Build-out</span>` : "";
  // PER-NAME ENTRY QUALITY — is now a good time to buy THIS name? (the composite "ACT NOW" doesn't say). We
  // blend dislocation/trend/momentum + corroborated valuation (from the scan) → good/fair/stretched, and
  // STAGE the buy: a good entry deploys now, a stretched one mostly DCAs (so a lump-sum doesn't buy the top).
  const E = window.PuckEntry;
  const entryCache = {};
  const entryFor = (t) => { if (!E) return null; if (!(t in entryCache)) { const Q = q(t) || {}; entryCache[t] = E.entryQuality({ pctOffHigh: Q.pct_off_high, aboveMa200: Q.above_ma200, mom12m: Q.mom_12m, mom1m: Q.mom_1m, relStrength: Q.rel_strength ?? null, valuation: Q.valuation?.tag ? { tag: Q.valuation.tag, label: Q.valuation.label } : null }); } return entryCache[t]; };
  const entryPill = (e) => (e && e.label !== "n/a") ? `<span class="epill ${e.label}" title="${esc((e.reasons || []).join(" · "))} — entry score ${e.score}/100">${e.label === "good" ? "good entry" : e.label}</span>` : "";
  const stageOf = (t, amt) => (E ? E.stageBuy(entryFor(t)?.label || "good", amt) : { now: amt, dca: 0 });
  let deployNow = 0, dcaLater = 0;
  for (const r of res.rows) if (r.action === "buy") { const st = stageOf(r.ticker, r.amount); deployNow += st.now; dcaLater += st.dca; }
  const legend = `<p class="foot spill-legend"><span class="spill bld">Build-out</span> alpha engine (~85%) · <span class="spill div">◇ Diversifier</span> drawdown hedge (~15%) · <span class="epill good">good entry</span><span class="epill fair">fair</span><span class="epill stretched">stretched</span> = per-name timing (stretched names are staged/DCA'd)</p>`;
  // Group BUY + SELL/trim by account. Buys show the tax shelter; sells/trims show why (or why blocked).
  const ACT_RANK = { buy: 0, trim: 1, "sell (not in plan)": 1 };
  const tbody = [["roth", "Roth", cfg.roth], ["traditional", "Traditional", cfg.traditional], ["taxable", "Taxable", cfg.taxable]].filter(([, , b]) => b > 0).map(([key, label, bal]) => {
    const rs = res.rows.filter((r) => r.account === key).sort((a, b) => (ACT_RANK[a.action] ?? 2) - (ACT_RANK[b.action] ?? 2) || b.amount - a.amount);
    const buy = rs.filter((r) => r.action === "buy").reduce((a, r) => a + r.amount, 0);
    const sell = rs.filter((r) => !r.blocked && r.action !== "buy").reduce((a, r) => a + r.amount, 0);
    return `<tr class="hgroup"><td colspan="4">${esc(label)} — buy ${fmtUsd(buy)}${sell ? ` · sell ${fmtUsd(sell)}` : ""} of ${fmtUsd(bal)}</td></tr>` +
      (rs.length ? rs.map((r) => {
        const isBuy = r.action === "buy";
        const e = isBuy ? entryFor(r.ticker) : null;
        const st = isBuy ? stageOf(r.ticker, r.amount) : null;
        const tag = isBuy ? entryPill(e) : ` <span class="${r.blocked ? "foot" : "neg"}">${esc(r.action)}</span>`;
        const amtCell = isBuy
          ? (st && st.dca > 0 ? `${fmtUsd(st.now)} <span class="foot">now · DCA ${fmtUsd(st.dca)}</span>` : fmtUsd(r.amount))
          : `−${fmtUsd(r.amount)}`;
        const note = isBuy ? (r.annual_drag_avoided ? "shelters $" + r.annual_drag_avoided.toLocaleString() + "/yr" : "—") : (r.blocked ? "held (no trim)" : "frees cash");
        return `<tr class="sleeve-${sleeveOf[r.ticker] || "na"}"><td><strong>${esc(r.ticker)}</strong> ${sleevePill(r.ticker)}${isBuy ? " " + tag : tag}</td><td class="${isBuy ? "pos" : "neg"}">${amtCell}</td><td>${r.yieldPct ? (r.yieldPct * 100).toFixed(1) + "%" : "—"}</td><td class="foot">${note}</td></tr>`;
      }).join("") : `<tr><td colspan="4" class="foot">— nothing assigned here —</td></tr>`);
  }).join("");
  const sm = res.summary;
  // Make the TIMING overlay visible right on the plan (it is baked into the signal weights via
  // web/sizing.mjs regimeFactor, but was previously only surfaced in the separate posture panel).
  const reg = DATA.sig?.regime;
  const brakesOn = reg && (reg.posture === "defensive" || reg.macro_stressed);
  const regimeBanner = reg && reg.posture && reg.posture !== "unknown" ? `<p class="foot">Timing overlay on this plan (F+C Thrust): posture <strong>${esc(reg.posture)}</strong> → <strong class="${brakesOn ? "neg" : "pos"}">${brakesOn ? "brakes on — deploy into the drawdown trigger, not now" : "clear — deploy on schedule"}</strong>${reg.fast_reentry ? ` · <span class="pos">⚡ THRUST fast re-entry (rising 20-DMA reclaimed below trend)</span>` : ""}. Buy weights below are <strong>regime-tilted</strong> (IRA sleeve): overweights only accelerate when the composite is in TREND (risk-on), trims bite in any posture; taxable stays buy-and-hold. <button class="help" data-help="regime">?</button></p>` : "";
  box.innerHTML = head + regimeBanner + inputs + `
    <p class="foot">${hasHeld ? "Rebalancing your book toward" : "Deploying <strong>" + fmtUsd(deployTotal) + "</strong> cash into"} the plan${sigTot > 0 ? ", <strong>committee- and regime-adjusted</strong> (a crowded downgrade or a braked posture shrinks the buy)" : ""}, tax-located (Roth ← highest after-tax growth · Traditional ← income · taxable ← tax-efficient)${excl.size ? ` · <strong>excluding ${esc([...excl].join(", "))}</strong> (held elsewhere)` : ""}. Buy <strong>${fmtUsd(sm.buy_usd)}</strong>${dcaLater > 0 ? ` (<strong>${fmtUsd(deployNow)}</strong> now · <strong>${fmtUsd(dcaLater)}</strong> DCA'd — stretched entries staged)` : ""}${sm.sell_usd ? ` · sell <strong>${fmtUsd(sm.sell_usd)}</strong>` : ""}${sm.blocked_usd ? ` · <span class="foot">${fmtUsd(sm.blocked_usd)} held (taxable anchor — trim bar not met)</span>` : ""}${sm.needs_new_cash_usd ? ` · <span class="neg">needs ${fmtUsd(sm.needs_new_cash_usd)} more cash</span>` : ""} · shelters <strong>$${(sm.annual_drag_avoided || 0).toLocaleString()}/yr</strong> of tax drag.</p>
    ${legend}
    <div class="tscroll"><table class="mine"><thead><tr><th>Trade</th><th>Amount</th><th>Yield</th><th>Tax shelter / note</th></tr></thead><tbody>${tbody}</tbody></table></div>
    <p class="foot">${hasHeld ? "Position-aware: net buys + tax-aware sells vs your held lots (taxable lots are buy-and-hold unless the scan's trim bar is met). " : "All-cash deploy — once you add holdings in Settings, this nets sells too. "}Advisory — not tax advice; doesn't model exact bracket arbitrage, RMDs, or estate plan.</p>`;
  wire();
}

function renderStress() {
  const box = $("#stressTest"); if (!box) return;
  const S = window.PuckStress; const pos = getPositions().positions || {};
  if (!S || !Object.keys(pos).length) { box.innerHTML = ""; return; }
  const btns = S.SCENARIOS.map((sc) => `<button class="stress-btn" data-sc="${sc.id}">${esc(sc.name)}</button>`).join(" ");
  box.innerHTML = `<h3>Stress test <button class="help" data-help="stress">?</button> <span class="foot">— shock your sleeve; objective limit is −35% max drawdown</span></h3>
    <div class="modal-actions">${btns}</div><div class="stress-result"></div>`;
  const out = box.querySelector(".stress-result");
  $$("#stressTest .stress-btn").forEach((b) => b.onclick = () => {
    const sc = S.SCENARIOS.find((x) => x.id === b.dataset.sc);
    const r = S.applyShock(pos, DATA.sig?.quotes || {}, sc);
    const rows = r.per_name.map((p) => `<tr><td>${esc(p.ticker)}</td><td>${fmtUsd(p.before)}</td><td>${fmtUsd(p.after)}</td><td class="neg">${(p.change * 100).toFixed(0)}%</td></tr>`).join("");
    out.innerHTML = `<div class="optcard"><p><strong>${esc(r.scenario)}</strong>: sleeve ${fmtUsd(r.before)} → ${fmtUsd(r.after)} = <span class="${r.breaches_35 ? "neg" : "pos"}">${(r.drawdown * 100).toFixed(0)}% drawdown ${r.breaches_35 ? "⚠ breaches −35%" : "✓ within −35%"}</span></p>${sc.note ? `<p class="foot">${esc(sc.note)}</p>` : ""}
      <table class="kv"><thead><tr><th>Ticker</th><th>Before</th><th>After</th><th>Δ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  });
}

function renderPortfolio() {
  renderRegime();
  renderRegimeInstruments();
  renderMetrics();
  renderMyHoldings();
  renderDca();
  renderStress();
  renderAssetLocation();
  const p = DATA.port || {};
  const isDiv = (h) => h.axis === "diversifier" || /diversifier|de-correlator/i.test(h.role || ""); // axis tag or role
  const divW = (p.holdings || []).filter(isDiv).reduce((a, h) => a + (h.weight || 0), 0);
  $("#portSummary").innerHTML = (p.holdings && p.accounts) ? `
    <div class="card"><b>${Math.round((1 - divW) * 100)}% / ${Math.round(divW * 100)}%</b><span>build-out / ◇ diversifier sleeve</span></div>
    <div class="card"><b>${fmtUsd(p.sleeve_usd)}</b><span>sleeve (~${Math.round(p.sleeve_usd / p.total_portfolio_usd * 100)}% of ${fmtUsd(p.total_portfolio_usd)})</span></div>
    <div class="card"><b>${fmtUsd(p.accounts.ira)}</b><span>IRA / 401k</span></div>
    <div class="card"><b>${fmtUsd(p.accounts.taxable)}</b><span>taxable</span></div>
    <div class="card"><b>${p.holdings.filter(h=>h.tier!=='DRY').length}</b><span>holdings + dry powder</span></div>
    ${DATA.sig?.data_quality ? `<div class="card ${DATA.sig.data_quality.ok?'':'dq-bad'}"><b>${DATA.sig.data_quality.ok?'✓ OK':'⚠ degraded'} <button class="help" data-help="dataquality">?</button></b><span>data quality · ${DATA.sig.data_quality.note}</span></div>` : ""}` : "";

  const tg = $("#triggers"); tg.innerHTML = "";
  // Catalyst watch (F11): manual triggers are now auto-watched from news/filings by the committee. The card
  // shows the live status (monitoring → approaching → likely-met → fired), confidence, the LLM-drafted advisory
  // action, and its evidence. Auto triggers keep their numeric live status. Advisory only — you act.
  const CW_STATE = { fired: "fired", "likely-met": "armed", approaching: "monitor", monitoring: "monitor" };
  (DATA.trig?.triggers || []).forEach((t) => {
    const live = DATA.sig?.trigger_status?.[t.id];
    const cw = DATA.sig?.catalyst_watch?.[t.id];
    let state = t.status; if (live?.fired) state = "fired"; else if (cw) state = CW_STATE[cw.status] || state;
    const showVal = live?.value != null && Math.abs(live.value) < 1000;
    const badge = cw ? `${esc(cw.status)}${cw.confidence ? ` · ${Math.round(cw.confidence * 100)}%` : ""}` : `${esc(state)}${showVal ? ` · ${esc(live.value)}` : ""}`;
    // Catalyst detail: the drafted action + evidence (only once it's elevated above plain monitoring).
    const C = window.PuckCatalyst;
    let ed = (cw?.status === "fired" && C) ? C.catalystEditable(t) : null; // offer a draft PR only on a confirmed fire
    // …and only while the affected names are still in the plan — once a cut/trim PR is merged they're gone, so
    // don't keep offering a no-op/duplicate PR (idempotency, H3).
    if (ed && !ed.affects.some((a) => (DATA.port?.holdings || []).some((h) => h.ticker === a && (h.weight || 0) > 0))) ed = null;
    let extra = "";
    if (cw && cw.status !== "monitoring") {
      const ev = [...(cw.evidence?.filings || []).map((f) => `📄 ${f.title}`), ...(cw.evidence?.headlines || []).map((h) => `📰 ${h.title}`)].slice(0, 3);
      extra = `${cw.suggested_action ? `<br><span class="cw-action">⇒ ${esc(cw.suggested_action)}</span>` : ""}` +
        `${cw.citations?.length ? ` <span class="foot">(${cw.citations.length} source${cw.citations.length > 1 ? "s" : ""})</span>` : ""}` +
        `${ev.length ? `<br><span class="foot">${ev.map((e) => esc(e)).join(" · ")}</span>` : ""}` +
        `${ed ? `<br><button class="sm" data-catalyst-pr="${esc(t.id)}">Draft PR — ${esc(ed.edit)} ${esc(ed.affects.join("/"))}</button>` : ""}`;
    } else if (cw) {
      extra = ` <span class="foot">· auto-watched (${cw.evidence?.headlines?.length || 0} headlines scanned)</span>`;
    }
    const d = document.createElement("div"); d.className = `trig ${state}`;
    d.innerHTML = `<span class="badge">${badge}</span><strong>${esc(t.name)}</strong><br>
      <span style="color:var(--mut)">${esc(t.type)} · ${esc(t.action)}${live?.note ? ` <em>(${esc(live.note)})</em>` : ""}</span>${extra}`;
    tg.appendChild(d);
  });
  tg.querySelectorAll("[data-catalyst-pr]").forEach((b) => b.onclick = () => draftCatalystPR(b.dataset.catalystPr));

  hideEmptyGroups();
}

// A grouped Portfolio block whose render targets are all empty (e.g. regime "unknown" offline, no holdings)
// would otherwise show a bald heading + subtitle over nothing. Hide any group with no rendered body.
function hideEmptyGroups() {
  document.querySelectorAll("#portfolio .group").forEach((g) => {
    const body = [...g.children].filter((c) => !c.classList.contains("group-h") && !c.classList.contains("group-sub"));
    const hasContent = body.some((c) => c.textContent.trim().length > 0 || c.querySelector("table tbody tr, .card, canvas, svg, img"));
    g.style.display = hasContent ? "" : "none";
  });
}

// Map a scarcity id -> human label, for the news grouping.
function scarcityLabel(id) {
  const s = DATA.scar?.scarcities?.find((x) => x.id === id);
  return s ? s.scarcity : id;
}

function renderCatalysts() {
  const filings = DATA.sig?.filings || [];
  const tb = $("#filings tbody"); tb.innerHTML = "";
  filings.forEach((f) => {
    const tr = document.createElement("tr");
    const topic = (f.items && f.items.length) ? esc(f.items.join(", ")) : "—";
    const nb = f.is_new ? '<span class="newbadge">NEW</span> ' : "";
    tr.innerHTML = `<td style="white-space:nowrap">${nb}${esc(f.date || "—")}</td><td><strong>${esc(f.ticker)}</strong></td>
      <td><span class="pill y30">${esc(f.form)}</span></td><td>${topic}</td>
      <td>${f.url ? `<a href="${safeUrl(f.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}</td>`;
    tb.appendChild(tr);
  });
  $("#filingsEmpty").textContent = filings.length ? "" :
    "No recent filings in the window (or the scanner hasn't fetched EDGAR yet — runs in GitHub Actions with open network).";

  const news = DATA.sig?.news || [];
  const wrap = $("#news"); wrap.innerHTML = "";
  const byScar = {};
  news.forEach((n) => { (byScar[n.scarcity] ||= []).push(n); });
  Object.entries(byScar).forEach(([id, items]) => {
    const d = document.createElement("div"); d.className = "item";
    d.innerHTML = `<strong>${esc(scarcityLabel(id))}</strong><br>` + items.map((n) =>
      `${n.is_new ? '<span class="newbadge">NEW</span> ' : ""}<span style="color:var(--mut)">${esc(n.date || "")}</span> <a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>`
    ).join("<br>");
    wrap.appendChild(d);
  });
  $("#newsEmpty").textContent = news.length ? "" :
    "No headlines yet (the scanner pulls Google-News RSS in GitHub Actions).";
}

function renderDigest() {
  const d = DATA.sig?.digest;
  const unset = !d || /^\(no LLM key|^\(no digest/i.test(d);
  $("#digestBox").textContent = unset
    ? "No digest yet.\n\nThe Agent digest is an optional analyst + red-team read of what changed this scan for the deep-tech build-out sleeve.\nTurn it on either way:\n  • In your browser — ⚙ Settings → add an LLM key (free Gemini, or a paid key) → click “✦ Digest in browser”.\n  • Automated — add an LLM key as a GitHub repo secret (GEMINI/GROQ/OPENROUTER, or ANTHROPIC/OPENAI); the daily scan then writes it here.\nWith two keys it runs cross-model (analyst on one model, red-team rebuts on another)."
    : d;
  if (DATA.sig?.errors?.length) $("#digestBox").textContent += `\n\n--- scan errors ---\n${DATA.sig.errors.join("\n")}`;
}

$$(".tabs button").forEach((b) => b.onclick = () => {
  $$(".tabs button").forEach((x) => x.classList.remove("active"));
  $$(".tab").forEach((x) => x.classList.remove("active"));
  b.classList.add("active"); $("#" + b.dataset.tab).classList.add("active");
});
// Refresh: trigger the 'scan' GitHub Action via repository_dispatch. Needs a
// fine-grained PAT (Contents: Read & write on REPO). The token is NEVER hardcoded
// — it's stored only in this browser's localStorage and sent straight to GitHub.
// See SETUP.md → "Wire up the Refresh button". Fallback is the manual Actions run.
async function triggerScan() {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = prompt(
      `Trigger a live scan via GitHub Actions.\n\n` +
      `Paste a fine-grained Personal Access Token scoped to ${REPO} with "Contents: Read and write". ` +
      `It is stored ONLY in this browser (localStorage) and sent directly to GitHub — never committed.\n\n` +
      `Cancel to run it manually instead (repo → Actions → "scan" → Run workflow).`
    );
    if (!token) return;
    token = token.trim();
    localStorage.setItem(TOKEN_KEY, token);
  }
  const btn = $("#refresh"), label = "⟳ Refresh";
  btn.disabled = true; btn.textContent = "⟳ Dispatching…";
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ event_type: "scan" }),
    });
    if (r.status === 204) {
      const before = DATA.sig?.scanned_at || null;
      btn.textContent = "⏳ Scanning…";
      showBanner("⏳ Scan running on GitHub Actions — this view will auto-refresh when fresh data lands (~1–3 min).");
      const fresh = await pollForFresh(before);
      if (fresh) {
        btn.textContent = "✓ Updated"; setTimeout(() => (btn.textContent = label), 4000);
      } else {
        btn.textContent = label;
        showBanner("Scan dispatched ✓ — fresh data hasn't appeared yet (the Action + Vercel redeploy can take a few minutes). It will update on its own; reload later if needed.");
      }
    } else if ([401, 403, 404].includes(r.status)) {
      localStorage.removeItem(TOKEN_KEY);
      btn.textContent = label;
      alert(`Dispatch rejected (HTTP ${r.status}). The saved token was cleared — make sure it grants "Contents: Read and write" on ${REPO}, then try Refresh again.`);
    } else {
      btn.textContent = label;
      alert(`Dispatch failed (HTTP ${r.status}).\n${await r.text()}`);
    }
  } catch (e) {
    btn.textContent = label;
    alert(`Dispatch error: ${e.message}\nManual fallback: repo → Actions → "scan" → Run workflow.`);
  } finally {
    btn.disabled = false;
  }
}

// Poll the committed signals.json until scanned_at advances, then live-reload the UI.
async function pollForFresh(before, { tries = 30, intervalMs = 8000 } = {}) {
  for (let i = 0; i < tries; i++) {
    await new Promise((res) => setTimeout(res, intervalMs));
    try {
      const sig = await fetch(`data/signals.json${bust()}`).then((r) => r.json());
      if (sig?.scanned_at && sig.scanned_at !== before) { DATA.sig = sig; render(); return true; }
    } catch { /* keep polling */ }
  }
  return false;
}

function showBanner(msg) {
  const el = $("#staleBanner"); if (!el) return;
  el.className = "banner show"; el.textContent = msg;
}

$("#refresh").onclick = triggerScan;

// ---------- Onboarding / Settings (all client-side, localStorage only) ----------
const POS_KEY = "puck_positions";   // { cash_usd, positions: { TICKER: {account, shares, cost_basis} } }
const KEYS_KEY = "puck_keys";       // { gemini, groq }
const getPositions = () => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || { positions: {} }; } catch { return { positions: {} }; } };
const setPositions = (p) => localStorage.setItem(POS_KEY, JSON.stringify(p));
const getKeys = () => { try { return JSON.parse(localStorage.getItem(KEYS_KEY)) || {}; } catch { return {}; } };
const setMsg = (m) => { const e = $("#settingsMsg"); if (e) e.textContent = m || ""; };

function openSettings() { renderHoldEditor(); loadKeyFields(); $("#settingsModal").classList.remove("hidden"); }
function closeSettings() { $("#settingsModal").classList.add("hidden"); }

function renderHoldEditor() {
  const pos = getPositions();
  const tb = $("#holdEdit tbody"); tb.innerHTML = "";
  Object.entries(pos.positions || {}).forEach(([t, h]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${esc(t)}</strong></td><td>${esc(h.account || "—")}</td><td>${h.shares != null ? esc(String(h.shares)) : "—"}</td><td>${h.cost_basis != null ? "$" + esc(String(h.cost_basis)) : "—"}</td>
      <td><button data-rm="${esc(t)}" class="danger sm">✕</button></td>`;
    tb.appendChild(tr);
  });
  $("#hCash").value = pos.cash_usd ?? "";
  $$("#holdEdit [data-rm]").forEach((b) => b.onclick = () => {
    const p = getPositions(); delete p.positions[b.dataset.rm]; setPositions(p); renderHoldEditor(); render();
  });
}

function addHolding() {
  const t = ($("#hTicker").value || "").trim().toUpperCase();
  if (!t) return setMsg("Enter a ticker.");
  const p = getPositions();
  p.positions = p.positions || {};
  p.positions[t] = {
    account: $("#hAccount").value,
    shares: parseFloat($("#hShares").value) || 0,
    cost_basis: parseFloat($("#hCost").value) || 0,
  };
  setPositions(p);
  $("#hTicker").value = $("#hShares").value = $("#hCost").value = "";
  renderHoldEditor(); render(); setMsg(`Saved ${t}.`);
}

function saveCash() { const p = getPositions(); p.cash_usd = parseFloat($("#hCash").value) || 0; setPositions(p); render(); }

function exportPositions() {
  const p = getPositions();
  // shape matches web/data/positions.local.json (scanner reads this for trim/sleeve)
  const out = { as_of: new Date().toISOString().slice(0, 10), cash_usd: p.cash_usd || 0, positions: {} };
  for (const [t, h] of Object.entries(p.positions || {})) out.positions[t] = { shares: h.shares, cost_basis: h.cost_basis };
  const blob = new Blob([JSON.stringify(out, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "positions.local.json"; a.click();
  setMsg("Exported positions.local.json — drop it in web/data/ (gitignored) to enable server-side trim/sleeve.");
}

function importPositions(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result); const p = getPositions(); p.positions = p.positions || {};
      if (typeof j.cash_usd === "number") p.cash_usd = j.cash_usd;
      for (const [t, h] of Object.entries(j.positions || {})) p.positions[t] = { account: h.account || p.positions[t]?.account || "traditional", shares: h.shares, cost_basis: h.cost_basis };
      setPositions(p); renderHoldEditor(); render(); setMsg("Imported.");
    } catch (e) { setMsg("Import failed: " + e.message); }
  };
  r.readAsText(file);
}

const ADMIN_TOKEN_KEY = "puck_admin_token";
function loadKeyFields() {
  const k = getKeys();
  $("#kGemini").value = k.gemini || ""; $("#kGroq").value = k.groq || "";
  $("#kFinnhub").value = k.finnhub || ""; $("#kTwelve").value = k.twelvedata || ""; $("#kAlpha").value = k.alphavantage || "";
  $("#kDispatch").value = localStorage.getItem(TOKEN_KEY) || "";
  $("#kAdmin").value = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
  $("#vAlertEmail").value = localStorage.getItem("puck_var_ALERT_EMAIL_TO") || "";
  $("#vSecUA").value = localStorage.getItem("puck_var_SEC_USER_AGENT") || "";
  $("#vSupabaseUrl").value = localStorage.getItem("puck_var_SUPABASE_URL") || "";
}
function saveKeys() {
  setMsg("");
  localStorage.setItem(KEYS_KEY, JSON.stringify({
    gemini: $("#kGemini").value.trim(), groq: $("#kGroq").value.trim(),
    finnhub: $("#kFinnhub").value.trim(), twelvedata: $("#kTwelve").value.trim(), alphavantage: $("#kAlpha").value.trim(),
  }));
  const tok = $("#kDispatch").value.trim();
  if (tok) localStorage.setItem(TOKEN_KEY, tok); else localStorage.removeItem(TOKEN_KEY);
  setMsg("Keys saved to this browser.");
}

// Browser-side live cross-check using the stored Finnhub key (CORS-friendly): compares
// live prices for your holdings against the committed scan, flagging divergences.
async function checkLivePrices() {
  const k = getKeys();
  if (!k.finnhub) return setMsg("Add a Finnhub key first (free at finnhub.io) — it's CORS-friendly for browser checks.");
  const pos = getPositions(); const tickers = Object.keys(pos.positions || {});
  const list = (tickers.length ? tickers : (DATA.port?.holdings || []).map((h) => h.ticker)).filter((t) => t && !/[.]/.test(t) && !/^CASH/i.test(t)).slice(0, 20);
  if (!list.length) return setMsg("Add holdings first (or they have no US ticker to check).");
  setMsg(`Checking ${list.length} tickers live via Finnhub…`);
  const rows = [];
  for (const t of list) {
    try {
      const j = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${k.finnhub}`)).json();
      const live = j?.c, scan = DATA.sig?.quotes?.[t]?.price;
      const div = live && scan ? (live / scan - 1) * 100 : null;
      rows.push(`${t}: live $${live ?? "—"} vs scan $${scan ?? "—"}${div != null ? ` (${div >= 0 ? "+" : ""}${div.toFixed(1)}%${Math.abs(div) > 3 ? " ⚠" : ""})` : ""}`);
    } catch { rows.push(`${t}: live check failed`); }
  }
  setMsg("Live vs last scan:\n" + rows.join("\n"));
}

// Your-holdings live panel (Portfolio tab), computed from localStorage + scan quotes.
function renderMyHoldings() {
  const box = $("#myHoldings"); if (!box) return;
  const pos = getPositions(); const entries = Object.entries(pos.positions || {});
  if (!entries.length) { box.innerHTML = ""; return; }
  const targets = Object.fromEntries((DATA.port?.holdings || []).map((h) => [h.ticker, h.target_usd]));
  const cap = DATA.trig?.triggers?.find((t) => t.id === "sleeve_cap")?.threshold || 1720000;
  // Rebalance flags: actual vs target weight, ±25% band (shared web/rebalance.mjs).
  const posForRebal = Object.fromEntries(entries.map(([t, h]) => [t, { shares: h.shares, price: DATA.sig?.quotes?.[t]?.error ? null : DATA.sig?.quotes?.[t]?.price }]));
  const rebal = (typeof window.rebalanceFlags === "function" ? window.rebalanceFlags(posForRebal, targets, 0.25) : []);
  const rebalMap = Object.fromEntries(rebal.map((r) => [r.ticker, r]));
  let total = 0; const acc = { roth: 0, traditional: 0, taxable: 0 }; const rows = []; let excludedFx = 0;
  const acctBucket = (a) => a === "taxable" ? "taxable" : a === "roth" ? "roth" : "traditional"; // legacy "ira" → traditional
  for (const [t, h] of entries) {
    const Q = DATA.sig?.quotes?.[t];
    const price = Q && !Q.error ? Q.price : null;
    const mv = price && h.shares ? price * h.shares : null;
    // U2: the browser has no FX rates → exclude non-USD lots from the sleeve total
    // (the scanner's server-side sleeve value FX-converts them). Never mis-sum as USD.
    const isUsd = !Q?.currency || Q.currency === "USD";
    if (mv && isUsd) { total += mv; acc[acctBucket(h.account)] += mv; }
    else if (mv && !isUsd) excludedFx++;
    const gain = price && h.cost_basis ? price / h.cost_basis - 1 : null;
    const tgt = targets[t];
    const rb = rebalMap[t];
    const rbCell = rb?.flagged ? `<span class="${rb.action==='trim'?'neg':'pos'}">⚖ ${rb.action} (${rb.drift>0?'+':''}${rb.drift}%)</span>` : (rb ? "in band" : "—");
    rows.push(`<tr><td><strong>${esc(t)}</strong></td><td>${esc(h.account || "—")}</td><td>${h.shares != null ? esc(String(h.shares)) : "—"}</td>
      <td>${price ? "$" + price.toFixed(2) : "—"}</td><td>${mv ? fmtUsd(mv) : "—"}</td>
      <td class="${gain>=0?'pos':'neg'}">${gain==null?"—":(gain*100).toFixed(0)+"%"}</td>
      <td>${tgt ? Math.round((mv||0)/tgt*100)+"% of target" : "—"}</td><td>${rbCell}</td></tr>`);
  }
  const capPct = Math.round(total / cap * 100);
  box.innerHTML = `<h3>Your holdings (live) <button class="help" data-help="myholdings">?</button> <span class="foot">— from your browser-stored positions × latest scan prices</span></h3>
    <div class="cards">
      <div class="card"><b>${fmtUsd(total)}</b><span>sleeve value (${capPct}% of $${(cap/1e6).toFixed(2)}mm cap)${excludedFx ? ` · ${excludedFx} foreign lot${excludedFx>1?"s":""} excluded` : ""}</span></div>
      <div class="card"><b>${fmtUsd(acc.roth)}</b><span>Roth</span></div>
      <div class="card"><b>${fmtUsd(acc.traditional)}</b><span>Traditional</span></div>
      <div class="card"><b>${fmtUsd(acc.taxable)}</b><span>taxable</span></div>
      ${pos.cash_usd?`<div class="card"><b>${fmtUsd(pos.cash_usd)}</b><span>dry powder</span></div>`:""}
    </div>
    <table class="mine"><thead><tr><th>Ticker</th><th>Acct</th><th>Shares</th><th>Price</th><th>Mkt value</th><th>Gain</th><th>vs target</th><th>Rebalance</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table>`;
}

// Optional in-browser digest using the stored Gemini key (CORS-friendly). Ephemeral.
async function browserDigest() {
  const k = getKeys();
  if (!k.gemini) return setMsg("Add a Gemini key first (Groq is CORS-blocked in browsers — use it via the Actions scanner).");
  setMsg("Generating digest with Gemini…");
  const model = "gemini-3.5-flash"; // latest thinking model (May 2026); 2.0-flash retired 2026-06-01
  const call = async (prompt) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${k.gemini}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    // Thinking models can split the answer across multiple parts — join them all.
    return ((await r.json())?.candidates?.[0]?.content?.parts || []).map((p) => p?.text).filter(Boolean).join("") || "";
  };
  try {
    const ctx = JSON.stringify({
      regime: DATA.sig?.regime,
      quotes: Object.fromEntries(Object.entries(DATA.sig?.quotes || {}).map(([t, q]) => [t, q?.error ? null : { ytd: q.ytd, off_high: q.pct_off_high, vs200: q.pct_vs_ma200, fwd_pe: q.forward_pe }])),
      filings: (DATA.sig?.filings || []).slice(0, 20),
      scarcities: (DATA.scar?.scarcities || []).map((s) => ({ id: s.id, priced_in: s.priced_in, bind: s.bind_window })),
    }).slice(0, 22000);
    const analyst = await call(`Markets analyst on a structural-tech-scarcity book. From this JSON (regime/quotes/filings/scarcities) write 6-10 terse, cited bullets on what materially changed and whether any deploy/exit trigger is closer. JSON:\n${ctx}`);
    const redteam = await call(`Skeptical red-team: attack this digest — over-stated, already-priced, or unsupported claims. 4-6 sharp bullets.\n\n${analyst}`);
    $("#digestBox").textContent = `_Generated in-browser (gemini:${model}); ephemeral, not committed._\n\n## Analyst\n${analyst}\n\n## Red-team\n${redteam}`;
    setMsg("Digest generated — see the Agent digest tab.");
    $$(".tabs button").forEach((x) => x.classList.remove("active")); $$(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelector('.tabs button[data-tab="digest"]').classList.add("active"); $("#digest").classList.add("active");
  } catch (e) { setMsg("Digest failed: " + e.message); }
}

function maybeOnboard() {
  const hasPos = Object.keys(getPositions().positions || {}).length > 0;
  const hasTok = !!localStorage.getItem(TOKEN_KEY);
  const el = $("#onboard"); if (!el) return;
  if (!hasPos && !hasTok) {
    el.className = "banner show";
    el.innerHTML = `👋 First time? Open <strong>⚙ Settings</strong> to add your holdings per account and (optionally) your free API keys — all stored only in this browser.`;
  } else { el.className = "banner"; el.textContent = ""; }
}

$("#settingsBtn").onclick = openSettings;
$("#settingsClose").onclick = closeSettings;
$("#settingsModal").onclick = (e) => { if (e.target.id === "settingsModal") closeSettings(); };
$("#hAdd").onclick = addHolding;
$("#hCash").onchange = saveCash;
$("#hExport").onclick = exportPositions;
$("#hImport").onchange = (e) => e.target.files[0] && importPositions(e.target.files[0]);
$("#hClear").onclick = () => { if (confirm("Clear all your stored holdings from this browser?")) { localStorage.removeItem(POS_KEY); renderHoldEditor(); render(); } };
// --- Admin: read repo config status + set non-secret variables via the GitHub API ---
function adminToken() { const t = $("#kAdmin").value.trim() || localStorage.getItem(ADMIN_TOKEN_KEY) || ""; if (t) localStorage.setItem(ADMIN_TOKEN_KEY, t); return t; }
const ghHeaders = (t) => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28" });

// Accept a research proposal: apply it (F9-guarded, in research-review.mjs) to scarcities.json and
// open a PR via the user's admin token — branch → commit the updated file → PR. The user merges.
async function acceptProposal(id) {
  const RR = window.PuckResearch, t = adminToken();
  if (!t) { alert("Open Settings → Admin and paste a GitHub token first.\n\nClassic token: the 'repo' scope.\nFine-grained token: Contents + Pull requests, both read/write."); return; }
  const proposal = (DATA.proposals?.proposals || []).find((p) => p.id === id);
  if (!proposal) return;
  const updated = RR.applyAcceptance(DATA.scar, proposal);            // F9-guarded; new doc
  if (updated === DATA.scar) { alert("Nothing to apply (no valid bot-owned change)."); return; }
  const btn = document.querySelector(`.accept-proposal[data-id="${CSS.escape(id)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Opening PR…"; }
  try {
    const api = `https://api.github.com/repos/${REPO}`;
    // 1) get scarcities.json's current sha (commit to the file, not blind overwrite)
    const meta = await (await fetch(`${api}/contents/web/data/scarcities.json`, { headers: ghHeaders(t) })).json();
    // 2) branch off main's head
    const ref = await (await fetch(`${api}/git/ref/heads/main`, { headers: ghHeaders(t) })).json();
    const branch = `research-accept/${id}-${Date.now().toString(36)}`;
    let r = await fetch(`${api}/git/refs`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
    if (!r.ok) throw new Error(`branch ${r.status}`);
    // 3) commit the updated scarcities.json on the branch
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2) + "\n")));
    r = await fetch(`${api}/contents/web/data/scarcities.json`, { method: "PUT", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ message: `research: accept ${id} reassessment`, content, sha: meta.sha, branch }) });
    if (!r.ok) throw new Error(`commit ${r.status}`);
    // 4) open the PR
    const chg = RR.proposalDiffs([proposal], DATA.scar)[0]?.changes?.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(", ") || "";
    r = await fetch(`${api}/pulls`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ title: `Accept research proposal: ${id}`, head: branch, base: "main",
        body: `Accepted from the dashboard. ${chg}\n\nRationale: ${proposal.rationale || "—"}\nPrompt v${proposal.prompt_version ?? "?"}, confidence ${proposal.confidence ?? "?"}. Bot-owned fields only (F9).` }) });
    const pr = await r.json();
    if (!r.ok) throw new Error(`PR ${r.status}: ${pr.message || ""}`);
    if (btn) { btn.textContent = "✓ PR opened"; }
    window.open(pr.html_url, "_blank", "noopener");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "✓ Accept → open PR"; }
    // A 404/403 on a public repo almost always means the token can READ but not WRITE — the most
    // common cause is a classic token created without the 'repo' scope ticked. Say so plainly
    // rather than naming fine-grained-only permissions that confuse classic-token users.
    alert(`Could not open PR: ${e.message}.\n\nThis usually means the token can read but not write. Check it has write access to ${REPO}:\n• Classic token → the 'repo' scope must be ticked\n• Fine-grained token → Contents + Pull requests, both read/write`);
  }
}

// Accept a SCOUT candidate: append it as a NEW scarcity (F9-guarded, schema-valid fields only, in
// scout-review.mjs) and open a PR via the user's admin token. Same branch→commit→PR flow as a
// research proposal; the user merges. This is how a scout-discovered chokepoint joins the watchlist.
async function acceptScoutCandidate(id) {
  const SC = window.PuckScout, t = adminToken();
  if (!t) { alert("Open Settings → Admin and paste a GitHub token first.\n\nClassic token: the 'repo' scope.\nFine-grained token: Contents + Pull requests, both read/write."); return; }
  const cand = (DATA.scout?.candidates || []).find((c) => c.id === id);
  if (!cand) return;
  const updated = SC.appendScoutScarcity(DATA.scar, cand);             // F9-guarded; new doc
  if (updated === DATA.scar) { alert("Nothing to add (candidate already exists or is invalid)."); return; }
  const btn = document.querySelector(`.accept-scout[data-id="${CSS.escape(id)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Opening PR…"; }
  try {
    const api = `https://api.github.com/repos/${REPO}`;
    const meta = await (await fetch(`${api}/contents/web/data/scarcities.json`, { headers: ghHeaders(t) })).json();
    const ref = await (await fetch(`${api}/git/ref/heads/main`, { headers: ghHeaders(t) })).json();
    const branch = `scout-accept/${id}-${Date.now().toString(36)}`;
    let r = await fetch(`${api}/git/refs`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
    if (!r.ok) throw new Error(`branch ${r.status}`);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2) + "\n")));
    r = await fetch(`${api}/contents/web/data/scarcities.json`, { method: "PUT", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ message: `scout: admit new scarcity ${id}`, content, sha: meta.sha, branch }) });
    if (!r.ok) throw new Error(`commit ${r.status}`);
    const filer = cand.complaining_filer ? ` Flagged via filer ${cand.complaining_filer}.` : "";
    r = await fetch(`${api}/pulls`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ title: `Admit scout scarcity: ${id}`, head: branch, base: "main",
        body: `Accepted from the dashboard's Scout tab — adds a NEW scarcity discovered by the constraint-shadow scout and vetted by the committee.${filer}\n\nConstraint language: ${(cand.constraint_phrases || []).join("; ") || "—"}\nCommittee confidence ${cand.confidence ?? "?"}. New-scarcity admission (F9: human-approved).` }) });
    const pr = await r.json();
    if (!r.ok) throw new Error(`PR ${r.status}: ${pr.message || ""}`);
    if (btn) { btn.textContent = "✓ PR opened"; }
    window.open(pr.html_url, "_blank", "noopener");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "✓ Accept → open PR (add scarcity)"; }
    alert(`Could not open PR: ${e.message}.\n\nThis usually means the token can read but not write. Check it has write access to ${REPO}:\n• Classic token → the 'repo' scope must be ticked\n• Fine-grained token → Contents + Pull requests, both read/write`);
  }
}

// ---------- Diversifier (2nd-axis) funding review → PR into portfolio.json ----------
function renderDiversifier() {
  const box = $("#diversifierReview"); if (!box) return;
  const DV = window.PuckDiversifier;
  const pctOf = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const head = `<h3>Diversifier sleeve — proposed funding <button class="help" data-help="diversifier">?</button> <span class="foot">— screen → committee conviction → size; you approve a PR into <code>portfolio.json</code> (the plan)</span></h3>`;
  const v = DV ? DV.diversifierFundingView(DATA.diversifier, DATA.port) : null;
  if (!v || (!v.funding && !v.qualifiers.length)) {
    box.innerHTML = head + `<p class="foot">No proposal yet${v?.generated ? ` (last run ${esc(v.generated)})` : ""}. Run the <strong>diversifier</strong> workflow (Actions → diversifier) to screen + size a sleeve.</p>`;
    return;
  }
  const f = v.funding;
  // Already merged? (the proposal stays in the feed after merge — don't offer to fund it again, which would
  // double-scale the build-out). Guard the CTA, not just the buy-plan render. [W1]
  const alreadyFunded = f?.newHoldings?.length && f.newHoldings.some((h) => (DATA.port?.holdings || []).some((ph) => ph.ticker === h.ticker));
  const fundHtml = f?.newHoldings?.length
    ? `<table class="mine"><thead><tr><th>Ticker</th><th>Sleeve</th><th>Conviction</th><th>Weight</th><th>Target $</th></tr></thead><tbody>${
        f.newHoldings.map((h) => `<tr><td><strong>${esc(h.ticker)}</strong></td><td class="foot">${esc(h.sleeve || "")}</td><td>${esc(String(h.conviction ?? "—"))}</td><td>${(h.weight * 100).toFixed(1)}%</td><td>${fmtUsd(h.target_usd)}</td></tr>`).join("")
      }</tbody></table>
      <p class="foot">Sleeve target <strong>${pctOf(v.sleeve_pct)}</strong> · existing diversifiers ${pctOf(f.existingDivWeight)} · build-out scaled ×${f.buildoutScale} so the plan stays at 100%. <strong>Advisory</strong> — the bot never edits your plan or trades.</p>
      <div class="modal-actions">${alreadyFunded ? `<button disabled>✓ Already funded (merged into the plan)</button>` : `<button class="accept-diversifier">✓ Accept → open PR (fund sleeve in portfolio.json)</button>`}</div>`
    : `<p class="foot">The screen produced no fundable names this run.</p>`;
  const qual = v.qualifiers.length
    ? `<h4>Qualifying sleeves <span class="foot">— machine-computed (no hand-typed numbers)</span></h4><div class="tscroll"><table class="mine"><thead><tr><th>Sleeve</th><th>maxDD</th><th>mkt-β</th><th>build-out β</th><th>Δdrawdown vs plan</th></tr></thead><tbody>${
        v.qualifiers.map((c) => `<tr><td>${esc(c.scarcity || c.id)}</td><td>${pctOf(c.maxDD)}</td><td>${c.marketBeta ?? "—"}</td><td>${c.buildoutBeta ?? "—"}</td><td class="${c.ddReduction > 0 ? "pos" : ""}">${c.ddReduction != null ? pctOf(c.ddReduction) : "—"}</td></tr>`).join("")
      }</tbody></table></div>`
    : "";
  box.innerHTML = head + (v.generated ? `<p class="foot">last run ${esc(v.generated)}</p>` : "") + fundHtml + qual;
  const b = box.querySelector(".accept-diversifier"); if (b) b.onclick = () => acceptDiversifierFunding();
}

// Accept the diversifier funding: apply it to the LIVE plan and open a PR into portfolio.json (the only
// bot PR that edits the plan). Same branch→commit→PR flow as the scout; you merge. F9: human-approved.
async function acceptDiversifierFunding() {
  const DV = window.PuckDiversifier, t = adminToken();
  if (!t) { alert("Open Settings → Admin and paste a GitHub token first.\n\nClassic token: the 'repo' scope.\nFine-grained token: Contents + Pull requests, both read/write."); return; }
  const funding = DATA.diversifier?.funding;
  if (!funding?.newHoldings?.length) { alert("No fundable proposal."); return; }
  if (funding.newHoldings.some((h) => (DATA.port?.holdings || []).some((ph) => ph.ticker === h.ticker))) { alert("Already funded — these names are in portfolio.json. Funding again would double-scale the build-out."); return; } // [W1]
  const updated = DV.applyDiversifierFunding(DATA.port, funding);
  if (!updated || updated === DATA.port) { alert("Nothing to fund."); return; }
  const pct = Math.round((DATA.diversifier?.sleeve_pct || funding.sleevePct || 0.15) * 100);
  const btn = document.querySelector(".accept-diversifier");
  if (btn) { btn.disabled = true; btn.textContent = "Opening PR…"; }
  try {
    const api = `https://api.github.com/repos/${REPO}`;
    const meta = await (await fetch(`${api}/contents/web/data/portfolio.json`, { headers: ghHeaders(t) })).json();
    const ref = await (await fetch(`${api}/git/ref/heads/main`, { headers: ghHeaders(t) })).json();
    const branch = `diversifier-fund/${Date.now().toString(36)}`;
    let r = await fetch(`${api}/git/refs`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
    if (!r.ok) throw new Error(`branch ${r.status}`);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2) + "\n")));
    r = await fetch(`${api}/contents/web/data/portfolio.json`, { method: "PUT", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ message: `diversifier: fund 2nd-axis sleeve (${pct}%)`, content, sha: meta.sha, branch }) });
    if (!r.ok) throw new Error(`commit ${r.status}`);
    const names = funding.newHoldings.map((h) => h.ticker).join(", ");
    r = await fetch(`${api}/pulls`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ title: `Fund diversifier sleeve (${pct}%)`, head: branch, base: "main",
        body: `Accepted from the dashboard's Diversifier tab — funds the 2nd-axis (diversifier) sleeve in the PLAN.\n\nAdds **${names}** (conviction × inverse-vol) and scales the build-out by ×${funding.buildoutScale} so the plan still sums to 100% with the diversifier axis at ${pct}%. F9: human-approved — you merge, and you still place the trades.` }) });
    const pr = await r.json();
    if (!r.ok) throw new Error(`PR ${r.status}: ${pr.message || ""}`);
    if (btn) { btn.textContent = "✓ PR opened"; }
    window.open(pr.html_url, "_blank", "noopener");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "✓ Accept → open PR (fund sleeve in portfolio.json)"; }
    alert(`Could not open PR: ${e.message}.\n\nThis usually means the token can read but not write. Check it has write access to ${REPO}:\n• Classic token → the 'repo' scope must be ticked\n• Fine-grained token → Contents + Pull requests, both read/write`);
  }
}

// ---------- Catalyst draft-PR: a fired manual trigger → a reviewable cut/trim PR into portfolio.json ----------
// F9: drafts a PR you review/adjust/merge — never auto-merged, never trades. Mirrors the diversifier flow.
async function draftCatalystPR(triggerId) {
  const C = window.PuckCatalyst, t = adminToken();
  if (!t) { alert("Open Settings → Admin and paste a GitHub token first (Contents + Pull requests, write)."); return; }
  const trig = (DATA.trig?.triggers || []).find((x) => x.id === triggerId);
  const cw = DATA.sig?.catalyst_watch?.[triggerId];
  const ed = trig && C ? C.catalystEditable(trig) : null;
  if (!ed) { alert("This trigger has no plan edit."); return; }
  // Idempotency (H3): if the affected names are already gone (a prior PR merged), don't open a duplicate/no-op.
  const present = ed.affects.filter((a) => (DATA.port?.holdings || []).some((h) => h.ticker === a && (h.weight || 0) > 0));
  if (!present.length) { alert(`Already applied — ${ed.affects.join("/")} ${ed.affects.length > 1 ? "are" : "is"} not in the plan (a prior PR likely merged).`); return; }
  if (cw?.status !== "fired" && !confirm(`This catalyst is "${cw?.status || "?"}", not a confirmed fire. Draft the ${ed.edit} PR anyway?`)) return;
  const updated = C.applyCatalystEdit(DATA.port, ed);
  if (!updated || updated === DATA.port) { alert("Nothing to edit in the plan."); return; }
  const btn = document.querySelector(`[data-catalyst-pr="${triggerId}"]`);
  const verb = ed.edit === "cut" ? "Cut" : "Trim", names = ed.affects.join("/");
  if (btn) { btn.disabled = true; btn.textContent = "Opening PR…"; }
  try {
    const api = `https://api.github.com/repos/${REPO}`;
    const meta = await (await fetch(`${api}/contents/web/data/portfolio.json`, { headers: ghHeaders(t) })).json();
    const ref = await (await fetch(`${api}/git/ref/heads/main`, { headers: ghHeaders(t) })).json();
    const branch = `catalyst/${triggerId}-${Date.now().toString(36)}`;
    let r = await fetch(`${api}/git/refs`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
    if (!r.ok) throw new Error(`branch ${r.status}`);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2) + "\n")));
    r = await fetch(`${api}/contents/web/data/portfolio.json`, { method: "PUT", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ message: `catalyst: ${verb.toLowerCase()} ${names} (${triggerId})`, content, sha: meta.sha, branch }) });
    if (!r.ok) throw new Error(`commit ${r.status}`);
    r = await fetch(`${api}/pulls`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ title: `Catalyst: ${verb} ${names} — ${trig.name}`, head: branch, base: "main",
        body: `Drafted from the dashboard's Triggers panel after the **${triggerId}** catalyst fired (committee-judged from news + SEC filings, corroborated + 2-scan-confirmed).\n\n**${verb} ${ed.affects.join(", ")}** and renormalize the plan to 100%.\n\nDrafted action: ${cw?.suggested_action || trig.action}\nConfidence: ${cw?.confidence ?? "—"} · sources: ${(cw?.citations || []).join(", ") || "—"}\n\n**F9: advisory — review the weights, adjust if needed, and merge. You still place the trades.**` }) });
    const pr = await r.json();
    if (!r.ok) throw new Error(`PR ${r.status}: ${pr.message || ""}`);
    if (btn) btn.textContent = "✓ PR opened";
    window.open(pr.html_url, "_blank", "noopener");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = `Draft PR — ${ed.edit} ${names}`; }
    alert(`Could not open PR: ${e.message}. The token needs Contents + Pull requests write on ${REPO}.`);
  }
}

// Approve the scout's PENDING constraint phrases (D1 vet-before-search gate): flip pending→approved
// (in scout-review.mjs) and open a PR updating scout-phrases.json. After merge, the weekly sweep is
// allowed to search them. Same branch→commit→PR flow as the other accept actions.
async function approveScoutPhrases() {
  const SC = window.PuckScout, t = adminToken();
  if (!t) { alert("Open Settings → Admin and paste a GitHub token first."); return; }
  const updated = SC.approvePendingPhrases(DATA.scoutPhrases);
  if (!updated || updated === DATA.scoutPhrases) { alert("No pending phrases to approve."); return; }
  const btn = document.querySelector(".approve-phrases");
  if (btn) { btn.disabled = true; btn.textContent = "Opening PR…"; }
  try {
    const api = `https://api.github.com/repos/${REPO}`;
    const meta = await (await fetch(`${api}/contents/web/data/scout-phrases.json`, { headers: ghHeaders(t) })).json();
    const ref = await (await fetch(`${api}/git/ref/heads/main`, { headers: ghHeaders(t) })).json();
    const branch = `scout-phrases/${Date.now().toString(36)}`;
    let r = await fetch(`${api}/git/refs`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
    if (!r.ok) throw new Error(`branch ${r.status}`);
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(updated, null, 2) + "\n")));
    r = await fetch(`${api}/contents/web/data/scout-phrases.json`, { method: "PUT", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ message: "scout: approve constraint phrases", content, sha: meta.sha, branch }) });
    if (!r.ok) throw new Error(`commit ${r.status}`);
    const n = (updated.phrases || []).filter((p) => p.status === "approved").length;
    r = await fetch(`${api}/pulls`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" },
      body: JSON.stringify({ title: "Approve scout constraint phrases", head: branch, base: "main",
        body: `Approves the scout's pending constraint phrases (D1 vet-before-search gate). After merge, the weekly sweep searches all ${n} approved phrases.` }) });
    const pr = await r.json();
    if (!r.ok) throw new Error(`PR ${r.status}: ${pr.message || ""}`);
    if (btn) { btn.textContent = "✓ PR opened"; }
    window.open(pr.html_url, "_blank", "noopener");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "✓ Approve pending phrases → open PR"; }
    alert(`Could not open PR: ${e.message}.\n\nThe token needs write access to ${REPO} (classic 'repo' scope, or fine-grained Contents + Pull requests read/write).`);
  }
}

async function checkConfig() {
  const t = adminToken();
  if (!t) return setMsg("Paste an admin GitHub token (fine-grained: Secrets read, Variables read/write).");
  setMsg("Reading repo configuration…");
  try {
    const [secR, varR] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/actions/secrets?per_page=100`, { headers: ghHeaders(t) }),
      fetch(`https://api.github.com/repos/${REPO}/actions/variables?per_page=100`, { headers: ghHeaders(t) }),
    ]);
    if (!secR.ok) { if ([401,403,404].includes(secR.status)) localStorage.removeItem(ADMIN_TOKEN_KEY); return setMsg(`GitHub rejected the admin token (HTTP ${secR.status}). Needs Secrets: read + Variables: read/write on ${REPO}.`); }
    const secrets = (await secR.json()).secrets?.map((s) => s.name) || [];
    const vars = varR.ok ? (await varR.json()).variables || [] : [];
    const varNames = vars.map((v) => v.name);
    // prefill variable fields from GitHub (variables are not secret)
    const ae = vars.find((v) => v.name === "ALERT_EMAIL_TO"); if (ae) $("#vAlertEmail").value = ae.value;
    const ua = vars.find((v) => v.name === "SEC_USER_AGENT"); if (ua) $("#vSecUA").value = ua.value;
    const su = vars.find((v) => v.name === "SUPABASE_URL"); if (su) $("#vSupabaseUrl").value = su.value;
    renderAdminStatus(secrets, varNames);
    setMsg("Configuration loaded.");
  } catch (e) { setMsg("Config check failed: " + e.message); }
}

function renderAdminStatus(secrets, variables) {
  const A = window.PuckAdmin; if (!A) return;
  const st = A.configStatus(secrets, variables);
  const bk = A.browserKeyStatus(getKeys(), !!localStorage.getItem(TOKEN_KEY));
  const row = (x) => `<tr><td>${x.configured ? "✅" : "⬜"}</td><td><code>${x.name || x.key}</code></td><td>${x.label}</td></tr>`;
  $("#adminStatus").innerHTML = `
    ${rosterHtml(A.committeeRoster(secrets))}
    <table class="cfg"><tbody>
      <tr><th colspan="3">Repo secrets (scanner) — set in GitHub → Settings → Secrets</th></tr>
      ${st.secrets.map(row).join("")}
      <tr><th colspan="3">Repo variables (settable below)</th></tr>
      ${st.variables.map(row).join("")}
      <tr><th colspan="3">Browser keys (this device)</th></tr>
      ${bk.map(row).join("")}
    </tbody></table>
    <p class="modal-note">Secrets are write-only in GitHub (values never shown). Set/rotate them at
      <a href="https://github.com/${REPO}/settings/secrets/actions" target="_blank" rel="noopener">github.com/${REPO}/settings/secrets/actions</a>.</p>`;
}

// Live "which LLM does what role" panel — reads the same secrets GitHub reports, so it shows the
// TRUE committee assignment for the next research run (and whether the CRO risk review is active).
function rosterHtml(r, when = "next run") {
  if (!r || !r.providers?.length) return `<p class="modal-note">⚠ <strong>No LLM key set</strong> — the research committee can't run. Add at least one of Groq / OpenRouter / Gemini (free) or Anthropic / OpenAI (frontier).</p>`;
  const seat = (role, who, note) => `<tr><td><strong>${role}</strong></td><td>${who ? esc(who) : "—"}</td><td class="foot">${note}</td></tr>`;
  const croCell = r.cro ? `${esc(r.cro)} <span style="color:var(--good)">✓ frontier</span>` : `<span style="color:var(--y27)">disabled</span>`;
  return `<table class="cfg roster"><tbody>
      <tr><th colspan="3">🏛 Research committee — who plays each role ${esc(when)}${r.singleModel ? " <span class='foot'>(single model: roles reuse it)</span>" : ""}</th></tr>
      ${seat("Bull", r.bull, "makes the strongest variant-perception case")}
      ${seat("Bear", r.bear, "tries to kill the thesis")}
      ${seat("Skeptic", r.skeptic, "outside view / base rates")}
      ${seat("CIO (chair)", r.cio, "weighs the debate, issues the call")}
      <tr><td><strong>CRO review</strong></td><td>${croCell}</td><td class="foot">independent risk check — <strong>requires Anthropic/OpenAI</strong></td></tr>
    </tbody></table>
    ${r.cro ? "" : `<p class="modal-note">The <strong>Chief-Risk-Officer review</strong> (catches hallucinated tickers, momentum traps, illogical theses) is <strong>off</strong> — it needs a frontier key. Add <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> below to enable it.</p>`}`;
}

async function saveVariables() {
  const t = adminToken();
  if (!t) return setMsg("Paste an admin token first.");
  const items = [["ALERT_EMAIL_TO", $("#vAlertEmail").value.trim()], ["SEC_USER_AGENT", $("#vSecUA").value.trim()], ["SUPABASE_URL", $("#vSupabaseUrl").value.trim()]].filter(([, v]) => v);
  if (!items.length) return setMsg("Enter a value to save.");
  setMsg("Saving variables to GitHub…");
  try {
    for (const [name, value] of items) {
      localStorage.setItem(`puck_var_${name}`, value);
      // upsert: PATCH existing, else POST new
      let r = await fetch(`https://api.github.com/repos/${REPO}/actions/variables/${name}`, { method: "PATCH", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ name, value }) });
      if (r.status === 404) r = await fetch(`https://api.github.com/repos/${REPO}/actions/variables`, { method: "POST", headers: { ...ghHeaders(t), "content-type": "application/json" }, body: JSON.stringify({ name, value }) });
      if (!r.ok && r.status !== 204) return setMsg(`Failed to set ${name} (HTTP ${r.status}). Token needs Variables: read/write.`);
    }
    setMsg(`Saved ${items.map(([n]) => n).join(", ")} to the repo. ✓`);
    checkConfig();
  } catch (e) { setMsg("Save failed: " + e.message); }
}

$("#kSave").onclick = saveKeys;
$("#kDigest").onclick = browserDigest;
$("#kCheck").onclick = checkLivePrices;
$("#cfgCheck").onclick = checkConfig;
$("#cfgSaveVars").onclick = saveVariables;

// ---------- Site-wide contextual help (every feature ships with a "?") ----------
const HELP = {
  overview: { title: "What is Puck?", body: `
    <p><strong>Puck</strong> tracks structural technology <em>scarcities</em> (chokepoints that bind over 2026–2036) and turns them into a live portfolio view. The philosophy: <strong>alpha from the scarcity research, timing from the tape.</strong></p>
    <p><strong>Scarcity → chokepoint → ticker → your portfolio.</strong> A <em>scarcity</em> IS a structural <em>chokepoint</em> — a bottleneck that can't be relieved quickly (merchant power, large transformers, gas-turbine slots, copper, uranium enrichment, HBM…). Each chokepoint maps to the handful of <strong>tradeable tickers</strong> that have pricing power over it (e.g. turbines→GEV, copper→FCX/COPX, enrichment→LEU) — and <em>those tickers are your portfolio holdings</em>. The <strong>Scarcity radar</strong> ranks the chokepoints by where the edge is; the <strong>Holdings plan</strong> is the same chokepoints expressed as positions. Some of the best chokepoints have <em>no clean public proxy</em> (private/foreign/impaired) — the <strong>Chokepoints</strong> tab surfaces those and the discovered proxy plays. So the portfolio is simply the investable expression of the chokepoints, split across the two sleeves below.</p>
    <p><strong>How it all comes together</strong> — one plan, <strong>two sleeves</strong>, each kept current by its own workflow. The bot only <em>proposes</em>; you merge every PR; it never trades:</p>
    <img src="img/portfolio-view.svg" alt="Portfolio view: the Deep-tech build-out sleeve (~85%) is kept current by Scout and Committee PRs into scarcities.json plus the Scan's advisory rebalance; the Diversifier sleeve (~15%) by Screen, Committee conviction, Size, then one PR into portfolio.json. You merge every PR; the bot never trades." style="width:100%;height:auto;border:1px solid var(--line);border-radius:10px;margin:8px 0"/>
    <ul><li><strong>① Deep-tech build-out (~85%, the alpha)</strong> — Scout finds scarcities, the Committee vets them (both open a PR → <code>scarcities.json</code>), and the daily Scan scores everything + feeds the tax-located buy plan (advisory — no PR; you trade).</li>
    <li><strong>② Diversifier (~15%, drawdown hedge)</strong> — a screen gates defensive sleeves, a committee scores conviction, sizing fills the 15% budget, and <em>one</em> PR → <code>portfolio.json</code> funds it.</li>
    <li><strong>You</strong> merge every PR and place the trades. <strong>Puck never trades or edits your book.</strong></li></ul>
    <p>The two axes never co-mingle — each is gated, scored, and sized on its own. Detailed per-pipeline diagrams + cadences are in the <strong>User Guide §1a</strong>; the full as-built wiring is in <code>docs/ARCHITECTURE.md</code>.</p>
    <p><strong>Held to account.</strong> Puck grades its own calls, not just makes them: every per-name TSMOM tilt (21d), de-rating/inflecting alpha call (42d), and signal-vs-research sizing tilt (42d) is recorded and resolved into a hit-rate — and every committee thesis carries a <strong>pre-registered, dated kill-criterion</strong> that is deadline-tracked (survived / killed / needs-adjudication). The <em>timing</em> dial is backtested, not asserted: a 200-DMA brake + breadth fast-entry, turnover-costed, run through real crashes (2000/2008/2020/2022) on deep history and against the −35% mandate.</p>
    <ul><li><strong>Scarcity radar</strong> — what's scarce, when it binds, and how priced-in it already is.</li>
    <li><strong>Portfolio &amp; triggers</strong> — your sleeve, the <em>timing posture</em> (when to deploy vs. raise cash), and deploy/exit triggers.</li>
    <li><strong>Filings &amp; news</strong> — free SEC EDGAR + news per holding/scarcity.</li>
    <li><strong>Options check</strong> — confirm an option's price is fair before you buy.</li>
    <li><strong>⚙ Settings</strong> — add your holdings per account and free API keys (stored only in your browser).</li></ul>
    <p>Not financial advice. Every name is cyclical and would fall together in a shock.</p>` },
  radar: { title: "Scarcity radar", body: `
    <p>Each row is a structural scarcity, <strong>ranked by Opportunity Score</strong> — where the retail alpha is. Columns:</p>
    <ul><li><strong>Opportunity† (0–100)</strong> — the structural edge <em>before</em> the tape confirms it: <em>binds soon × durable × defensible × <strong>not yet priced</strong></em>. Priced-in is a multiplicative <strong>gate</strong> — a <code>crowded</code> thesis scores ~0 however good the business, because there's no alpha left in what's priced. The gate blends the human label (60%) with a <strong>live price-derived crowding proxy</strong> (40%), so it updates with the tape; a <strong>↑tape / ↓tape</strong> chip flags where the market disagrees with the label. Built from the source fields only (no curve-fitting); see <strong>ALPHA.md</strong>. Top opportunities are recorded as relative-outperformance forecasts and graded.</li>
    <li><strong>Binds</strong> — when the chokepoint starts biting (now → 2030+ → physics floor).</li>
    <li><strong>Priced-in</strong> — how much the market already reflects it (low → crowded). High/crowded = less edge left.</li>
    <li><strong>Durability</strong> — how long the moat lasts; <strong>Subst. risk</strong> — chance a substitute relieves it.</li>
    <li><strong>Crowding*</strong> — a <em>live</em> 0–100 proxy from price action (YTD + distance to 52-week high). Higher = more already-priced.</li>
    <li><strong>◆ non-consensus</strong> = under-appreciated (lifts Opportunity); <strong>↓ de-rating / ↑ inflecting</strong> = the tape confirming/denying; <strong>▲ drift</strong> = priced-in changed since first tracked.</li>
    <li><strong>✚ accumulate / ⏳ accumulate on trigger</strong> (forced-flow, Edge 3) = the name is mechanically de-rated (off highs, below trend) <em>while the thesis is intact</em> — the footprint of forced/neglect selling you can buy. It's <strong>regime-aware</strong>: when the timing dial has the brakes on it shows <em>⏳ on trigger</em> (a deploy-WHEN-the-drawdown-trigger-fires priority, not buy-now) so selection and timing never contradict. <strong>⚠ broken</strong> = de-rated AND thesis weak → real deterioration, not a gift.</li></ul>
    <p><strong>◇ diversifier · 2nd axis</strong> — a few rows are a <em>different kind</em>: defensive sleeves (e.g. health, water/climate) held to <strong>lower the book's drawdown</strong>, not to chase alpha. They're deliberately <em>not</em> Opportunity-scored — instead their cell shows <strong>maxDD · market-β · Deep-tech build-out β</strong> (a name only qualifies if it doesn't amplify the AI build-out). Hover the cell for the blended-sleeve drawdown.</p>
    <p>Filter by sector or to non-consensus only. The four structural sources of retail alpha — duration mispricing, inaccessibility, forced-flow, and discipline — are documented in <strong>ALPHA.md</strong>.</p>` },
  triggers: { title: "Deploy / exit triggers", body: `
    <p>Rules that tell you to act. Each shows a state: <strong>armed</strong> (active, watching), <strong>monitor</strong> (manual watch), or <strong>fired</strong> (condition met).</p>
    <ul><li><strong>Drawdown</strong> (auto) — complex down ≥20–25% from highs → deploy dry powder.</li>
    <li><strong>Trim rule</strong> (auto) — a name &gt;2× cost basis AND &gt;50× forward P/E → trim ⅓ (needs your cost basis from Settings).</li>
    <li><strong>Sleeve cap</strong> (auto) — sleeve value &gt; ~$1.72mm → trim back (needs your holdings from Settings).</li>
    <li><strong>Policy triggers</strong> (manual) — e.g. rare-earth/uranium policy shifts.</li></ul>
    <p><strong>Catalyst watch (auto-monitored manual triggers).</strong> Each policy trigger is now watched for you: every scan the committee judges its condition from fresh <strong>news + SEC filings</strong> and sets a status — <strong>monitoring → approaching → likely-met → fired</strong> — with a confidence, the <strong>evidence</strong> it used, and a drafted <strong>⇒ suggested action</strong> (portfolio- and tax-aware). It only reaches <em>fired</em> when corroborated (a filing or multiple sources, never one headline) <em>and</em> confirmed on two consecutive scans — the same anti-noise discipline as the auto triggers.</p>
    <p>When any trigger fires, the scanner opens a GitHub issue (deduped). <strong>Advisory only — Puck never trades or edits your book; you confirm and act.</strong></p>` },
  regime: { title: "Timing posture (regime)", body: `
    <p>The <strong>alpha</strong> is the scarcity thesis; this is the <strong>timing</strong> overlay — when to deploy/go-all-in vs. apply the brakes into cash. The brake and the fast re-entry <strong>are the canonical F+C Thrust ladder</strong> (the owner's production rule), computed on the theme-ETF composite — the same rule the backtest runs and the V2.3 cross-check replicates. Each leg is independently-replicated research, not a curve fit:</p>
    <ul><li><strong>TREND</strong> (Faber 2007) — composite above its 200-DMA → <strong>🟢 risk-on</strong> (deploy / accelerate).</li>
    <li><strong>CRASH_OFF</strong> (Daniel-Moskowitz 2016) — trailing 252-day return &lt; 0 <em>and</em> 60-day vol &gt; 25% → <strong>🔴 defensive</strong> (raise cash).</li>
    <li><strong>THRUST</strong> — close above a <em>rising</em> 20-DMA while still below the 200-DMA → <strong>⚪ neutral</strong>, the <strong>fast re-entry</strong> (re-risk after a bottom without waiting for the slow 200-DMA). The rising-MA requirement is the built-in confirmation against bear-rally head-fakes.</li>
    <li>else (below trend, no thrust, no crash) → <strong>🔴 defensive</strong> (cash).</li></ul>
    <p>Ladder order (first match wins): CRASH_OFF → TREND → THRUST → cash. On top sits an <strong>exit-only composite-stress overlay</strong> — it forces defensive when the <strong>VIX term-structure is inverted AND high-yield credit is widening fast</strong> (rare, leading; can only de-risk).</p>
    <p>It's <strong>account-aware</strong> — the posture drives your <strong>IRA/Roth</strong> (tactical, tax-free turnover) while <strong>taxable</strong> stays buy-and-hold anchors — and it carries a separate <strong>per-name TSMOM tilt</strong> (which names to lean into vs. trim). A risk dial that paces your DCA, not an all-in/all-out switch. Full detail: REGIME.md / FABER-CRASH-STRATEGY.md.</p>` },
  myholdings: { title: "Your holdings (live)", body: `
    <p>Computed from the positions you entered in ⚙ Settings × the latest scan prices — stored only in your browser. Shows market value, gain vs cost, % of target, per-account subtotals, and your sleeve value vs the ~$1.72mm cap. The <strong>Rebalance</strong> column flags any holding &gt;±25% from its target weight (⚖ trim/add). Foreign-currency lots are <em>excluded</em> from this browser total (no FX rates client-side; the scanner's server-side sleeve value FX-converts them). Export to <code>positions.local.json</code> to also enable the server-side trim/sleeve triggers.</p>` },
  filings: { title: "Filings &amp; news", body: `
    <p>Free, keyless. <strong>SEC EDGAR</strong> lists each holding's recent material filings (8-K/10-Q/10-K/6-K/20-F); 8-K <em>items</em> are decoded into topics (Results/guidance, Material agreement, etc.). <strong>NEW</strong> = unseen since the last scan. <strong>News</strong> is Google-News RSS keyed to each scarcity's thesis terms, deduped. Both feed the Agent digest.</p>` },
  options: { title: "Options fair-value check", body: `
    <p>Before paying for an option, check the price is <em>fair</em>. We back out the option's <strong>implied volatility (IV)</strong> from its market price (Black-Scholes) and compare it to the underlying's recent <strong>realized volatility</strong> (from the scan).</p>
    <ul><li><strong>cheap</strong> — IV below realized vol.</li>
    <li><strong>fair</strong> — IV within a normal variance-risk premium (≈0.95–1.35× realized).</li>
    <li><strong>rich</strong> — IV well above realized; you're paying up.</li></ul>
    <p><strong>How to use:</strong> pick the underlying (S &amp; realized vol auto-fill), enter type/strike/days-to-expiry/option price → Evaluate. You get IV, fair value at realized vol, the edge vs that, a verdict, and greeks (delta/vega/theta).</p>
    <p><strong>Defined-risk only — no naked options.</strong> Use long calls/puts, debit spreads, collars, covered calls, cash-secured puts. Caveats: realized vol is backward-looking and options also carry event/skew premia, so treat this as a sanity check, not a price oracle. Not advice.</p>` },
  digest: { title: "Agent digest", body: `
    <p>An optional <strong>analyst + red-team</strong> read of <em>what changed this scan</em> for the <strong>deep-tech build-out</strong> sleeve: fresh quotes (incl. forward P/E), recent SEC filings (8-K/10-Q items — backlog, capacity, guidance, pricing), news headlines, and whether any deploy/exit <strong>trigger</strong> looks closer.</p>
    <p>With <strong>two</strong> keys it runs <em>cross-model</em> — the analyst writes on one model, a skeptical red-team rebuts on another (not a model grading itself). It uses whatever you've configured, <strong>free or paid</strong> (Gemini / Groq / OpenRouter, or Anthropic / OpenAI); the header names the exact models used.</p>
    <p>The <strong>diversifier</strong> sleeve isn't summarized here — it's judged on drawdown reduction, not narrative. Enable the digest with a key in ⚙ Settings (in-browser) or as GitHub repo secrets (the automated scanner).</p>` },
  research: { title: "Research proposals — how the committee works", body: `
    <p>The monthly research engine doesn't just ask one model. For each scarcity it runs an <strong>investment committee</strong> over <strong>deep evidence</strong> (multi-angle news excerpts + SEC filing passages + live price signals), then proposes reassessments of only three <strong>bot-owned</strong> fields — <strong>priced-in / bind-window / non-consensus</strong>. It only PROPOSES; you APPROVE.</p>
    <p><strong>The committee (4 seats + 2 checks):</strong></p>
    <ul>
      <li><strong>Bull</strong> — the strongest variant-perception case: what does consensus underrate?</li>
      <li><strong>Bear</strong> — tries to <em>kill</em> the thesis: supply response, demand air-pocket, already-priced.</li>
      <li><strong>Skeptic</strong> — the outside view: how often do "structural shortage" stories just mean-revert?</li>
      <li><strong>CIO (chair)</strong> — weighs the three seats + their <em>dispersion</em> (how much they disagree → lower confidence) and issues the final call with a variant view, a steelmanned bear case, and a dated <em>kill-criterion</em> (what would prove it wrong).</li>
    </ul>
    <p>Run on <strong>different model families</strong> (one per provider key), the seats give genuine cognitive diversity instead of one model agreeing with itself. The dashboard's <strong>Admin → Check configuration</strong> shows exactly <strong>which LLM is playing each role</strong> for the next run.</p>
    <p><strong>Two trust layers catch the mistakes a non-expert can't:</strong></p>
    <ul>
      <li><strong>1 · Verification gate (automatic, in code):</strong> hard-blocks a call that rates a name "cheaper" while its basket is already up big (the momentum trap), or that's highly confident on near-zero evidence; flags a ticker in the thesis that isn't in the scarcity's coverage (a likely hallucination). No model needed — it always runs.</li>
      <li><strong>2 · Chief-Risk-Officer (CRO) review:</strong> an independent <strong>frontier-model</strong> pass that does the fuzzy judgment code can't — is every ticker real and correctly attributed? does the thesis actually follow? is it chasing momentum? It can <strong>veto</strong> a proposal or dock its confidence. <strong>This requires an Anthropic or OpenAI key</strong> (a free model grading its own free-tier siblings isn't a real check), so without a frontier key the CRO is disabled and only layer 1 runs.</li>
    </ul>
    <p>Each card shows the <strong>before→after</strong> change, rationale, sources, confidence, any <strong>Checks</strong> flags, and the CRO note. <strong>Accept</strong> opens a GitHub <strong>pull request</strong> with just that change (needs a token in Settings → Admin: Contents + Pull requests read/write) — you merge it. <strong>Reject</strong> dismisses it. The bot can <em>only</em> ever touch those three fields — never the thesis or tickers (F9). Not advice.</p>` },
  location: { title: "Tax-located buy plan", body: `
    <p>Deploys your cash into the committee's suggested plan (build-out + the diversifier sleeve), placing <strong>each name in the account that maximizes after-tax terminal value</strong> — then a <strong>buy list grouped by account</strong>. Two robust rules: <strong>(1)</strong> shelter the annual dividend <em>tax drag</em> — income-heavy names go to a tax-advantaged account, tax-efficient (low-yield) names to <strong>taxable</strong> (qualified rates, step-up, loss-harvesting); <strong>(2)</strong> within tax-advantaged the <strong>highest-growth</strong> names go to <strong>Roth</strong> (biggest balance compounding tax-free), income/lower-growth to <strong>Traditional</strong>.</p>
    <p>Enter your <strong>Roth / Traditional / taxable</strong> cash + marginal rate + horizon. <strong>Exclude</strong> tickers you already own elsewhere (e.g. <code>SMH</code>) — they're dropped and the rest renormalized. Rebalancing later keeps these locations. The <strong>drag avoided</strong> is the dividend tax sheltering removes, compounded over your horizon; growth (build-out ~9%, defensive ~4%) and yield use per-axis defaults where live data is absent.</p>
    <p><strong>Per-name entry timing.</strong> The composite "ACT NOW" card says deploy-in-general; each row also gets its OWN read — <span class="epill good">good entry</span> / <span class="epill fair">fair</span> / <span class="epill stretched">stretched</span> — blending <strong>dislocation</strong> (% off 52w high), <strong>trend</strong> (vs 200-DMA), <strong>momentum</strong> (12m inverted-U — a healthy uptrend is good, a parabolic blow-off is overbought), <strong>relative strength</strong> (its scarcity basket de-rating/inflecting vs the complex), and <strong>valuation</strong> (trailing P/E vs its peers, corroborated across <strong>SEC EDGAR XBRL + Tiingo</strong>). A <em>stretched</em> name is <strong>staged</strong>: only part deploys now, the rest is DCA'd ("$X now · DCA $Y") so a lump-sum doesn't buy the top. Hover a pill for its reasons + score. Valuation is trailing (forward P/E isn't available keyless); it fills in once the daily scan resolves it.</p>
    <p><strong>Advisory, not tax advice.</strong> It's the robust location lever — it doesn't model your exact bracket arbitrage (withdrawal vs contribution rate), RMDs, or estate plan.</p>` },
  diversifier: { title: "Diversifier sleeve — funding the 2nd axis", body: `
    <p>The second axis is a <strong>defensive sleeve</strong> (health, water…) held to <strong>lower the book's drawdown</strong>, not to chase alpha — so it has its own funding pipeline, separate from the build-out Opportunity logic.</p>
    <p><strong>Screen</strong> (the <code>diversifier</code> workflow) gates candidate defensive baskets on low market β, a non-amplifying <strong>build-out β ≤ 0.3</strong>, and whether they actually <em>lower the drawdown of the plan you already hold</em> (book-aware — water vs the FIW already planned is flagged redundant). <strong>Committee</strong> then scores each surviving name a conviction; <strong>Size</strong> funds the <strong>top N by conviction</strong> (default 6 — a focused sleeve, not dozens of dust positions) by <code>weight = conviction × inverse-volatility</code> within the sleeve budget (default 15% of the investable sleeve), netted around what's already planned.</p>
    <p><strong>Accept</strong> opens a PR that funds the sleeve in <code>portfolio.json</code> — the only bot PR that edits your plan (it scales the build-out so the plan still sums to 100% with the diversifier axis at its target). You merge it; you still place the trades. <strong>F9: the bot never trades or edits your book.</strong> Numbers are machine-computed each run (no hand-typed evidence).</p>` },
  scout: { title: "Scout — finding NEW scarcities", body: `
    <p>The Research tab re-scores the <em>known</em> scarcities; the <strong>Scout</strong> hunts for <em>new</em> ones. It is deliberately <strong>not</strong> a trend-finder — by the time something reads as a trend it's already priced, and <strong>ALPHA.md</strong> says there's no edge in what's priced. Instead it looks for the <strong>fingerprint of a binding constraint</strong> before anyone names it.</p>
    <p><strong>How (constraint-shadow):</strong> a real shortage shows up first as downstream companies <em>complaining</em> in their SEC filings — "lead times extended", "unable to secure allocation", "qualified a second source". The scout searches that complaint language across all filers, then <strong>clusters which companies are under broad supply stress</strong>, and infers the candidate chokepoint from the <em>pattern of who's complaining</em> — not from a headline.</p>
    <p><strong>Then the same committee vets it.</strong> Each lead is synthesized into a draft scarcity and run through the identical <strong>Bull / Bear / Skeptic → CIO + CRO</strong> committee that scores the known 24. Only candidates that survive that adversarial scrutiny appear here — so you review <em>vetted</em> ideas, not raw noise. Candidates already discussed widely in financial media are down-weighted (the edge is being early, not loud).</p>
    <p>Each card shows the inferred scarcity, the <strong>filer that flagged it</strong> + the constraint phrases that fired, the proposed fields, and the committee's confidence. <strong>Accept</strong> opens a pull request that <em>adds</em> the new scarcity to the watchlist (needs a token in Settings → Admin); you merge it. The scout never edits the watchlist itself (F9) — it only proposes. Runs weekly. Not advice; every candidate is a lead to investigate.</p>` },
  datakeys: { title: "Market-data keys", body: `
    <p>Keyless <strong>Yahoo</strong> (rich history) + <strong>Stooq</strong> (EOD) always run. Adding free keys gives <em>independent cross-check sources</em> so a single bad or synthetic price can't pass silently — when sources disagree &gt;3% the quote is flagged.</p>
    <ul><li><strong>Finnhub</strong> (finnhub.io) — also CORS-friendly, powers the "Check live prices" button here.</li>
    <li><strong>Twelve Data</strong> (twelvedata.com), <strong>Alpha Vantage</strong> (alphavantage.co) — used by the scanner.</li></ul>
    <p>Keys typed here are stored only in this browser. For the <em>automated</em> scanner, also add each as a GitHub repo secret using the exact name shown (e.g. <code>FINNHUB_API_KEY</code>).</p>` },
  dataquality: { title: "Data quality &amp; integrity", body: `
    <p>Every quote is fetched over HTTPS and must be a plausible number, or it's marked errored (never silently filled). The scanner <strong>cross-checks</strong> prices across sources (Yahoo/Stooq + any free keys), flags <strong>⚠</strong> on source divergence &gt;3%, big jumps vs the last scan (&gt;35%), or stale/halted bars.</p>
    <p><strong>Fail-safe:</strong> on a degraded run (too many errors/flags) the auto-triggers (drawdown, sleeve cap) are <em>held</em> — they won't fire on bad data. Add free market-data keys (Settings §3) for stronger corroboration.</p>` },
  admin: { title: "Admin — credentials &amp; configuration", body: `
    <p>One place for every credential. Two tiers:</p>
    <ul><li><strong>Browser keys</strong> (Gemini/Groq/Finnhub/… + dispatch token) — stored only in this browser; power the in-browser digest, live price check, and Refresh.</li>
    <li><strong>Repo configuration + research review</strong> — paste an <strong>admin GitHub token</strong> to (a) <strong>Check configuration</strong> for a ✅/⬜ status of every secret and variable, and (b) <strong>Accept</strong> research proposals on the Research tab (opens a PR). Use a <em>classic</em> token with the <strong>repo</strong> scope, or a <em>fine-grained</em> token with <strong>Contents + Pull requests</strong> (read/write) and <strong>Secrets read / Variables read-write</strong>.</li></ul>
    <p><strong>Variables</strong> (alert email, SEC user-agent, Supabase URL) are non-secret — you can <strong>save them to GitHub right here</strong>. <strong>Secrets</strong> (API keys, SMTP password, Supabase service_role key) are write-only in GitHub for security and can't be set from a static page — the panel shows whether each is configured and links you to GitHub's secrets form to set/rotate them. Everything you paste stays in this browser.</p>
    <p><strong>Price-history DB (optional):</strong> create a Supabase project, run <code>db/schema.sql</code>, set <strong>SUPABASE_URL</strong> here + <strong>SUPABASE_SERVICE_KEY</strong> as a repo secret. The scanner then persists daily price history (used by backtests / metrics / the V2.3 cross-check). The DB is written only by the scanner, never the browser; skip it and nothing else changes.</p>` },
  metrics: { title: "Objective scorecard", body: `
    <p>The app's <strong>objective</strong>: maximize 10-year return while keeping <strong>max drawdown &lt; 35%</strong>, with the best <strong>Calmar</strong> (CAGR ÷ maxDD) and <strong>Sortino</strong> (return ÷ downside risk). This card measures the <em>strategy basket</em> (your target-weighted holdings) over the trailing window the scan has history for — a live read on whether the timing/risk layer is actually holding drawdown under 35% and earning a good risk-adjusted return.</p>
    <ul><li><strong>CAGR</strong> — annualized return. <strong>Max drawdown</strong> — worst peak-to-trough (turns ⚠ red if it breaches −35%).</li>
    <li><strong>Calmar</strong> — return per unit of drawdown (higher = better). <strong>Sortino</strong> — return per unit of <em>downside</em> volatility.</li></ul>
    <p>It's a backward-looking proxy that grows more meaningful as history accumulates; not a forecast. Not advice.</p><p>The <strong>trend-brake backtest</strong> line is on-basket evidence (no look-ahead): it compares max-drawdown and Calmar of a moving-average brake vs. buy-and-hold. The <strong>Brake proof</strong> runs the <em>same</em> 200-DMA brake on deep-history instruments (from the DB) through real ≥20% crashes (2000/2008/2020/2022) — methodology evidence, not this book. The <strong>System backtest (as designed)</strong> then runs the full timing overlay (brake + breadth fast-entry, turnover-costed) on the book's own names three ways — <em>buy-&amp;-hold vs +brake vs +brake+fast-reentry</em> — each checked against the −35% mandate, so you can see exactly what the timing layer does to the drawdown and the CAGR. Selection is held fixed; the alpha selection signal is graded separately by the Track record + the cross-sectional signal backtest.</p>` },
  scorecard: { title: "Track record (self-grading)", body: `
    <p>Puck records every dated <strong>per-name TSMOM tilt</strong> it makes (overweight → expect the stock up over ~21 days; underweight → down), anchored to the price at the time. When the horizon matures, a later scan <strong>resolves</strong> each call against the realized price and updates a <strong>hit-rate</strong>. This is the accountability layer: the system is graded on whether its calls actually came true — converting opinions into a verifiable record that compounds over time.</p>
    <p>It starts empty and fills in as calls resolve (~21 days). A hit-rate persistently below ~50% is the system telling you the signal isn't working — which is exactly what you want to know. Not advice.</p>
    <p>The <strong>Alpha edge</strong> line grades the harder claim: each <strong>de-rating/inflecting</strong> flag becomes a 42-day <em>relative</em> forecast — does the flagged basket actually under/out-perform the Deep-tech build-out complex? That, not raw direction, is the thesis's real edge, and it's scored separately so you can see whether the alpha signal earns its keep.</p>` },
  killcriteria: { title: "Kill-criteria (falsification deadlines)", body: `
    <p>When the research committee accepts a thesis, the CIO must pre-register a <strong>falsifiable, dated kill-criterion</strong> — "this thesis is wrong if <em>X</em> by <em>date</em>." Puck now carries that onto the watchlist and <strong>deadline-tracks</strong> it: at the by-date it records whether the thesis <strong>survived</strong> (still held) or was <strong>killed</strong> (removed), and flags it for you to <strong>adjudicate</strong> whether the free-text condition actually came true.</p>
    <p>The free-text condition isn't machine-graded (so it never inflates the price-based hit-rate) — this is the honest part: it holds the committee to its <em>own</em> deadlines and surfaces the ones that need a human verdict, instead of recording a falsification promise and quietly forgetting it. <strong>pending</strong> = deadline not yet reached; <strong>need adjudication</strong> = matured, your call. Not advice.</p>` },
  alpha: { title: "De-rating / inflecting (alpha signal)", body: `\n    <p>Operationalizes the thesis's core claim: <strong>crowded/already-priced scarcities de-rate first; under-priced ones inflect.</strong> For each scarcity we measure its basket's <strong>relative strength vs the Deep-tech build-out complex</strong> (the theme ETFs). A <strong>crowded</strong> thesis losing relative strength is flagged <strong>↓ de-rating</strong> (reduce); an <strong>under-priced</strong> thesis gaining is <strong>↑ inflecting</strong> (accumulate). It's the relative move + the priced-in context — the closest thing here to a tradable edge, and the scorecard grades whether it works. Not advice.</p>
    <p><strong>Auto-relabel (honesty gate):</strong> the edge is automatically stamped <strong>factor-adjusted: alpha</strong> or <strong>beta — NOT alpha</strong> using the current factor attribution below. So even a strong forward hit-rate is shown as <em>beta</em> when the regression says the return is just market + momentum + theme exposure — a good track record can't masquerade as skill.</p>` },
  sigbacktest: { title: "Signal backtest (historical, cross-sectional)", body: `\n    <p>The live Track record is unbiased but slow (a few resolved calls per quarter). This complements it by testing the same idea on <strong>history</strong>: across the scarcity baskets and many dates, does a basket's <strong>trailing relative strength vs the Deep-tech build-out complex predict its forward relative return?</strong> We report the rank <strong>IC</strong> (information coefficient; &gt;0 means the signal has predictive ordering) and the directional <strong>hit-rate</strong> with a 95% confidence interval — wide when the sample is small, which is honest.</p>
    <p><strong>Big caveat (why it's an upper bound):</strong> the basket→ticker membership is today's map — these names were chosen in 2026 partly <em>because</em> they worked, so the universe carries selection/survivorship bias and the true edge is lower than this reads. Prices themselves are strictly point-in-time (trailing windows never peek into the future). Treat this as "has the signal logic worked on these names," and let the live ledger be the unbiased verdict. Not advice.</p>` },
  attribution: { title: "Factor attribution — alpha or just beta?", body: `\n    <p>The honesty gate's teeth. A high hit-rate or a rising basket is <em>not</em> proof of skill — the book could simply be loaded on factors anyone can buy. So we regress the basket's daily return on a small set of <strong>tradeable factors: market (SPY), momentum (MTUM), and — crucially — a thematic proxy (QQQ).</strong> The <strong>intercept is the residual alpha</strong>: the return left over <em>after</em> market, momentum, and the AI/tech theme are accounted for. Including the theme leg is the whole point — without it, this single-factor Deep-tech build-out book's beta would masquerade as alpha.</p>
    <p>The verdict is <strong>"genuine alpha"</strong> only when that residual is positive <em>and</em> statistically significant (|t| ≥ 2, ~95%); otherwise it's <strong>"factor/beta — not alpha"</strong> and the app says so plainly. We also show the simple absolute check: did the book beat just buying <strong>QQQ</strong>? Caveat: with limited, partly-foreign history the estimate is noisy for a while (small <em>n</em>, wide error) — treat early readings as indicative. This is a current-window factor read, complementary to the forward-graded Track record. Not advice.</p>` },
  dislocation: { title: "Dislocation timing — when to act", body: `
    <p>Answers one question: <strong>when should I take advantage of a dislocation?</strong> A dislocation is a name mechanically sold off (off highs, below trend) <em>while its structural thesis is intact</em> (forced-flow <strong>✚ accumulate</strong>, Edge 3). The danger is buying one while it's still falling — a falling knife.</p>
    <p>So the verdict is <strong>ACT NOW</strong> only when a thesis-intact dislocation exists <em>and</em> timing has turned constructive — any of: the <strong>drawdown trigger</strong> fired (dry powder release), the <strong>V2.3-style trend re-confirmed</strong> (FULL on QQQ), or Puck's <strong>20-DMA fast re-entry</strong> is firing. Otherwise <strong>WAIT</strong> for the turn.</p>
    <p>The <strong>V2.3 cross-check</strong> is a <strong>faithful replica</strong> of your F+C Thrust rule, recomputed on QQQ: <em>CRASH_OFF</em> (252-day return &lt; 0 AND 60-day vol &gt; 25%) → SGOV; else <em>TREND</em> (above 200-DMA) → QLD; else <em>THRUST</em> (above a rising 20-DMA) → QLD; else SGOV — with the <strong>exit-only composite-stress overlay</strong> (VIX/VIX3M ≥ 1.0 for 3 days AND HY-velocity in the top 5% of its 252-day distribution) forcing QLD→SGOV. It shows which instrument V2.3 holds and whether it <strong>✓ agrees</strong> or <strong>⚠ diverges</strong> with Puck's regime. Puck itself adds <strong>no leverage</strong> — a 2× QLD sleeve would breach the −35% maxDD objective unless gated by a full exit to cash. Not advice.</p>` },
  chokepoints: { title: "Inaccessible chokepoints", body: `
    <p>The thesis's sharpest idea: <strong>the best chokepoints are inaccessible</strong> — private (SpaceX, Physical Intelligence), foreign (ASML, Ajinomoto, Harmonic Drive), or impaired (a chokepoint isn't a rent — Wolfspeed went bankrupt owning one). There's no clean ETF, so the app does the next best thing: it <strong>discovers the public proxies</strong> exposed to each bottleneck by searching <strong>SEC filings</strong> for who mentions it (customers/suppliers/partners). They're ranked by <strong>specificity</strong> (TF-IDF), not raw mention count: a diversified megacap that mentions everything once in boilerplate is a <em>weak</em> proxy and is dimmed + flagged ⚠ generic, while a concentrated pure-play is surfaced first. The <strong>score</strong> (0–1) is how specific the exposure looks — all data-derived, no hand-picked lists.</p>
    <ul><li><strong>access</strong> — private / foreign / impaired.</li>
    <li><strong>heat</strong> — market attention + proxy momentum (0–100); <strong>proxy rel</strong> — the seeded proxies' strength vs the Deep-tech build-out complex.</li>
    <li><strong>Discovered</strong> — public companies whose SEC filings mention the entity (your tradable exposure), with mention counts.</li>
    <li><strong>🕸 Cross-chokepoint hubs</strong> — second-order mapping: public names that show up across <em>multiple</em> bottlenecks (×degree). A <strong>hub</strong> (≥3) is a diversified "picks-and-shovels" way to play the whole complex; a degree-1 name is a concentrated pure play. The exposure structure the market doesn't index.</li></ul>
    <p>This is the differentiated, hard-to-replicate layer — turning "no clean ETF, sorry" into "here's the best obtainable read." Not advice; discovered proxies are leads to research, not recommendations.</p>` },
  stress: { title: "Stress test", body: `\n    <p>Applies the thesis's named shocks to YOUR sleeve (your positions × latest prices) and shows the drawdown vs the <strong>−35% objective limit</strong>: the 2027–28 Deep-tech build-out digestion (the basket's shared failure mode), a 2022-style rate shock, a broad recession, and a China rare-earth 'peace' (subsidy-floor names re-rate). Shock vectors are coarse and documented (high-beta assumptions), not fitted — a feel for tail risk, not a prediction. Runs entirely in your browser. Not advice.</p>` },
  dca: { title: "DCA progress", body: `
    <p>Tracks how much of each holding's <strong>target</strong> you've actually <strong>deployed</strong> (shares × cost basis from your Settings positions), against the 9-month dollar-cost-averaging calendar. The bar + % shows progress to target; the card shows the sleeve total deployed. Helps you stay on the plan and see where dry powder still needs to go.</p>` },
  settings: { title: "Settings &amp; onboarding", body: `
    <p>Everything here lives <strong>only in this browser</strong> (localStorage) — never committed. Add your holdings per account (ticker/shares/cost basis), your dry-powder cash, and free API keys. Export your positions to <code>positions.local.json</code> for the scanner's trim/sleeve math. Keys: Gemini (aistudio.google.com) and Groq (console.groq.com) are free.</p>` },
};
function openHelp(key) {
  const h = HELP[key]; if (!h) return;
  $("#helpTitle").innerHTML = h.title; $("#helpBody").innerHTML = h.body;
  $("#helpModal").classList.remove("hidden");
}
$("#helpClose").onclick = () => $("#helpModal").classList.add("hidden");
$("#helpModal").onclick = (e) => { if (e.target.id === "helpModal") $("#helpModal").classList.add("hidden"); };
document.addEventListener("click", (e) => { const b = e.target.closest("[data-help]"); if (b) openHelp(b.dataset.help); });

maybeOnboard();
load();
