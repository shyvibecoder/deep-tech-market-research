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
  const [scar, port, trig, sig, dca, proposals] = await Promise.all(
    ["scarcities", "portfolio", "triggers", "signals", "dca", "research-proposals"].map((f) =>
      fetch(`data/${f}.json${f === "signals" || f === "research-proposals" ? bust() : ""}`).then((r) => r.json()).catch(() => ({})))
  );
  return { scar, port, trig, sig, dca, proposals };
}

async function load() {
  DATA = await fetchData();
  render();
}

const POSTURE = {
  "risk-on": ["pos", "🟢 RISK-ON"], neutral: ["", "⚪ NEUTRAL"],
  caution: ["", "🟠 CAUTION — brakes"], defensive: ["neg", "🔴 DEFENSIVE — cash"], unknown: ["", "POSTURE —"],
};

function render() {
  const sig = DATA.sig;
  $("#scanned").textContent = sig?.scanned_at ? `· last scan ${new Date(sig.scanned_at).toLocaleString()}` : "";
  const reg = sig?.regime; const pill = $("#posturePill");
  if (pill) {
    const [cls, lbl] = POSTURE[reg?.posture] || POSTURE.unknown;
    pill.className = `posture ${reg?.posture || "unknown"}`;
    pill.textContent = reg ? `${lbl}${reg.risk_score != null ? ` ${reg.risk_score}/100` : ""}` : "";
  }
  renderStale(sig); renderRadar(); renderTimeline(); renderPortfolio(); renderV23(); renderCatalysts(); renderChokepoints(); renderResearch(); renderDigest();
}

// Research review: show the LLM's proposed scarcity reassessments as before→after diffs with an
// Accept/Reject control. Accept opens a PR via the user's admin token (F9-guarded in-browser to
// bot-owned fields only). The view model + the guarded mutation live in research-review.mjs (tested).
function renderResearch() {
  const box = $("#researchReview"); if (!box) return;
  const RR = window.PuckResearch;
  const doc = DATA.proposals;
  if (!RR || !doc?.proposals?.length || !DATA.scar?.scarcities) { box.innerHTML = ""; return; }
  const diffs = RR.proposalDiffs(doc.proposals, DATA.scar);
  if (!diffs.length) { box.innerHTML = `<p class="foot">No open research proposals (last run ${esc(doc.generated || "—")} proposed no changes).</p>`; return; }
  box.innerHTML = `<h3>Research proposals <button class="help" data-help="research">?</button> <span class="foot">— LLM-proposed reassessments (prompt v${esc(String(doc.prompt_version ?? "?"))}); you approve. Bot-owned fields only.</span></h3>` +
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
    const brakes = reg?.posture === "defensive" || reg?.posture === "caution" || reg?.macro_stressed;
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
        // Flag where the live tape materially disagrees with the human priced-in label (informative).
        const diverge = sig && sig.live_gate != null && Math.abs(sig.live_gate - sig.static_gate) >= 0.3
          ? `<span class="diverge" title="tape disagrees with the priced-in label: live gate ${sig.live_gate} vs label ${sig.static_gate}">${sig.live_gate > sig.static_gate ? "↑tape" : "↓tape"}</span>` : "";
        const oppCell = opp == null ? "—"
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
        tr.innerHTML = `<td><strong>${esc(s.scarcity)}</strong>${s.non_consensus ? '<span class="nc">◆ non-consensus</span>' : ""}${alphaMark}${ffMark}${driftMark}<br><span style="color:var(--mut)">${esc(s.thesis)}</span></td>
          <td class="opp-cell">${oppCell}</td>
          <td>${esc(s.sector)}</td><td><span class="pill ${cls}">${lbl}</span></td>
          <td class="pi-${esc(s.priced_in)}">${esc(s.priced_in)}</td><td>${esc(s.durability)}</td><td>${esc(s.substitution_risk)}</td>
          <td>${crowd == null ? "—" : crowd}</td><td style="font-size:11px">${esc(s.tickers.join(", "))}</td>`;
        tb.appendChild(tr);
      });
  };
  sel.onchange = draw; $("#ncOnly").onchange = draw; draw();
}

