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

export const SCHEMA_VERSION = 1;

const check = (errors, cond, msg) => { if (!cond) errors.push(msg); };
// schema_version is optional today; if present it must match the known version.
const checkVersion = (errors, obj, where) => {
  if (obj && "schema_version" in obj) {
    check(errors, obj.schema_version === SCHEMA_VERSION,
      `${where}: schema_version ${JSON.stringify(obj.schema_version)} != supported ${SCHEMA_VERSION}`);
  }
};
const oneOf = (errors, v, allowed, msg) =>
  check(errors, allowed.includes(v), `${msg} (got ${JSON.stringify(v)}, expected one of ${allowed.join("/")})`);

export function validatePortfolio(p, errors = []) {
  const w = "portfolio.json";
  if (!isObj(p)) { errors.push(`${w}: root must be an object`); return errors; }
  checkVersion(errors, p, w);
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
  checkVersion(errors, s, w);
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
    if ("confidence" in x && x.confidence != null) check(errors, isNum(x.confidence) && x.confidence >= 0 && x.confidence <= 1, `${at}: confidence must be 0..1`);
    if ("last_reviewed" in x) check(errors, isStr(x.last_reviewed) && !Number.isNaN(Date.parse(x.last_reviewed)), `${at}: last_reviewed must be a date string`);
  });
  return errors;
}

export function validateTriggers(t, errors = []) {
  const w = "triggers.json";
  if (!isObj(t)) { errors.push(`${w}: root must be an object`); return errors; }
  checkVersion(errors, t, w);
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
  checkVersion(errors, s, w);
  check(errors, isStr(s.scanned_at) && !Number.isNaN(Date.parse(s.scanned_at)),
    `${w}: scanned_at must be an ISO date string`);
  check(errors, isObj(s.quotes), `${w}: quotes must be an object`);
  check(errors, isObj(s.trigger_status), `${w}: trigger_status must be an object`);
  check(errors, typeof s.digest === "string", `${w}: digest must be a string`);
  check(errors, isArr(s.errors), `${w}: errors must be an array`);
  if ("filings" in s) check(errors, isArr(s.filings), `${w}: filings must be an array`);
  if ("news" in s) check(errors, isArr(s.news), `${w}: news must be an array`);
  if ("regime" in s) check(errors, isObj(s.regime), `${w}: regime must be an object`);
  if ("dca" in s) check(errors, isObj(s.dca), `${w}: dca must be an object`);
  if ("scarcity_drift" in s) check(errors, isObj(s.scarcity_drift), `${w}: scarcity_drift must be an object`);
  if ("data_quality" in s) check(errors, isObj(s.data_quality), `${w}: data_quality must be an object`);
  if ("alerts" in s) check(errors, isObj(s.alerts), `${w}: alerts must be an object`);
  if ("metrics" in s && s.metrics !== null) check(errors, isObj(s.metrics), `${w}: metrics must be an object or null`);
  if ("scorecard" in s && s.scorecard !== null) check(errors, isObj(s.scorecard), `${w}: scorecard must be an object or null`);
  if ("scarcity_signals" in s) check(errors, isObj(s.scarcity_signals), `${w}: scarcity_signals must be an object`);
  if ("chokepoints" in s) check(errors, isArr(s.chokepoints), `${w}: chokepoints must be an array`);
  for (const [t, q] of Object.entries(isObj(s.quotes) ? s.quotes : {})) {
    if (q == null) continue; // null = intentional non-tradeable placeholder
    if (!isObj(q)) { errors.push(`${w}: quotes[${t}] must be an object or null`); continue; }
    check(errors, isNum(q.price) || isStr(q.error),
      `${w}: quotes[${t}] must have a numeric price (resolved) or an error string (errored)`);
  }
  return errors;
}

// Optional, gitignored local file: real cost basis / shares for trim + sleeve-cap.
export function validatePositions(p, errors = []) {
  const w = "positions.local.json";
  if (!isObj(p)) { errors.push(`${w}: root must be an object`); return errors; }
  check(errors, isObj(p.positions), `${w}: positions must be an object`);
  if ("cash_usd" in p) check(errors, isNum(p.cash_usd), `${w}: cash_usd must be a number`);
  for (const [t, x] of Object.entries(isObj(p.positions) ? p.positions : {})) {
    const at = `${w} positions.${t}`;
    if (!isObj(x)) { errors.push(`${at}: must be an object`); continue; }
    if ("shares" in x) check(errors, isNum(x.shares), `${at}: shares must be a number`);
    if ("cost_basis" in x) check(errors, isNum(x.cost_basis), `${at}: cost_basis must be a number`);
    if ("forward_pe" in x && x.forward_pe != null) check(errors, isNum(x.forward_pe), `${at}: forward_pe must be a number or null`);
  }
  return errors;
}

// Optional security registry (F3): ticker -> {type, foreign?}.
export function validateSecurities(s, errors = []) {
  const w = "securities.json";
  if (!isObj(s)) { errors.push(`${w}: root must be an object`); return errors; }
  checkVersion(errors, s, w);
  check(errors, isObj(s.securities), `${w}: securities must be an object`);
  for (const [t, x] of Object.entries(isObj(s.securities) ? s.securities : {})) {
    if (!isObj(x)) { errors.push(`${w} ${t}: must be an object`); continue; }
    oneOf(errors, x.type, ["etf", "stock", "adr"], `${w} ${t}: type`);
    if ("foreign" in x) check(errors, isBool(x.foreign), `${w} ${t}: foreign must be boolean`);
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
