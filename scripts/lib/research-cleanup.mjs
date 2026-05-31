// Auto-cleanup of stale "Accept → open PR" branches. Each dashboard Accept opens a PR on a branch
// research-accept/<scarcityId>-<timestamp> that edits web/data/scarcities.json. These accumulate:
// accepting the same scarcity from a later run, or just never merging, leaves stale/conflicting PRs
// open forever. planCleanup decides which to close — superseded (an older PR for a scarcity that has
// a newer open PR) or stale (older than maxAgeDays) — and is PURE so the decision is fully tested
// without touching GitHub. The runner (research-cleanup-run.mjs) applies the plan via the API.

const PREFIX = "research-accept/";

// Pull the scarcity id out of a research-accept branch. The id itself may contain hyphens
// (e.g. "manipulation-data"); the trailing "-<base36 timestamp>" is the unique suffix, so strip
// exactly the LAST hyphen-segment. Returns null for any branch the bot didn't open.
export function parseAcceptBranch(headRef) {
  if (typeof headRef !== "string" || !headRef.startsWith(PREFIX)) return null;
  const rest = headRef.slice(PREFIX.length);
  const i = rest.lastIndexOf("-");
  if (i <= 0) return null;                       // no id, or no timestamp suffix
  return { id: rest.slice(0, i), suffix: rest.slice(i + 1) };
}

// Given the open PRs, return the ones to close: { number, reason: "superseded"|"stale", detail }.
// A PR is superseded if a NEWER open accept-PR exists for the same scarcity id (keep only newest);
// otherwise stale if older than maxAgeDays. Superseded takes precedence so a PR is listed once.
export function planCleanup(openPRs = [], { now = Date.now(), maxAgeDays = 60 } = {}) {
  const accepts = [];
  for (const pr of openPRs) {
    const parsed = parseAcceptBranch(pr.headRef);
    if (!parsed) continue;
    accepts.push({ number: pr.number, id: parsed.id, created: Date.parse(pr.created_at) || 0 });
  }
  // Newest PR per scarcity id → everything else for that id is superseded.
  const newestByID = new Map();
  for (const a of accepts) {
    const cur = newestByID.get(a.id);
    if (!cur || a.created > cur.created) newestByID.set(a.id, a);
  }
  const plan = [];
  const ageMs = maxAgeDays * 24 * 3600 * 1000;
  for (const a of accepts) {
    const newest = newestByID.get(a.id);
    if (newest.number !== a.number) {
      plan.push({ number: a.number, reason: "superseded", detail: `A newer proposal PR (#${newest.number}) for "${a.id}" is open — closing this superseded one.` });
    } else if (now - a.created > ageMs) {
      plan.push({ number: a.number, reason: "stale", detail: `Open and unmerged for more than ${maxAgeDays} days — closing as stale/abandoned. Re-accept from the dashboard if still wanted.` });
    }
  }
  return plan;
}
