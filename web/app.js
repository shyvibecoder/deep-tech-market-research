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

load();