function renderTimeline() {
  const g = $("#timelineGrid"); g.className = "tcol"; g.innerHTML = "";
  Object.entries(WIN).forEach(([key, [cls, lbl]]) => {
    const col = document.createElement("div");
    col.innerHTML = `<h4><span class="pill ${cls}">${lbl}</span></h4>`;
    DATA.scar.scarcities.filter((s) => s.bind_window === key).forEach((s) => {
      const d = document.createElement("div"); d.className = "item";
      d.innerHTML = `<strong>${s.scarcity}</strong><br><span style="color:var(--mut)">${s.sector} · priced-in: <span class="pi-${s.priced_in}">${s.priced_in}</span></span>`;
      col.appendChild(d);
    });
    g.appendChild(col);
  });
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
  const apHtml = ap ? `<div class="acctpol"><span><strong>IRA/Roth:</strong> ${ap.ira}</span><span><strong>Taxable:</strong> ${ap.taxable}</span></div>` : "";
  box.innerHTML = `<div><strong>Timing posture: ${lbl}${r.risk_score != null ? ` · risk ${r.risk_score}/100${r.confidence ? ` (${r.confidence} conf)` : ""}` : ""}${r.version ? ` · v${r.version}` : ""} <button class="help" data-help="regime">?</button></strong>
      <span>${r.action || ""}</span></div>
    ${apHtml}
    <div class="rnote">${r.note || ""}<br><em>Alpha = scarcity thesis · timing = trend+momentum+vol+drawdown+macro overlay, on the ETF composite${r.composite_basis?.length ? ` (${r.composite_basis.join(", ")})` : ""}. ${r.basis || ""}. ${r.confidence_note ? "⚠ " + r.confidence_note + ". " : ""}Not advice.</em></div>`;
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
  // Proof-of-edge: the de-rating/inflecting alpha calls graded RELATIVE to the AI-capex complex.
  const bs = sc?.by_signal, alphaN = (bs?.underperform?.n || 0) + (bs?.outperform?.n || 0);
  const scAlpha = bs ? `<p class="foot">Alpha edge (de-rating/inflecting, graded vs the complex): ${alphaN ? `de-rating ${bs.underperform?.hits || 0}/${bs.underperform?.n || 0}, inflecting ${bs.outperform?.hits || 0}/${bs.outperform?.n || 0} correct over ${alphaN} resolved relative calls` : "building — first relative calls resolve in ~42 days"} <button class="help" data-help="alpha">?</button></p>` : "";
  if (!m) { box.innerHTML = `<h3>Track record <button class="help" data-help="scorecard">?</button></h3>${scLine}${scAlpha}`; return; }
  box.innerHTML = `<h3>Objective scorecard <button class="help" data-help="metrics">?</button> <span class="foot">— ${esc(m.note || "")} ${esc(m.window || "")}</span></h3>
    <div class="cards">
      <div class="card"><b>${pct(m.cagr)}</b><span>CAGR (trailing)</span></div>
      <div class="card ${m.breaches_35 ? "dq-bad" : ""}"><b>${pct(m.max_drawdown)}</b><span>max drawdown ${m.breaches_35 ? "⚠ &gt;35%" : "✓ &lt;35%"}</span></div>
      <div class="card"><b>${num(m.calmar)}</b><span>Calmar (CAGR÷maxDD)</span></div>
      <div class="card"><b>${num(m.sortino)}</b><span>Sortino</span></div>
    </div>${m.backtest ? `<p class="foot">Trend-brake backtest (${m.backtest.n}d, ${m.backtest.ma_period}-day MA, no look-ahead): max-DD <strong>${(m.backtest.braked.max_drawdown*100).toFixed(0)}%</strong> braked vs ${(m.backtest.unbraked.max_drawdown*100).toFixed(0)}% buy&amp;hold (−${(m.backtest.dd_reduction*100).toFixed(0)} pts); Calmar ${num(m.backtest.braked.calmar)} vs ${num(m.backtest.unbraked.calmar)}; ${m.backtest.whipsaws} switches, ${Math.round(m.backtest.time_in_market*100)}% in market.</p>` : ""}${scLine}${scAlpha}`;
}

