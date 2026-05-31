#!/usr/bin/env node
// Auto-close stale "Accept → open PR" branches (research-accept/*). Runs after each research run so
// superseded / abandoned proposal PRs don't pile up. The DECISION lives in the pure, tested
// planCleanup; this runner just fetches open PRs and applies the plan via the GitHub API. Best-effort
// and non-fatal: any API hiccup logs and exits 0 (cleanup must never fail the workflow). Posts a
// short comment, closes the PR, and deletes its branch. Set CLEANUP_MAX_AGE_DAYS to tune staleness.

import { planCleanup } from "./lib/research-cleanup.mjs";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;            // "owner/name", provided by Actions
const maxAgeDays = Number(process.env.CLEANUP_MAX_AGE_DAYS || 60);
if (!token || !repo) { console.log("cleanup: skipped (no GITHUB_TOKEN/GITHUB_REPOSITORY)"); process.exit(0); }

const api = `https://api.github.com/repos/${repo}`;
const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" };
const gh = async (path, init) => {
  const r = await fetch(`${api}${path}`, { headers, ...init });
  if (!r.ok) throw new Error(`${init?.method || "GET"} ${path} → ${r.status}`);
  return r.status === 204 ? null : r.json();
};

try {
  // Open PRs (paginated). Map to the shape planCleanup expects.
  const open = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/pulls?state=open&per_page=100&page=${page}`);
    if (!batch.length) break;
    for (const pr of batch) open.push({ number: pr.number, headRef: pr.head?.ref, created_at: pr.created_at });
    if (batch.length < 100) break;
  }
  const plan = planCleanup(open, { now: Date.now(), maxAgeDays });
  if (!plan.length) { console.log(`cleanup: ${open.length} open PR(s), nothing stale/superseded to close.`); process.exit(0); }

  for (const item of plan) {
    try {
      await gh(`/issues/${item.number}/comments`, { method: "POST", body: JSON.stringify({ body: `🧹 Auto-cleanup (${item.reason}): ${item.detail}` }) });
      await gh(`/pulls/${item.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
      // Best-effort branch delete (ignore if already gone / protected).
      const pr = await gh(`/pulls/${item.number}`);
      if (pr.head?.ref) { try { await gh(`/git/refs/heads/${pr.head.ref}`, { method: "DELETE" }); } catch { /* branch may be gone */ } }
      console.log(`cleanup: closed PR #${item.number} (${item.reason})`);
    } catch (e) { console.log(`cleanup: could not close PR #${item.number}: ${e.message}`); }
  }
} catch (e) {
  console.log(`cleanup: non-fatal error (${e.message})`); process.exit(0);
}
