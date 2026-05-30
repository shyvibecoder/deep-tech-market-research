// F2b: convert a foreign-denominated amount to USD. Pure `toUsd` (tested) + a free,
// keyless rate fetcher via Yahoo (${CUR}USD=X). Returns null on an unknown rate so
// callers can skip + flag rather than mis-sum currencies.
import { fetchYahoo } from "./quotes.mjs";

export function toUsd(amount, currency, rates = {}) {
  if (!currency || currency === "USD") return amount;
  const r = rates[currency];
  return r > 0 ? amount * r : null;
}

export async function fetchRates(currencies) {
  const rates = { USD: 1 };
  for (const c of [...new Set(currencies)].filter((x) => x && x !== "USD")) {
    try { const q = await fetchYahoo(`${c}USD=X`); if (q?.price > 0) rates[c] = q.price; }
    catch { /* leave unset → toUsd returns null → caller flags */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  return rates;
}
