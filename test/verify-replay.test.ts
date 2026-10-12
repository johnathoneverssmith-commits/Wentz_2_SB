import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as sel from "../.claude/skills/wentz-verify/select-checks.mjs";
import * as replay from "../.claude/skills/wentz-verify/replay-history.mjs";
import type { Brief, ReplayEntry } from "../.claude/skills/wentz-verify/replay-history.mjs";

/**
 * What the selector would have asked of pull requests that really happened.
 *
 * The expectations below were written down from what each change needed
 * BEFORE the selector was run on it, then compared. Replaying them found one
 * real flaw (the online test config was lumped in with global build config and
 * demanded the UI and engine suites), which is why the config rules are split
 * by project. Each entry says what must be asked for, and what must not: asking
 * for too little hides a regression, and asking for everything every time teaches
 * people to skip the plan.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const map = sel.loadMap();
const testIndex = sel.buildTestIndex(ROOT, map);
const fixtures = replay.loadFixtures(join(ROOT, "test/fixtures/verify-replay.json"));
const briefOf = (pr: number): Brief => {
  const entry = fixtures.find((f) => f.pr === pr);
  if (!entry) throw new Error(`no fixture for PR #${pr}`);
  return replay.brief(replay.replay(entry, { map, testIndex }));
};

const NO_FULL_SUITES = ["full-engine", "full-ui", "full-online", "stat-guard", "circuits", "engine-realism"];

const expectations: {
  pr: number;
  what: string;
  risk: string;
  classes: string[];
  mustRequire: string[];
  mustNotRequire: string[];
  mustRecommend?: string[];
  approval?: RegExp;
  needsDatabase: boolean;
}[] = [
  {
    pr: 1,
    what: "a workflow file only: can't be proven locally, needs a person, CI is the proof",
    risk: "high",
    classes: ["ci-or-deploy-config"],
    mustRequire: ["static-review", "ci-pr"],
    mustNotRequire: NO_FULL_SUITES,
    approval: /CI or deployment/,
    needsDatabase: false,
  },
  {
    pr: 2,
    what: "ten database suites and a new test helper",
    risk: "high",
    classes: ["test-infrastructure", "tests-only"],
    mustRequire: ["tc-online", "infra-checks", "db-suites", "direct:online", "ci-pr"],
    mustNotRequire: [...NO_FULL_SUITES, "tc-ui", "tc-engine"],
    mustRecommend: ["ci-repeat-db"],
    needsDatabase: true,
  },
  {
    pr: 4,
    what: "one new database-backed visibility test file",
    risk: "low",
    classes: ["tests-only"],
    mustRequire: ["tc-online", "direct:online", "ci-pr"],
    mustNotRequire: [...NO_FULL_SUITES, "tc-ui", "tc-engine"],
    needsDatabase: true,
  },
  {
    pr: 5,
    what: "the statistical regression test",
    risk: "medium",
    classes: ["statistical-tests"],
    mustRequire: ["tc-online", "stat-guard", "ci-pr"],
    mustNotRequire: ["full-engine", "full-ui", "full-online", "db-suites", "tc-ui"],
    mustRecommend: ["stats-deep"],
    needsDatabase: false,
  },
  {
    pr: 7,
    what: "database error reporting across the same ten suites",
    risk: "high",
    classes: ["test-infrastructure", "tests-only"],
    mustRequire: ["tc-online", "infra-checks", "db-suites", "direct:online", "ci-pr"],
    mustNotRequire: [...NO_FULL_SUITES, "tc-ui", "tc-engine"],
    mustRecommend: ["ci-repeat-db"],
    needsDatabase: true,
  },
  {
    pr: 11,
    what: "global schema setup plus the online test config, which applies to every online test",
    risk: "high",
    classes: ["online-test-config", "test-infrastructure", "tests-only"],
    mustRequire: ["tc-online", "infra-checks", "db-suites", "full-online", "ci-pr"],
    // an online-only test config cannot change the UI or engine tests
    mustNotRequire: ["full-ui", "full-engine", "tc-ui", "tc-engine", "ui-build", "stat-guard"],
    mustRecommend: ["ci-repeat-db"],
    needsDatabase: true,
  },
];

describe("replaying the pull requests this work went through", () => {
  it("has a recorded change set for each of them", () => {
    expect(fixtures.map((f) => f.pr)).toEqual([1, 2, 4, 5, 7, 11]);
    for (const f of fixtures) expect(f.changes.length, `PR #${f.pr}`).toBeGreaterThan(0);
  });

  it.each(expectations)("PR #$pr: $what", (e) => {
    const b = briefOf(e.pr);
    expect(b.risk).toBe(e.risk);
    expect(b.classes).toEqual(e.classes);
    expect(b.conservative, "every path in these PRs has a rule").toBe(false);
    for (const id of e.mustRequire) expect(b.required, `should require ${id}`).toContain(id);
    for (const id of e.mustNotRequire) expect(b.required, `should NOT require ${id}`).not.toContain(id);
    for (const id of e.mustRecommend ?? []) expect(b.recommended, `should recommend ${id}`).toContain(id);
    if (e.approval) expect(b.approvals.join(" ")).toMatch(e.approval);
    else expect(b.approvals).toEqual([]);
    expect(b.needsDatabase).toBe(e.needsDatabase);
    // required and recommended are disjoint, and a required check is never repeated
    expect(b.required.filter((id) => b.recommended.includes(id))).toEqual([]);
    expect(new Set(b.required).size).toBe(b.required.length);
  });

  it("flags database changes as unprovable on PGlite, the lesson of the schema deadlock", () => {
    for (const pr of [2, 4, 7, 11]) {
      expect(briefOf(pr).concurrencyCiOnly, `PR #${pr}`).toBe(true);
    }
    expect(briefOf(5).concurrencyCiOnly).toBe(false);
  });

  it("would have named the checks that cannot be done locally for the workflow PR", () => {
    const entry = fixtures.find((f) => f.pr === 1) as ReplayEntry;
    const p = replay.replay(entry, { map, testIndex });
    expect(p.notes.join(" ")).toMatch(/Cannot be verified locally/);
    expect(p.required.find((c) => c.id === "static-review")?.note).toMatch(/no YAML or Actions linter/);
    expect(p.required.find((c) => c.id === "ci-pr")?.note).toMatch(/deploy.*skipped/);
  });

  it("never asks for more than CI itself runs on a pull request, nor for a deploy", () => {
    for (const f of fixtures) {
      const p = replay.replay(f, { map, testIndex });
      for (const c of [...p.required, ...p.recommended]) {
        for (const cmd of c.commands) {
          expect(cmd, `${f.pr}: ${c.id}`).not.toMatch(/deploy|git push|gh |render/i);
        }
      }
    }
  });

  it("matches git history when the history is available", () => {
    const have = (sha: string) => {
      try {
        execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    const available = fixtures.filter((f) => have(f.merge) && have(f.parent));
    // a shallow clone (CI) has none of this history: the recorded change sets above are then all there is
    for (const f of available) {
      const fresh = replay.capture({ merge: f.merge, pr: f.pr, title: f.title, cwd: ROOT });
      expect(fresh.changes, `PR #${f.pr}`).toEqual(f.changes);
    }
  });
});
