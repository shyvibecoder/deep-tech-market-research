// Append-only history + delta state (audit F4 + F7). These keep signals.json a
// pure "latest snapshot" (F10) while time-series live in their own committed files.
// All pure-data (no network), so they run in offline mode too.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const readJson = (url, fallback) => {
  try { return existsSync(url) ? JSON.parse(readFileSync(url)) : fallback; }
  catch { return fallback; }
};
const writeJson = (url, obj) => writeFileSync(url, JSON.stringify(obj, null, 2) + "\n");

// F4: append today's priced_in/bind_window/non_consensus per scarcity, only when it
// changed from the last recorded snapshot. Returns drift since the FIRST record.
export function updateScarcityHistory(url, scarcities, today) {
  const store = readJson(url, { schema_version: 1, updated: today, history: {} });
  const drift = {};
  for (const s of scarcities) {
    const snap = { date: today, priced_in: s.priced_in, bind_window: s.bind_window, non_consensus: !!s.non_consensus };
    const arr = (store.history[s.id] ||= []);
    const last = arr[arr.length - 1];
    if (!last || last.priced_in !== snap.priced_in || last.bind_window !== snap.bind_window || last.non_consensus !== snap.non_consensus) {
      arr.push(snap);
    }
    const first = arr[0];
    if (first && (first.priced_in !== s.priced_in || first.bind_window !== s.bind_window)) {
      drift[s.id] = { since: first.date, priced_in: [first.priced_in, s.priced_in], bind_window: [first.bind_window, s.bind_window] };
    }
  }
  store.updated = today;
  writeJson(url, store);
  return { drift };
}

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
const KEEP_DAYS = 90;
const prune = (map, today) => {
  const cutoff = Date.parse(today) - KEEP_DAYS * 86400000;
  for (const k of Object.keys(map)) if (Date.parse(map[k]) < cutoff) delete map[k];
};

// F7: mark filings/news "is_new" (unseen since last run), record trigger fire times,
// then persist updated seen-state. Mutates filings/news in place (adds is_new).
export function applySeenState(url, { filings, news, triggerStatus, today }) {
  const st = readJson(url, { schema_version: 1, updated: today, filings: {}, news: {}, triggers: {} });
  let newFilings = 0, newNews = 0;
  for (const f of filings) {
    const key = `${f.ticker}:${f.form}:${f.date}`;
    f.is_new = !(key in st.filings);
    if (f.is_new) newFilings++;
    st.filings[key] = f.date;
  }
  for (const n of news) {
    const key = hash((n.title || "").toLowerCase());
    n.is_new = !(key in st.news);
    if (n.is_new) newNews++;
    st.news[key] = n.date || today;
  }
  for (const [id, v] of Object.entries(triggerStatus || {})) {
    if (v?.fired) st.triggers[id] = today;
  }
  prune(st.filings, today); prune(st.news, today);
  st.updated = today;
  writeJson(url, st);
  return { newFilings, newNews };
}
