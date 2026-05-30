// Options tab UI (ES module). Uses the shared fair-value math in options.mjs and
// auto-fills the underlying price + realized vol from the latest scan.
import { evaluateOption, suggestOptionStructure } from "./options.mjs";

const $ = (s) => document.querySelector(s);
let SIG = {};

fetch(`data/signals.json?t=${Date.now()}`).then((r) => r.json()).then((sig) => {
  SIG = sig || {};
  const dl = $("#oTickers");
  Object.entries(SIG.quotes || {}).forEach(([t, q]) => {
    if (q && !q.error) dl.appendChild(new Option(t, t));
  });
}).catch(() => {});

function autofill() {
  const t = ($("#oTicker").value || "").toUpperCase();
  const q = SIG.quotes?.[t];
  if (q && !q.error) {
    if (q.price) $("#oS").value = q.price.toFixed(2);
    if (q.vol_1y != null) $("#oVol").value = (q.vol_1y * 100).toFixed(1);
  }
}

const pctG = (x) => (x == null ? "—" : (x).toFixed(3));
function evaluate() {
  const type = $("#oType").value;
  const S = parseFloat($("#oS").value), K = parseFloat($("#oK").value);
  const daysToExpiry = parseFloat($("#oDays").value), marketPrice = parseFloat($("#oPx").value);
  const refVol = parseFloat($("#oVol").value) / 100;
  const r = (parseFloat($("#oR").value) || 4.5) / 100;
  const out = $("#optResult");
  if (!(S > 0) || !(K > 0) || !(daysToExpiry > 0) || !(marketPrice > 0)) {
    out.innerHTML = `<p class="foot">Enter underlying $, strike, days to expiry, and option price (realized vol auto-fills from the scan, or type it).</p>`;
    return;
  }
  const e = evaluateOption({ type, S, K, daysToExpiry, r, marketPrice, refVol: refVol > 0 ? refVol : undefined });
  const g = e.greeks || {};
  const posture = SIG.regime?.posture;
  const sug = suggestOptionStructure(posture, { macroStressed: !!SIG.regime?.macro_stressed });
  const suggest = sug.stance === "none" ? "" :
    `Timing posture <strong>${posture}</strong> → <strong>${sug.stance}</strong>: ${sug.structures.join("; ")} (${sug.dte}, ${sug.delta}) — ${sug.rationale}. Defined-risk only.`;
  out.innerHTML = `
    <div class="optcard">
      <p class="verdict ${e.verdict}">Verdict: ${e.verdict.toUpperCase()} — <span style="font-weight:400">${e.reason}</span></p>
      <table class="kv">
        <tr><td>Implied vol</td><td>${e.implied_vol == null ? "—" : e.implied_vol + "%"}</td><td>Realized vol</td><td>${e.realized_vol == null ? "—" : e.realized_vol + "%"}</td></tr>
        <tr><td>IV ÷ realized</td><td>${e.iv_to_realized ?? "—"}×</td><td>Intrinsic</td><td>$${e.intrinsic}</td></tr>
        <tr><td>Fair value @ realized vol</td><td>$${e.fair_value_at_realized ?? "—"}</td><td>Edge vs fair</td><td>${e.edge_vs_fair == null ? "—" : (e.edge_vs_fair >= 0 ? "+" : "") + "$" + e.edge_vs_fair}</td></tr>
        <tr><td>Delta</td><td>${pctG(g.delta)}</td><td>Vega (per 1%)</td><td>${pctG(g.vega)}</td></tr>
        <tr><td>Gamma</td><td>${pctG(g.gamma)}</td><td>Theta (per day)</td><td>${pctG(g.theta)}</td></tr>
      </table>
      ${e.notes?.length ? `<p class="foot">⚠ ${e.notes.join("; ")}</p>` : ""}
      ${suggest ? `<p class="foot">${suggest}</p>` : ""}
      <p class="foot">Sanity check only — realized vol is backward-looking; options also carry event/skew/term premia. <strong>Defined-risk only, no naked options.</strong> Not financial advice.</p>
    </div>`;
}

$("#oTicker").addEventListener("change", autofill);
$("#oEval").addEventListener("click", evaluate);
