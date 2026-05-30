// True-alpha signal: turn the thesis's core claim into a measurable read. The claim
// is "crowded/already-priced scarcities DE-RATE first; under-priced ones INFLECT."
// We measure each scarcity basket's RELATIVE STRENGTH vs the AI-capex complex and
// flag crowded names rolling over (reduce) and cheap names gaining (accumulate).
// Pure; the alpha is in the relative move + the priced-in context, not absolute price.
export function relativeStrength(scarcityMoms, complexMom) {
  const ms = (scarcityMoms || []).filter((x) => typeof x === "number" && isFinite(x));
  if (!ms.length || typeof complexMom !== "number" || !isFinite(complexMom)) return null;
  return +(ms.reduce((a, b) => a + b, 0) / ms.length - complexMom).toFixed(4);
}

export function deRatingSignal(priced_in, rs, threshold = 0.03) {
  if (rs == null) return { flag: "none", rs: null };
  const crowded = priced_in === "high" || priced_in === "crowded";
  const cheap = priced_in === "low" || priced_in === "medium";
  if (crowded && rs <= -threshold) return { flag: "de-rating", action: "reduce", rs };
  if (cheap && rs >= threshold) return { flag: "inflecting", action: "accumulate", rs };
  return { flag: "none", rs };
}
