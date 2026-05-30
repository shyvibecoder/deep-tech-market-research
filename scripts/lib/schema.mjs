// Dependency-free schema validation for the Puck data files.
// "Fail loudly": each validator appends human-readable errors to a shared list.
// The scanner (scan.mjs) throws on any INPUT error before doing work, validates
// its OUTPUT before writing, and CI (scripts/selfcheck.mjs) re-asserts everything.
// No external deps on purpose — free-tier / keyless / zero-install constraint.

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && isFinite(v);
const isArr = (v) => Array.isArray(v);
const isBool = (v) => typeof v === "boolean";

// Allowed enums — kept in sync with the "legend" block in scarcities.json.
const BIND = ["now", "2027", "2028-29", "2030+", "physics-floor"];
const PRICED = ["low", "medium", "high", "crowded"];
const DURABILITY = ["low", "medium", "high", "very-high"];
const SUBST = ["low", "medium", "high"];
const ACCOUNTS = ["ira", "taxable"];
const TRIGGER_TYPES = ["auto", "manual"];
const TRIGGER_STATUS = ["armed", "monitor", "fired"];

const check = (errors, cond, msg) => { if (!cond) errors.push(msg); };
const oneOf = (errors, v, allowed, msg) =>
  check(errors, allowed.includes(v), `${msg} (got ${JSON.stringify(v)}, expected one of ${allowed.join("/")})`);

export function validatePortfolio(p, errors = []) {
  const w = "portfolio.json";
  if (!isObj(p)) { errors.push(`${w}: root must be an object`); return errors; }
  check(errors, isNum(p.sleeve_usd), `${w}: sleeve_usd must be a number`);
  check(errors, isNum(p.total_portfolio_usd), `${w}: total_portfolio_usd must be a number`);
  check(errors, isObj(p.accounts) && isNum(p.accounts?.ira) && isNum(p.accounts?.taxable),
    `${w}: accounts.ira and accounts.taxable must be numbers`);
  check(errors, isArr(p.holdings) && p.holdings.length > 0, `${w}: holdings must be a non-empty array`);
  (p.holdings || []).forEach((h, i) => {
    const at = `${w} holdings[${i}]${isStr(h?.ticker) ? ` (${h.ticker})` : ""}`;
    if (!isObj(h)) { errors.push(`${at}: must be an object`); return; }
    check(errors, isStr(h.ticker), `${at}: ticker required`);
    check(errors, isStr(h.name), `${at}: name required`);
    oneOf(errors, h.account, ACCOUNTS, `${at}: account`);
    check(errors, isNum(h.target_usd), `${at}: target_usd must be a number`);
    check(errors, isNum(h.weight), `${at}: weight must be a number`);
    check(errors, isStr(h.tier), `${at}: tier required`);
    check(errors, isStr(h.role), `${at}: role required`);
  });
  return errors;
}

export function validateScarcities(s, errors = []) {
  const w = "scarcities.json";
  if (!isObj(s)) { errors.push(`${w}: root must be an object`); return errors; }
  check(errors, isArr(s.scarcities) && s.scarcities.length > 0, `${w}: scarcities must be a non-empty array`);
  const ids = new Set();
  (s.scarcities || []).forEach((x, i) => {
    const at = `${w} scarcities[${i}]${isStr(x?.id) ? ` (${x.id})` : ""}`;
    if (!isObj(x)) { errors.push(`${at}: must be an object`); return; }
    check(errors, isStr(x.id), `${at}: id required`);
    if (isStr(x.id)) { check(errors, !ids.has(x.id), `${at}: duplicate id`); ids.add(x.id); }
    check(errors, isStr(x.sector), `${at}: sector required`);
    check(errors, isStr(x.scarcity), `${at}: scarcity required`);
    oneOf(errors, x.bind_window, BIND, `${at}: bind_window`);
    oneOf(errors, x.priced_in, PRICED, `${at}: priced_in`);
    oneOf(errors, x.durability, DURABILITY, `${at}: durability`);
    oneOf(errors, x.substitution_risk, SUBST, `${at}: substitution_risk`);
    check(errors, isArr(x.tickers), `${at}: tickers must be an array`);
    check(errors, isBool(x.non_consensus), `${at}: non_consensus must be a boolean`);
    check(errors, isStr(x.thesis), `${at}: thesis required`);
  });
  return errors;
}

export function validateTriggers(t, errors = []) {
  const w = "triggers.json";
  if (!isObj(t)) { errors.push(`${w}: root must be an object`); return errors; }
  check(errors, isArr(t.triggers) && t.triggers.length > 0, `${w}: triggers must be a non-empty array`);
  const ids = new Set();
  (t.triggers || []).forEach((x, i) => {
    const at = `${w} triggers[${i}]${isStr(x?.id) ? ` (${x.id})` : ""}`;
    if (!isObj(x)) { errors.push(`${at}: must be an object`); return; }
    check(errors, isStr(x.id), `${at}: id required`);
    if (isStr(x.id)) { check(errors, !ids.has(x.id), `${at}: duplicate id`); ids.add(x.id); }
    check(errors, isStr(x.name), `${at}: name required`);
    oneOf(errors, x.type, TRIGGER_TYPES, `${at}: type`);
    oneOf(errors, x.status, TRIGGER_STATUS, `${at}: status`);
    check(errors, isStr(x.action), `${at}: action required`);
  });
  return errors;
}

// The generated output. Each quote must be either resolved (numeric price) or
// errored explicitly (error string), or null (a known non-tradeable placeholder).
export function validateSignals(s, errors = []) {
  const w = "signals.json";
  if (!isObj(s)) { errors.push(`${w}: root must be an object`); return errors; }
  check(errors, isStr(s.scanned_at) && !Number.isNaN(Date.parse(s.scanned_at)),
    `${w}: scanned_at must be an ISO date string`);
  check(errors, isObj(s.quotes), `${w}: quotes must be an object`);
  check(errors, isObj(s.trigger_status), `${w}: trigger_status must be an object`);
  check(errors, typeof s.digest === "string", `${w}: digest must be a string`);
  check(errors, isArr(s.errors), `${w}: errors must be an array`);
  for (const [t, q] of Object.entries(isObj(s.quotes) ? s.quotes : {})) {
    if (q == null) continue; // null = intentional non-tradeable placeholder
    if (!isObj(q)) { errors.push(`${w}: quotes[${t}] must be an object or null`); continue; }
    check(errors, isNum(q.price) || isStr(q.error),
      `${w}: quotes[${t}] must have a numeric price (resolved) or an error string (errored)`);
  }
  return errors;
}

// Throw with all collected errors at once, so one run surfaces every problem.
export function assertValid(name, errors) {
  if (errors.length) {
    throw new Error(`Schema validation failed (${name}):\n  - ${errors.join("\n  - ")}`);
  }
}

// Convenience: validate the three scanner INPUT files together.
export function validateInputs({ portfolio, scarcities, triggers }) {
  const errors = [];
  validatePortfolio(portfolio, errors);
  validateScarcities(scarcities, errors);
  validateTriggers(triggers, errors);
  return errors;
}
