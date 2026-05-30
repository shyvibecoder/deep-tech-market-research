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
  const [scar, port, trig, sig] = await Promise.all(
    ["scarcities", "portfolio", "triggers", "signals"].map((f) =>
      fetch(`data/${f}.json${f === "signals" ? bust() : ""}`).then((r) => r.json()).catch(() => ({})))
  );
  return { scar, port, trig, sig };
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
  renderStale(sig); renderRadar(); renderTimeline(); renderPortfolio(); renderCatalysts(); renderDigest();
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
    DATA.scar.scarcities
      .filter((s) => (!f || s.sector === f) && (!nc || s.non_consensus))
      .sort((a, b) => Object.keys(WIN).indexOf(a.bind_window) - Object.keys(WIN).indexOf(b.bind_window))
      .forEach((s) => {
        const cz = s.tickers.map((t) => q(t)?.crowding).filter((x) => x != null);
        const crowd = cz.length ? Math.round(cz.reduce((a, b) => a + b) / cz.length) : null;
        const [cls, lbl] = WIN[s.bind_window] || ["", s.bind_window];
        const dr = DATA.sig?.scarcity_drift?.[s.id];
        const driftMark = dr
          ? `<span class="drift" title="since ${dr.since}">▲ drift: priced-in ${dr.priced_in[0]}→${dr.priced_in[1]}</span>`
          : "";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><strong>${s.scarcity}</strong>${s.non_consensus ? '<span class="nc">◆ non-consensus</span>' : ""}${driftMark}<br><span style="color:var(--mut)">${s.thesis}</span></td>
          <td>${s.sector}</td><td><span class="pill ${cls}">${lbl}</span></td>
          <td class="pi-${s.priced_in}">${s.priced_in}</td><td>${s.durability}</td><td>${s.substitution_risk}</td>
          <td>${crowd == null ? "—" : crowd}</td><td style="font-size:11px">${s.tickers.join(", ")}</td>`;
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
  box.innerHTML = `<div><strong>Timing posture: ${lbl}${r.risk_score != null ? ` · risk ${r.risk_score}/100` : ""}</strong>
      <span>${r.action || ""}</span></div>
    <div class="rnote">${r.note || ""}<br><em>Alpha = scarcity thesis · timing = trend(200-DMA)+12m momentum+vol+drawdown. ${r.basis || ""}. Not advice.</em></div>`;
}

function renderPortfolio() {
  renderRegime();
  renderMyHoldings();
  const p = DATA.port;
  $("#portSummary").innerHTML = `
    <div class="card"><b>${fmtUsd(p.sleeve_usd)}</b><span>sleeve (~${Math.round(p.sleeve_usd / p.total_portfolio_usd * 100)}% of ${fmtUsd(p.total_portfolio_usd)})</span></div>
    <div class="card"><b>${fmtUsd(p.accounts.ira)}</b><span>IRA / 401k</span></div>
    <div class="card"><b>${fmtUsd(p.accounts.taxable)}</b><span>taxable</span></div>
    <div class="card"><b>${p.holdings.filter(h=>h.tier!=='DRY').length}</b><span>holdings + dry powder</span></div>`;

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
    tr.innerHTML = `<td><strong>${h.ticker}</strong></td><td>${h.name}</td><td>${h.account}</td>
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
    const topic = (f.items && f.items.length) ? f.items.join(", ") : "—";
    const nb = f.is_new ? '<span class="newbadge">NEW</span> ' : "";
    tr.innerHTML = `<td style="white-space:nowrap">${nb}${f.date || "—"}</td><td><strong>${f.ticker}</strong></td>
      <td><span class="pill y30">${f.form}</span></td><td>${topic}</td>
      <td>${f.url ? `<a href="${f.url}" target="_blank" rel="noopener">open ↗</a>` : ""}</td>`;
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
    d.innerHTML = `<strong>${scarcityLabel(id)}</strong><br>` + items.map((n) =>
      `${n.is_new ? '<span class="newbadge">NEW</span> ' : ""}<span style="color:var(--mut)">${n.date || ""}</span> <a href="${n.link}" target="_blank" rel="noopener">${n.title}</a>`
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

function loadKeyFields() { const k = getKeys(); $("#kGemini").value = k.gemini || ""; $("#kGroq").value = k.groq || ""; $("#kDispatch").value = localStorage.getItem(TOKEN_KEY) || ""; }
function saveKeys() {
  setMsg("");
  localStorage.setItem(KEYS_KEY, JSON.stringify({ gemini: $("#kGemini").value.trim(), groq: $("#kGroq").value.trim() }));
  const tok = $("#kDispatch").value.trim();
  if (tok) localStorage.setItem(TOKEN_KEY, tok); else localStorage.removeItem(TOKEN_KEY);
  setMsg("Keys saved to this browser.");
}

// Your-holdings live panel (Portfolio tab), computed from localStorage + scan quotes.
function renderMyHoldings() {
  const box = $("#myHoldings"); if (!box) return;
  const pos = getPositions(); const entries = Object.entries(pos.positions || {});
  if (!entries.length) { box.innerHTML = ""; return; }
  const targets = Object.fromEntries((DATA.port?.holdings || []).map((h) => [h.ticker, h.target_usd]));
  const cap = DATA.trig?.triggers?.find((t) => t.id === "sleeve_cap")?.threshold || 1720000;
  let total = 0; const acc = { ira: 0, taxable: 0 }; const rows = [];
  for (const [t, h] of entries) {
    const Q = DATA.sig?.quotes?.[t];
    const price = Q && !Q.error ? Q.price : null;
    const mv = price && h.shares ? price * h.shares : null;
    if (mv) { total += mv; if (acc[h.account] != null) acc[h.account] += mv; }
    const gain = price && h.cost_basis ? price / h.cost_basis - 1 : null;
    const tgt = targets[t];
    rows.push(`<tr><td><strong>${t}</strong></td><td>${h.account}</td><td>${h.shares ?? "—"}</td>
      <td>${price ? "$" + price.toFixed(2) : "—"}</td><td>${mv ? fmtUsd(mv) : "—"}</td>
      <td class="${gain>=0?'pos':'neg'}">${gain==null?"—":(gain*100).toFixed(0)+"%"}</td>
      <td>${tgt ? Math.round((mv||0)/tgt*100)+"% of target" : "—"}</td></tr>`);
  }
  const capPct = Math.round(total / cap * 100);
  box.innerHTML = `<h3>Your holdings (live) <span class="foot">— from your browser-stored positions × latest scan prices</span></h3>
    <div class="cards">
      <div class="card"><b>${fmtUsd(total)}</b><span>sleeve value (${capPct}% of $${(cap/1e6).toFixed(2)}mm cap)</span></div>
      <div class="card"><b>${fmtUsd(acc.ira)}</b><span>IRA/Roth</span></div>
      <div class="card"><b>${fmtUsd(acc.taxable)}</b><span>taxable</span></div>
      ${pos.cash_usd?`<div class="card"><b>${fmtUsd(pos.cash_usd)}</b><span>dry powder</span></div>`:""}
    </div>
    <table class="mine"><thead><tr><th>Ticker</th><th>Acct</th><th>Shares</th><th>Price</th><th>Mkt value</th><th>Gain</th><th>vs target</th></tr></thead>
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
$("#kSave").onclick = saveKeys;
$("#kDigest").onclick = browserDigest;

maybeOnboard();
load();
