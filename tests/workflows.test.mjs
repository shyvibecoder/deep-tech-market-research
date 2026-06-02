import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const wf = (f) => readFileSync(fileURLToPath(new URL(`../.github/workflows/${f}`, import.meta.url)), "utf8");

describe("workflows: pushes to main rebase first (race guard, red-team R3)", () => {
  for (const f of ["scan.yml", "docs.yml", "scout.yml", "research.yml", "diversifier.yml"]) {
    it(`${f} rebases before pushing to main`, () => {
      const y = wf(f);
      if (/git push(?!\s+-u)/.test(y)) assert.ok(/pull --rebase/.test(y), `${f} pushes to main without 'git pull --rebase' — commit-race risk`);
    });
    it(`${f} auto-resolves regenerated-output conflicts (rebase -X theirs + abort guard)`, () => {
      const y = wf(f);
      if (!/git push(?!\s+-u)/.test(y)) return;
      // These jobs only commit their OWN regenerated output, so a same-output race must auto-resolve in
      // this run's favor — otherwise an add/add (e.g. research/auto/DATE.*) dead-locks the rebase loop.
      assert.ok(/pull --rebase -X theirs/.test(y), `${f}: rebase must use '-X theirs' so a regenerated-output race resolves instead of dead-locking`);
      assert.ok(/rebase --abort/.test(y), `${f}: needs a 'git rebase --abort' guard so a failed iteration doesn't block the retry`);
    });
  }
  it("no workflow uses the inline-flow env trap (env: { X: ${{...}} })", () => {
    for (const f of ["scan.yml", "docs.yml", "research.yml", "ci.yml", "e2e.yml", "scout.yml", "diversifier.yml"]) {
      assert.ok(!/env:\s*\{[^}]*\$\{\{/.test(wf(f)), `${f} has an inline-flow env with \${{ }} — YAML startup-failure trap`);
    }
  });
  it("no unquoted 'name:' value contains a colon-space (YAML key/value trap)", () => {
    for (const f of ["scan.yml", "docs.yml", "research.yml", "ci.yml", "e2e.yml", "scout.yml", "diversifier.yml"]) {
      for (const line of wf(f).split("\n")) {
        const m = line.match(/^\s*-?\s*name:\s+(\S.*)$/);
        if (!m) continue;
        const v = m[1].trim();
        if (/^['"]/.test(v)) continue; // already quoted
        assert.ok(!/:\s/.test(v), `${f}: unquoted step/job name contains ": " (YAML invalid) → ${v}`);
      }
    }
  });
});