function renderSizing() {
  const box = $("#sizingBox"); if (!box) return;
  const td = window.targetDeltas, reg = DATA.sig?.regime, per = reg?.per_name;
  if (!td || !per || !reg || reg.posture === "unknown") { box.innerHTML = ""; return; }
  const rows = td(DATA.port?.holdings || [], per, reg).filter((x) => x.action === "add" || x.action === "trim");
  box.innerHTML = `<h3>Suggested IRA tilts <button class="help" data-help="sizing">?</button> <span class="foot">— per-name TSMOM × regime, bounded ±25%, tactical (IRA) sleeve only</span></h3>` +
    (rows.length ? `<table class="mine"><thead><tr><th>Ticker</th><th>Tilt</th><th>Δ weight</th><th>Action</th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.ticker)}</strong></td><td>${esc(r.tilt)}</td><td class="${r.delta_pct >= 0 ? "pos" : "neg"}">${r.delta_pct > 0 ? "+" : ""}${r.delta_pct}%</td><td>${r.action}</td></tr>`).join("")}</tbody></table>`
      : `<p class="foot">No active tilts (regime isn't risk-on and nothing is flagged underweight).</p>`);
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
  renderMetrics();
  renderMyHoldings();
  renderDca();
  renderStress();
  renderSizing();
  const p = DATA.port;
  $("#portSummary").innerHTML = `
    <div class="card"><b>${fmtUsd(p.sleeve_usd)}</b><span>sleeve (~${Math.round(p.sleeve_usd / p.total_portfolio_usd * 100)}% of ${fmtUsd(p.total_portfolio_usd)})</span></div>
    <div class="card"><b>${fmtUsd(p.accounts.ira)}</b><span>IRA / 401k</span></div>
    <div class="card"><b>${fmtUsd(p.accounts.taxable)}</b><span>taxable</span></div>
    <div class="card"><b>${p.holdings.filter(h=>h.tier!=='DRY').length}</b><span>holdings + dry powder</span></div>
    ${DATA.sig?.data_quality ? `<div class="card ${DATA.sig.data_quality.ok?'':'dq-bad'}"><b>${DATA.sig.data_quality.ok?'✓ OK':'⚠ degraded'} <button class="help" data-help="dataquality">?</button></b><span>data quality · ${DATA.sig.data_quality.note}</span></div>` : ""}`;

  const tg = $("#triggers"); tg.innerHTML = "";
  DATA.trig.triggers.forEach((t) => {
    const live = DATA.sig?.trigger_status?.[t.id];
    let state = t.status; if (live?.fired) state = "fired";
    // Show the value inline only when it's a compact number (e.g. drawdown %); the
    // note carries formatted dollar figures (sleeve value) to avoid raw long numbers.
    const showVal = live?.value != null && Math.abs(live.value) < 1000;
    const d = document.createElement("div"); d.className = `trig ${state}`;
    d.innerHTML = `<span class="badge">${state}${showVal ? ` · ${live.value}` : ""}</span><strong>${t.name}</strong><br>
      <span style="color:var(--mut)">${t.type} · ${t.action}${live?.note ? ` <em>(${live.note})</em>` : ""}</span>`;
    tg.appendChild(d);
  });

  const tb = $("#holdings tbody"); tb.innerHTML = "";
  p.holdings.forEach((h) => {
    const Q = q(h.ticker);
    const ytd = Q?.ytd, off = Q?.pct_off_high;
    const tr = document.createElement("tr");
    const warn = Q?.flags?.length ? `<span class="dq-warn" title="${Q.flags.join("; ")}">⚠</span>` : "";
    tr.innerHTML = `<td><strong>${h.ticker}</strong>${warn}</td><td>${h.name}</td><td>${h.account}</td>
      <td>${fmtUsd(h.target_usd)}</td><td>${(h.weight*100).toFixed(1)}%</td><td>${h.tier}</td>
      <td>${Q?.price ? "$" + Q.price.toFixed(2) : "—"}</td>
      <td class="${ytd>=0?'pos':'neg'}">${fmtPct(ytd)}</td>
      <td class="${off<0?'neg':''}">${fmtPct(off)}</td>
      <td class="${Q?.pct_vs_ma200>=0?'pos':'neg'}">${fmtPct(Q?.pct_vs_ma200)}</td>
      <td>${Q?.forward_pe ? Q.forward_pe.toFixed(1) + "x" : "—"}</td><td style="color:var(--mut)">${h.role}</td>`;
    tb.appendChild(tr);
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
  $("#digestBox").textContent = DATA.sig?.digest || "(no digest yet — run the scanner)";
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
    tr.innerHTML = `<td><strong>${t}</strong></td><td>${h.account || "—"}</td><td>${h.shares ?? "—"}</td><td>${h.cost_basis != null ? "$" + h.cost_basis : "—"}</td>
      <td><button data-rm="${t}" class="danger sm">✕</button></td>`;
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
      for (const [t, h] of Object.entries(j.positions || {})) p.positions[t] = { account: h.account || p.positions[t]?.account || "ira", shares: h.shares, cost_basis: h.cost_basis };
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
  let total = 0; const acc = { ira: 0, taxable: 0 }; const rows = []; let excludedFx = 0;
  for (const [t, h] of entries) {
    const Q = DATA.sig?.quotes?.[t];
    const price = Q && !Q.error ? Q.price : null;
    const mv = price && h.shares ? price * h.shares : null;
    // U2: the browser has no FX rates → exclude non-USD lots from the sleeve total
    // (the scanner's server-side sleeve value FX-converts them). Never mis-sum as USD.
    const isUsd = !Q?.currency || Q.currency === "USD";
    if (mv && isUsd) { total += mv; if (acc[h.account] != null) acc[h.account] += mv; }
    else if (mv && !isUsd) excludedFx++;
    const gain = price && h.cost_basis ? price / h.cost_basis - 1 : null;
    const tgt = targets[t];
    const rb = rebalMap[t];
    const rbCell = rb?.flagged ? `<span class="${rb.action==='trim'?'neg':'pos'}">⚖ ${rb.action} (${rb.drift>0?'+':''}${rb.drift}%)</span>` : (rb ? "in band" : "—");
    rows.push(`<tr><td><strong>${t}</strong></td><td>${h.account}</td><td>${h.shares ?? "—"}</td>
      <td>${price ? "$" + price.toFixed(2) : "—"}</td><td>${mv ? fmtUsd(mv) : "—"}</td>
      <td class="${gain>=0?'pos':'neg'}">${gain==null?"—":(gain*100).toFixed(0)+"%"}</td>
      <td>${tgt ? Math.round((mv||0)/tgt*100)+"% of target" : "—"}</td><td>${rbCell}</td></tr>`);
  }
  const capPct = Math.round(total / cap * 100);
  box.innerHTML = `<h3>Your holdings (live) <button class="help" data-help="myholdings">?</button> <span class="foot">— from your browser-stored positions × latest scan prices</span></h3>
    <div class="cards">
      <div class="card"><b>${fmtUsd(total)}</b><span>sleeve value (${capPct}% of $${(cap/1e6).toFixed(2)}mm cap)${excludedFx ? ` · ${excludedFx} foreign lot${excludedFx>1?"s":""} excluded` : ""}</span></div>
      <div class="card"><b>${fmtUsd(acc.ira)}</b><span>IRA/Roth</span></div>
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
  const model = "gemini-2.0-flash";
  const call = async (prompt) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${k.gemini}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    return (await r.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
  if (!t) { alert("Open Settings → Admin and paste a GitHub token (Contents: read/write, Pull requests: read/write) first."); return; }
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
    alert(`Could not open PR: ${e.message}. The token needs Contents: read/write + Pull requests: read/write on ${REPO}.`);
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
    <ul><li><strong>Scarcity radar / Timeline</strong> — what's scarce, when it binds, and how priced-in it already is.</li>
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
    <p>Filter by sector or to non-consensus only. The four structural sources of retail alpha — duration mispricing, inaccessibility, forced-flow, and discipline — are documented in <strong>ALPHA.md</strong>.</p>` },
  triggers: { title: "Deploy / exit triggers", body: `
    <p>Rules that tell you to act. Each shows a state: <strong>armed</strong> (active, watching), <strong>monitor</strong> (manual watch), or <strong>fired</strong> (condition met).</p>
    <ul><li><strong>Drawdown</strong> (auto) — complex down ≥20–25% from highs → deploy dry powder.</li>
    <li><strong>Trim rule</strong> (auto) — a name &gt;2× cost basis AND &gt;50× forward P/E → trim ⅓ (needs your cost basis from Settings).</li>
    <li><strong>Sleeve cap</strong> (auto) — sleeve value &gt; ~$1.72mm → trim back (needs your holdings from Settings).</li>
    <li><strong>Policy triggers</strong> (manual) — e.g. rare-earth/uranium policy shifts.</li></ul>
    <p>When a trigger fires, the scanner opens a GitHub issue (deduped).</p>` },
  holdings: { title: "Holdings table", body: `
    <p>Your <em>target</em> plan per holding. <strong>Tier</strong> = deployment pace (A=100% now; B=50% now+months 1–3; C=25% now+DCA to month 9; D=small option; DRY=cash).</p>
    <ul><li><strong>YTD / % off high</strong> — momentum &amp; drawdown.</li>
    <li><strong>vs 200-DMA</strong> — trend filter; positive = above the 200-day average (healthier trend).</li>
    <li><strong>Fwd P/E</strong> — forward earnings multiple (skipped for ETFs). Reminds you "went up a lot" ≠ "expensive".</li></ul>
    <p>Add your <em>actual</em> holdings in ⚙ Settings to see live market value vs target.</p>` },
  regime: { title: "Timing posture (regime)", body: `
    <p>The <strong>alpha</strong> is the scarcity thesis; this is the <strong>timing</strong> overlay — when to deploy/go-all-in vs. apply the brakes into cash. It is built on <em>independent, replicated research</em> (Faber 200-DMA trend; Moskowitz-Ooi-Pedersen time-series momentum; Moreira-Muir volatility; Hurst-Ooi-Pedersen trend), <strong>not</strong> a curve-fit backtest.</p>
    <ul><li>🟢 <strong>risk-on</strong> — uptrend + momentum, contained vol → deploy / accelerate.</li>
    <li>⚪ <strong>neutral</strong> — stick to the DCA calendar.</li>
    <li>🟠 <strong>caution</strong> — tap the brakes, build dry powder.</li>
    <li>🔴 <strong>defensive</strong> — favor cash; deploy only into the drawdown trigger.</li></ul>
    <p>Two overlays sit on top (Timing v2): a <strong>macro-stress brake</strong> that forces defensive only when the <strong>VIX term-structure is inverted AND high-yield credit is widening fast</strong> (a rare, leading combined signal — exit-only, it can only de-risk), and a <strong>20-DMA fast re-entry</strong> that re-risks one notch when most names reclaim their 20-day average (so you don't stay defensive too long after a bottom).</p>
    <p><strong>v2</strong> refinements: the signal is computed on the <em>theme ETFs</em> (a cleaner composite than averaging 19 noisy single names); it's <strong>account-aware</strong> — the posture drives your <strong>IRA/Roth</strong> (tactical, tax-free turnover) while <strong>taxable</strong> stays buy-and-hold anchors; and it carries a <strong>per-name TSMOM tilt</strong> (which names to lean into vs. trim).</p>
    <p>It's a risk dial that paces your DCA, not an all-in/all-out switch. Full detail: REGIME.md.</p>` },
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
    <p>An optional LLM "analyst + red-team" summary of what changed (quotes, filings, news, regime). With <strong>two</strong> free keys it's <em>cross-model</em> — the analyst runs on one model and the red-team on another, so it isn't a model grading itself. Set keys in ⚙ Settings (in-browser, Gemini) or as GitHub repo secrets (automated scanner).</p>` },
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
    <li><strong>Repo configuration</strong> — what the automated GitHub Actions scanner uses. Paste an <strong>admin GitHub token</strong> (fine-grained: Secrets <em>read</em>, Variables <em>read/write</em>) and click <strong>Check configuration</strong> to see a ✅/⬜ status for every secret and variable.</li></ul>
    <p><strong>Variables</strong> (alert email, SEC user-agent, Supabase URL) are non-secret — you can <strong>save them to GitHub right here</strong>. <strong>Secrets</strong> (API keys, SMTP password, Supabase service_role key) are write-only in GitHub for security and can't be set from a static page — the panel shows whether each is configured and links you to GitHub's secrets form to set/rotate them. Everything you paste stays in this browser.</p>
    <p><strong>Price-history DB (optional):</strong> create a Supabase project, run <code>db/schema.sql</code>, set <strong>SUPABASE_URL</strong> here + <strong>SUPABASE_SERVICE_KEY</strong> as a repo secret. The scanner then persists daily price history (used by backtests / metrics / the V2.3 cross-check). The DB is written only by the scanner, never the browser; skip it and nothing else changes.</p>` },
  metrics: { title: "Objective scorecard", body: `
    <p>The app's <strong>objective</strong>: maximize 10-year return while keeping <strong>max drawdown &lt; 35%</strong>, with the best <strong>Calmar</strong> (CAGR ÷ maxDD) and <strong>Sortino</strong> (return ÷ downside risk). This card measures the <em>strategy basket</em> (your target-weighted holdings) over the trailing window the scan has history for — a live read on whether the timing/risk layer is actually holding drawdown under 35% and earning a good risk-adjusted return.</p>
    <ul><li><strong>CAGR</strong> — annualized return. <strong>Max drawdown</strong> — worst peak-to-trough (turns ⚠ red if it breaches −35%).</li>
    <li><strong>Calmar</strong> — return per unit of drawdown (higher = better). <strong>Sortino</strong> — return per unit of <em>downside</em> volatility.</li></ul>
    <p>It's a backward-looking proxy that grows more meaningful as history accumulates; not a forecast. Not advice.</p><p>The <strong>trend-brake backtest</strong> line is on-basket evidence (no look-ahead): it compares max-drawdown and Calmar of a moving-average brake vs. buy-and-hold over the available window — the timing dial's premise, tested rather than asserted.</p>` },
  scorecard: { title: "Track record (self-grading)", body: `
    <p>Puck records every dated <strong>per-name TSMOM tilt</strong> it makes (overweight → expect the stock up over ~21 days; underweight → down), anchored to the price at the time. When the horizon matures, a later scan <strong>resolves</strong> each call against the realized price and updates a <strong>hit-rate</strong>. This is the accountability layer: the system is graded on whether its calls actually came true — converting opinions into a verifiable record that compounds over time.</p>
    <p>It starts empty and fills in as calls resolve (~21 days). A hit-rate persistently below ~50% is the system telling you the signal isn't working — which is exactly what you want to know. Not advice.</p>
    <p>The <strong>Alpha edge</strong> line grades the harder claim: each <strong>de-rating/inflecting</strong> flag becomes a 42-day <em>relative</em> forecast — does the flagged basket actually under/out-perform the AI-capex complex? That, not raw direction, is the thesis's real edge, and it's scored separately so you can see whether the alpha signal earns its keep.</p>` },
  alpha: { title: "De-rating / inflecting (alpha signal)", body: `\n    <p>Operationalizes the thesis's core claim: <strong>crowded/already-priced scarcities de-rate first; under-priced ones inflect.</strong> For each scarcity we measure its basket's <strong>relative strength vs the AI-capex complex</strong> (the theme ETFs). A <strong>crowded</strong> thesis losing relative strength is flagged <strong>↓ de-rating</strong> (reduce); an <strong>under-priced</strong> thesis gaining is <strong>↑ inflecting</strong> (accumulate). It's the relative move + the priced-in context — the closest thing here to a tradable edge, and the scorecard grades whether it works. Not advice.</p>` },
  dislocation: { title: "Dislocation timing — when to act", body: `
    <p>Answers one question: <strong>when should I take advantage of a dislocation?</strong> A dislocation is a name mechanically sold off (off highs, below trend) <em>while its structural thesis is intact</em> (forced-flow <strong>✚ accumulate</strong>, Edge 3). The danger is buying one while it's still falling — a falling knife.</p>
    <p>So the verdict is <strong>ACT NOW</strong> only when a thesis-intact dislocation exists <em>and</em> timing has turned constructive — any of: the <strong>drawdown trigger</strong> fired (dry powder release), the <strong>V2.3-style trend re-confirmed</strong> (FULL on QQQ), or Puck's <strong>20-DMA fast re-entry</strong> is firing. Otherwise <strong>WAIT</strong> for the turn.</p>
    <p>The <strong>V2.3 cross-check</strong> is a <strong>faithful replica</strong> of your F+C Thrust rule, recomputed on QQQ: <em>CRASH_OFF</em> (252-day return &lt; 0 AND 60-day vol &gt; 25%) → SGOV; else <em>TREND</em> (above 200-DMA) → QLD; else <em>THRUST</em> (above a rising 20-DMA) → QLD; else SGOV — with the <strong>exit-only composite-stress overlay</strong> (VIX/VIX3M ≥ 1.0 for 3 days AND HY-velocity in the top 5% of its 252-day distribution) forcing QLD→SGOV. It shows which instrument V2.3 holds and whether it <strong>✓ agrees</strong> or <strong>⚠ diverges</strong> with Puck's regime. Puck itself adds <strong>no leverage</strong> — a 2× QLD sleeve would breach the −35% maxDD objective unless gated by a full exit to cash. Not advice.</p>` },
  chokepoints: { title: "Inaccessible chokepoints", body: `
    <p>The thesis's sharpest idea: <strong>the best chokepoints are inaccessible</strong> — private (SpaceX, Physical Intelligence), foreign (ASML, Ajinomoto, Harmonic Drive), or impaired (a chokepoint isn't a rent — Wolfspeed went bankrupt owning one). There's no clean ETF, so the app does the next best thing: it <strong>discovers the public proxies</strong> exposed to each bottleneck by searching <strong>SEC filings</strong> for who mentions it (customers/suppliers/partners). They're ranked by <strong>specificity</strong> (TF-IDF), not raw mention count: a diversified megacap that mentions everything once in boilerplate is a <em>weak</em> proxy and is dimmed + flagged ⚠ generic, while a concentrated pure-play is surfaced first. The <strong>score</strong> (0–1) is how specific the exposure looks — all data-derived, no hand-picked lists.</p>
    <ul><li><strong>access</strong> — private / foreign / impaired.</li>
    <li><strong>heat</strong> — market attention + proxy momentum (0–100); <strong>proxy rel</strong> — the seeded proxies' strength vs the AI-capex complex.</li>
    <li><strong>Discovered</strong> — public companies whose SEC filings mention the entity (your tradable exposure), with mention counts.</li>
    <li><strong>🕸 Cross-chokepoint hubs</strong> — second-order mapping: public names that show up across <em>multiple</em> bottlenecks (×degree). A <strong>hub</strong> (≥3) is a diversified "picks-and-shovels" way to play the whole complex; a degree-1 name is a concentrated pure play. The exposure structure the market doesn't index.</li></ul>
    <p>This is the differentiated, hard-to-replicate layer — turning "no clean ETF, sorry" into "here's the best obtainable read." Not advice; discovered proxies are leads to research, not recommendations.</p>` },
  sizing: { title: "Suggested IRA tilts", body: `\n    <p>Turns the per-name <strong>TSMOM tilt</strong> (overweight/underweight) and the <strong>regime</strong> into concrete, bounded allocation deltas: <strong>add</strong> overweights only when the regime is risk-on (don't accelerate into weakness), <strong>trim</strong> underweights in any regime, and leave the <strong>taxable</strong> sleeve as buy-and-hold anchors. Deltas are capped at ±25% of target weight. The last mile from analysis to allocation — graded by the Track record. Not advice.</p>` },
  stress: { title: "Stress test", body: `\n    <p>Applies the thesis's named shocks to YOUR sleeve (your positions × latest prices) and shows the drawdown vs the <strong>−35% objective limit</strong>: the 2027–28 AI-capex digestion (the basket's shared failure mode), a 2022-style rate shock, a broad recession, and a China rare-earth 'peace' (subsidy-floor names re-rate). Shock vectors are coarse and documented (high-beta assumptions), not fitted — a feel for tail risk, not a prediction. Runs entirely in your browser. Not advice.</p>` },
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
document.addEventListener("click", (e) => { const b = e.target.closest(".help[data-help]"); if (b) openHelp(b.dataset.help); });

maybeOnboard();
load();
