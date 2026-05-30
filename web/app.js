const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtPct = (x) => (x == null ? "—" : (x * 100).toFixed(0) + "%");
const fmtUsd = (x) => "$" + (x / 1000).toFixed(0) + "k";
const WIN = { now: ["now", "Binding now"], "2027": ["y27", "2027"], "2028-29": ["y28", "2028-29"], "2030+": ["y30", "2030+"], "physics-floor": ["floor", "Physics floor"] };

const REPO = "shyvibecoder/deep-tech-market-research"; // owner/repo the Refresh button dispatches to
const TOKEN_KEY = "puck_dispatch_token";
const STALE_DAYS = 3; // show a banner if the last scan is older than this

let DATA = {};
async function load() {
  const [scar, port, trig, sig] = await Promise.all(
    ["scarcities", "portfolio", "triggers", "signals"].map((f) => fetch(`data/${f}.json`).then((r) => r.json()).catch(() => ({})))
  );
  DATA = { scar, port, trig, sig };
  $("#scanned").textContent = sig?.scanned_at ? `· last scan ${new Date(sig.scanned_at).toLocaleString()}` : "";
  renderStale(sig); renderRadar(); renderTimeline(); renderPortfolio(); renderDigest();
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
        const tr = document.createElement("tr");
        tr.innerHTML = `<td><strong>${s.scarcity}</strong>${s.non_consensus ? '<span class="nc">◆ non-consensus</span>' : ""}<br><span style="color:var(--mut)">${s.thesis}</span></td>
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

function renderPortfolio() {
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
    const d = document.createElement("div"); d.className = `trig ${state}`;
    d.innerHTML = `<span class="badge">${state}${live?.value != null ? ` · ${live.value}` : ""}</span><strong>${t.name}</strong><br>
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
      <td class="${off<0?'neg':''}">${fmtPct(off)}</td><td style="color:var(--mut)">${h.role}</td>`;
    tb.appendChild(tr);
  });
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
  const btn = $("#refresh"), label = btn.textContent;
  btn.disabled = true; btn.textContent = "⟳ Dispatching…";
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ event_type: "scan" }),
    });
    if (r.status === 204) {
      alert("Scan dispatched ✓ — the GitHub Action is running. Reload in ~1–2 min for fresh data.");
    } else if ([401, 403, 404].includes(r.status)) {
      localStorage.removeItem(TOKEN_KEY);
      alert(`Dispatch rejected (HTTP ${r.status}). The saved token was cleared — make sure it grants "Contents: Read and write" on ${REPO}, then try Refresh again.`);
    } else {
      alert(`Dispatch failed (HTTP ${r.status}).\n${await r.text()}`);
    }
  } catch (e) {
    alert(`Dispatch error: ${e.message}\nManual fallback: repo → Actions → "scan" → Run workflow.`);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}
$("#refresh").onclick = triggerScan;

load();
