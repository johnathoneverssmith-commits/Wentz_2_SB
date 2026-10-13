import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as sel from "../.claude/skills/wentz-verify/select-checks.mjs";
import type { Check, Plan } from "../.claude/skills/wentz-verify/select-checks.mjs";
import * as runner from "../.claude/skills/wentz-verify/run-checks.mjs";
import type { Policy } from "../.claude/skills/wentz-verify/command-policy.mjs";
import * as v from "../.claude/skills/wentz-verify/verdict.mjs";
import type { RunRecord, SummarizeContext } from "../.claude/skills/wentz-verify/verdict.mjs";

/**
 * The verdict code is what stops a failure from being reported as a pass, so
 * these tests are written from the other side: each takes a situation in which
 * a hurried summary would say "all good", and checks the verdict does not.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIR = join(ROOT, ".claude/skills/wentz-verify");

const check = (id: string, extra: Partial<Check> = {}): Check => ({
  id,
  level: "REQUIRED",
  kind: "command",
  tier: 1,
  label: id,
  commands: ["npx vitest run test/x.test.ts"],
  files: [],
  reasons: [],
  needsDatabase: false,
  ...extra,
});
const plan = (required: Check[], recommended: Check[] = [], extra: Partial<Plan> = {}): Plan =>
  ({
    version: 1, base: "origin/master", mergeBase: "abc", empty: false, conservative: false, risk: "high", classes: [],
    changes: [], unknownSourcePaths: [], unclassifiedPaths: [], scratchPaths: [], problems: [], warnings: [],
    approvalsNeeded: [], notes: [], needsDatabase: false, required, recommended, limitations: ["L1", "L2"], localVersusCi: "",
    ...extra,
  }) as Plan;

const PASS = "\n Test Files  1 passed (1)\n      Tests  17 passed (17)\n";
const ok = (id: string, output = PASS): RunRecord => ({ id, exitCode: 0, output });
/** What fetchCiEvidence returns once GitHub's answer has been validated. */
const validCi = (extra: Record<string, unknown> = {}) => ({ validated: true, source: "github-api", test: "success", deploy: "skipped", event: "pull_request", headSha: "a".repeat(40), runId: 7, pr: { number: 12, baseRef: "master" }, ...extra }) as NonNullable<SummarizeContext["ciEvidence"]> & NonNullable<RunRecord["ci"]>;
/** The record the report builds from it. */
const ci = (extra: Record<string, unknown> = {}): RunRecord => ({ id: "ci-pr", evidence: "github-api", ci: validCi(extra) });
const withCi = (extra: Record<string, unknown> = {}) => ({ ciEvidence: validCi(extra) });
const scope = check("scope", { kind: "manual", commands: [] });
const ciCheck = check("ci-pr", { kind: "ci", commands: [], tier: 5 });
const confirmed = (id: string): RunRecord => ({ id, status: "CONFIRMED" });

describe("reading a runner's output", () => {
  it("reads vitest's counts", () => {
    const p = v.parseTestOutput(" Test Files  2 failed | 5 passed | 1 skipped (8)\n      Tests  3 failed | 40 passed | 2 skipped (45)\n");
    expect(p.tests).toMatchObject({ passed: 40, failed: 3, skipped: 2, todo: 0, total: 45, summaries: 1 });
    expect(p.files).toMatchObject({ failed: 2, passed: 5, skipped: 1 });
  });

  it("ignores colour codes and collects the names of failing tests", () => {
    const out = "\u001b[31m × never prints a password 12ms\u001b[39m\n FAIL  test/a.test.ts > b\n\u001b[1m      Tests  \u001b[22m1 failed | 2 passed (3)";
    const p = v.parseTestOutput(out);
    expect(p.tests?.failed).toBe(1);
    expect(p.failures).toEqual(["never prints a password", "test/a.test.ts > b"]);
  });

  it("counts type errors and recognises the database setup lines", () => {
    expect(v.parseTestOutput("a.ts(1,1): error TS2322: x\nb.ts(2,2): error TS2304: y").tscErrors).toBe(2);
    expect(v.parseTestOutput("[test setup] database schema applied once, before any test file (900 ms)").databaseUsed).toBe(true);
    expect(v.parseTestOutput("[test setup] DATABASE SCHEMA NOT APPLIED: applying the schema failed").databaseSetupFailed).toBe(true);
  });

  it("adds up every summary when one command runs vitest more than once", () => {
    const out = " Test Files  1 passed (1)\n      Tests  10 passed (10)\n\n Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 8 passed | 1 skipped (11)\n";
    const p = v.parseTestOutput(out);
    expect(p.tests).toMatchObject({ passed: 18, failed: 2, skipped: 1, total: 21, summaries: 2 });
    expect(p.files).toMatchObject({ passed: 3, failed: 1, total: 4 });
  });

  it("reads the stress test by its own summary", () => {
    expect(v.parseStressOutput("- Team seasons completed: 3\n- Invariant failures and crashes: 0\n- Deterministic replay: identical\n")).toEqual({ invariantFailures: 0, replay: "identical", teamSeasons: 3 });
    expect(v.parseStressOutput("- Invariant failures and crashes: 1825\n- Deterministic replay: mismatch\n")).toEqual({ invariantFailures: 1825, replay: "mismatch", teamSeasons: null });
    expect(v.parseStressOutput("nothing")).toEqual({ invariantFailures: null, replay: null, teamSeasons: null });
  });

  it("returns nothing for text that is not a summary", () => {
    expect(v.parseTestOutput("hello").tests).toBeNull();
    expect(v.parseTestOutput(undefined).tests).toBeNull();
  });
});

describe("judging one check", () => {
  const c = check("x");

  it("passes only on exit 0 with a readable summary", () => {
    expect(v.judge(c, ok("x"))).toMatchObject({ status: "PASSED", detail: "17 passed" });
  });

  it("FAILS a non-zero exit even when the output says everything passed", () => {
    const j = v.judge(c, { id: "x", exitCode: 1, output: PASS });
    expect(j.status).toBe("FAILED");
    expect(j.detail).toMatch(/exit code 1/);
  });

  it("FAILS a zero exit whose output reports failed tests", () => {
    const j = v.judge(c, { id: "x", exitCode: 0, output: " Tests  1 failed | 16 passed (17)\n × a thing 3ms\n" });
    expect(j.status).toBe("FAILED");
    expect(j.failures).toEqual(["a thing"]);
  });

  it("FAILS a zero exit with type errors, or when a test run printed no summary at all", () => {
    expect(v.judge(c, { id: "x", exitCode: 0, output: "a.ts: error TS2322: no" }).status).toBe("FAILED");
    expect(v.judge(c, { id: "x", exitCode: 0, output: "all fine!" }).status).toBe("FAILED");
  });

  it("does not demand a test summary from a typecheck or a build", () => {
    const tc = check("tc-engine", { commands: ["npm run typecheck"] });
    expect(v.judge(tc, { id: "tc-engine", exitCode: 0, output: "" })).toMatchObject({ status: "PASSED", detail: "exit code 0" });
  });

  it("does not demand test counts from a typecheck, a build or a script, but never excuses a failure it prints", () => {
    const build = check("ui-build", { commands: ["npm --prefix ui-source run build"] });
    expect(v.judge(build, { id: "ui-build", exitCode: 0, output: "built in 4s" }).status).toBe("PASSED");
    // conservative: a build that somehow prints failed tests is not a pass because its exit code was 0
    expect(v.judge(build, { id: "ui-build", exitCode: 0, output: " Tests  3 failed | 1 passed (4)\n" }).status).toBe("FAILED");
    expect(v.judge(build, { id: "ui-build", exitCode: 1, output: "" }).status).toBe("FAILED");
    expect(v.judge(check("m", { commands: ["npx tsx analysis/39_league_metrics.ts"] }), { id: "m", exitCode: 0, output: "done" }).status).toBe("PASSED");
  });

  describe("the franchise stress test is not a Vitest run", () => {
    const stress = check("stress-smoke", { commands: ["npm run franchise:stress -- --mode smoke"] });
    const good = "- Team seasons completed: 3\n- Invariant failures and crashes: 0\n- Deterministic replay: identical\n";
    it("passes on exit 0 with a clean summary, although it prints no test counts", () => {
      expect(v.judge(stress, { id: "stress-smoke", exitCode: 0, output: good })).toMatchObject({ status: "PASSED" });
      // the same without an explicit parser: found from the command
      expect(v.parserFor({ commands: stress.commands })).toBe("stress");
      expect(v.judge(check("stress-smoke", { commands: stress.commands }), { id: "stress-smoke", exitCode: 0, output: good }).status).toBe("PASSED");
    });
    it("fails on a non-zero exit, failures in a zero exit, a replay mismatch, or no summary", () => {
      expect(v.judge(stress, { id: "s", exitCode: 1, output: "- Invariant failures and crashes: 1825\n- Deterministic replay: mismatch\n" }).status).toBe("FAILED");
      expect(v.judge(stress, { id: "s", exitCode: 0, output: "- Invariant failures and crashes: 3\n- Deterministic replay: identical\n" }).status).toBe("FAILED");
      expect(v.judge(stress, { id: "s", exitCode: 0, output: "- Invariant failures and crashes: 0\n- Deterministic replay: mismatch\n" }).status).toBe("FAILED");
      expect(v.judge(stress, { id: "s", exitCode: 0, output: "League 1/1: 3 seasons complete\n" }).status).toBe("FAILED");
    });
    it("does not pass an incomplete summary: no replay line, a replay that was not run, or no seasons played", () => {
      const failing = "- Invariant failures and crashes: 0\n";
      expect(v.judge(stress, { id: "s", exitCode: 0, output: `- Team seasons completed: 3\n${failing}` })).toMatchObject({ status: "FAILED", detail: expect.stringMatching(/incomplete/) });
      expect(v.judge(stress, { id: "s", exitCode: 0, output: `- Team seasons completed: 3\n${failing}- Deterministic replay: not_requested\n` }).status).toBe("FAILED");
      expect(v.judge(stress, { id: "s", exitCode: 0, output: `${failing}- Deterministic replay: identical\n` }).status).toBe("FAILED"); // no seasons line
      expect(v.judge(stress, { id: "s", exitCode: 0, output: `- Team seasons completed: 0\n${failing}- Deterministic replay: identical\n` }).status).toBe("FAILED");
    });
  });

  it("counts every summary of a command that ran vitest twice, and says so", () => {
    const out = " Test Files  1 passed (1)\n      Tests  10 passed (10)\n Test Files  1 passed (1)\n      Tests  7 passed (7)\n";
    expect(v.judge(c, { id: "x", exitCode: 0, output: out })).toMatchObject({ status: "PASSED", detail: "17 passed across 2 test runs" });
    // a failure in the second summary is not hidden by a clean first one
    const bad = " Tests  10 passed (10)\n Tests  1 failed | 6 passed (7)\n";
    expect(v.judge(c, { id: "x", exitCode: 0, output: bad }).status).toBe("FAILED");
  });

  it("does not let a green summary hide an explicit failing test line", () => {
    const out = " × the unrevealed result stays hidden 4ms\n FAIL  test/a.test.ts > the unrevealed result stays hidden\n Tests  17 passed (17)\n";
    const j = v.judge(c, { id: "x", exitCode: 0, output: out });
    expect(j.status).toBe("FAILED");
    expect(j.detail).toMatch(/failing test line/);
    expect(j.failures).toContain("the unrevealed result stays hidden");
  });

  it("decides how to read a check from its commands, not from a field in the plan", () => {
    // a plan is an editable file: naming the parser "exit" must not switch off failure detection for vitest
    const sneaky = { ...check("x"), parser: "exit" } as unknown as Check;
    expect(v.parserFor(sneaky)).toBe("vitest");
    expect(v.judge(sneaky, { id: "x", exitCode: 0, output: " Tests  1 failed | 16 passed (17)\n × a thing 3ms\n" }).status).toBe("FAILED");
    expect(v.judge(sneaky, { id: "x", exitCode: 0, output: "all fine!" }).status).toBe("FAILED"); // still wants a summary
    const stressSneaky = { ...check("s", { commands: ["npm run franchise:stress -- --mode smoke"] }), parser: "exit" } as unknown as Check;
    expect(v.parserFor(stressSneaky)).toBe("stress");
    expect(v.judge(stressSneaky, { id: "s", exitCode: 0, output: "League 1/1 done" }).status).toBe("FAILED");
  });

  it("calls tests that all skipped, or never ran, SKIPPED", () => {
    expect(v.judge(c, { id: "x", exitCode: 0, output: " Tests  12 skipped (12)\n" }).status).toBe("SKIPPED");
    expect(v.judge(c, { id: "x", exitCode: 0, output: " Tests  (0)\n" }).status).toBe("SKIPPED");
  });

  it("passes with skips but says how many were not exercised", () => {
    const j = v.judge(c, { id: "x", exitCode: 0, output: " Tests  16 passed | 1 skipped (17)\n" });
    expect(j.status).toBe("PASSED");
    expect(j.detail).toMatch(/1 skipped, not exercised/);
  });

  it("FAILS a timeout, a command that could not start, and a database that could not be set up", () => {
    expect(v.judge(c, { id: "x", exitCode: null, timedOut: true }).status).toBe("FAILED");
    expect(v.judge(c, { id: "x", exitCode: null, error: "spawn ENOENT" }).status).toBe("FAILED");
    const db = check("db", { needsDatabase: true });
    expect(v.judge(db, { id: "db", exitCode: 0, output: `[test setup] DATABASE SCHEMA NOT APPLIED: x\n${PASS}` }).status).toBe("FAILED");
  });

  it("is NOT RUN when there is no record, or no exit code", () => {
    expect(v.judge(c, undefined).status).toBe("NOT_RUN");
    expect(v.judge(c, { id: "x", exitCode: null }).status).toBe("NOT_RUN");
  });

  it("SKIPS a database check that never touched a database, however green it looks", () => {
    const db = check("db-suites", { needsDatabase: true });
    // the trap: suites return early without a database, and the runner counts that as a pass
    const j = v.judge(db, ok("db-suites"));
    expect(j.status).toBe("SKIPPED");
    expect(j.detail).toMatch(/returned early/);
    const used = v.judge(db, ok("db-suites", `[test setup] database schema applied once, before any test file (800 ms)\n${PASS}`));
    expect(used.status).toBe("PASSED");
  });

  it("does not count the whole online suite as run unless a database was used", () => {
    const full = check("full-online", { commands: ["npm run online:test -- --no-file-parallelism"], needsDatabase: true });
    // every suite that needs a database returns early without one, and vitest counts that as a pass
    expect(v.judge(full, ok("full-online", " Test Files  54 passed (54)\n      Tests  311 passed | 1 skipped (312)\n"))).toMatchObject({ status: "SKIPPED" });
    expect(v.judge(full, ok("full-online", `[test setup] database schema applied once, before any test file (900 ms)\n Tests  317 passed (317)\n`)).status).toBe("PASSED");
    const P = plan([scope, full]);
    const s = v.summarize(P, [confirmed("scope"), ok("full-online", " Tests  311 passed | 1 skipped (312)\n")]);
    expect(s.verdict).toBe("INCOMPLETE");
    expect(s.notRun).toEqual(["full-online"]);
  });

  it("needs a human's word for a manual check, and GitHub's for CI", () => {
    const m = check("scope", { kind: "manual", commands: [] });
    expect(v.judge(m, undefined).status).toBe("NOT_RUN");
    expect(v.judge(m, { id: "scope", status: "PASSED" }).status).toBe("NOT_RUN"); // only CONFIRMED counts
    expect(v.judge(m, confirmed("scope")).status).toBe("CONFIRMED");
    expect(v.judge(ciCheck, undefined).status).toBe("PENDING_CI");
  });

  it("judges CI: test must succeed, a pull request must not deploy, and only a pull request run counts", () => {
    expect(v.judge(ciCheck, ci()).status).toBe("PASSED");
    expect(v.judge(ciCheck, ci({ test: "failure" })).status).toBe("FAILED");
    expect(v.judge(ciCheck, ci({ deploy: "success" })).status).toBe("FAILED");
    expect(v.judge(ciCheck, ci({ deploy: undefined })).status).toBe("FAILED");
    // a push or manual run is not the pull request check, even if it passed and deployed
    expect(v.judge(ciCheck, ci({ deploy: "success", event: "push" })).status).toBe("PENDING_CI");
    expect(v.judge(ciCheck, ci({ event: undefined })).status).toBe("PENDING_CI");
  });

  it("does not believe CI that a person asserted: it cannot pass, only fail", () => {
    const claim = { id: "ci-pr", evidence: "attested", ci: { test: "success", deploy: "skipped", event: "pull_request" } };
    expect(v.judge(ciCheck, claim)).toMatchObject({ status: "PENDING_CI" });
    expect(v.judge(ciCheck, { ...claim, ci: { ...claim.ci, validated: true } }).status).toBe("PENDING_CI"); // claiming "validated" changes nothing
    expect(v.judge(ciCheck, { ...claim, ci: { test: "failure" } }).status).toBe("FAILED");
    expect(v.judge(ciCheck, { id: "ci-pr", ci: validCi() }).status).toBe("PENDING_CI"); // no tool provenance
  });

  it("does not take a command check on someone's attestation", () => {
    expect(v.judge(c, { id: "x", evidence: "attested", exitCode: 0, output: PASS }).status).toBe("NOT_RUN");
  });
});

describe("the overall verdict", () => {
  const P = plan([scope, check("tc"), check("tests"), ciCheck]);
  const allGood = [confirmed("scope"), ok("tc"), ok("tests")];

  it("is FAILED when one required check failed among many passes", () => {
    const s = v.summarize(P, [...allGood.slice(0, 2), { id: "tests", exitCode: 1, output: PASS }], withCi());
    expect(s.verdict).toBe("FAILED");
    expect(s.failed).toEqual(["tests"]);
    expect(v.exitCodeFor(s.verdict)).toBe(1);
  });

  it("is FAILED when only a RECOMMENDED check failed: a failure is never an overall pass", () => {
    const rec = plan([scope, ciCheck], [check("deep")]);
    const s = v.summarize(rec, [confirmed("scope"), { id: "deep", exitCode: 1, output: "" }], withCi());
    expect(s.verdict).toBe("FAILED");
  });

  it("is FAILED even when CI passed if a local check failed", () => {
    expect(v.summarize(P, [...allGood.slice(0, 2), { id: "tests", exitCode: 2 }], withCi()).verdict).toBe("FAILED");
  });

  it("is INCOMPLETE when a required check was never run", () => {
    const s = v.summarize(P, [confirmed("scope"), ok("tc")]);
    expect(s.verdict).toBe("INCOMPLETE");
    expect(s.notRun).toEqual(["tests"]);
    expect(v.exitCodeFor(s.verdict)).toBe(4);
  });

  it("is INCOMPLETE when a required check was skipped", () => {
    const s = v.summarize(P, [confirmed("scope"), ok("tc"), { id: "tests", exitCode: 0, output: " Tests  3 skipped (3)\n" }]);
    expect(s.verdict).toBe("INCOMPLETE");
  });

  it("is INCOMPLETE when a manual check was never confirmed", () => {
    expect(v.summarize(P, [ok("tc"), ok("tests")]).verdict).toBe("INCOMPLETE");
  });

  it("is only LOCALLY VERIFIED when every local check passed but CI has not reported", () => {
    const s = v.summarize(P, allGood);
    expect(s.verdict).toBe("LOCALLY_VERIFIED");
    expect(v.exitCodeFor(s.verdict)).toBe(0);
    expect(v.renderReport(s)).toMatch(/NOT the CI result/);
  });

  it("is VERIFIED only when the tool has validated CI too", () => {
    const s = v.summarize(P, allGood, withCi());
    expect(s.verdict).toBe("VERIFIED");
    expect(v.renderReport(s)).not.toMatch(/NOT the CI result/);
    expect(v.renderReport(s)).toMatch(/retrieved and validated by this tool/);
  });

  it("never reaches VERIFIED on local results or on anything typed in by hand", () => {
    const typed = { test: "success", deploy: "skipped", event: "pull_request", validated: true, headSha: "a".repeat(40) };
    const attempts: Array<[string, RunRecord[], Parameters<typeof v.summarize>[2]]> = [
      ["local results alone", allGood, undefined],
      ["a record claiming PASSED", [...allGood, { id: "ci-pr", status: "PASSED" } as RunRecord], undefined],
      ["a ci-pr record in the results file", [...allGood, ci()], undefined],
      ["an attested CI claim", allGood, { attestedCi: typed }],
      ["GitHub evidence that was not validated", allGood, { ciEvidence: { validated: false, reason: "no run" } }],
    ];
    for (const [name, results, context] of attempts) {
      const verdict = v.summarize(P, results, context).verdict;
      expect(verdict, name).toBe("LOCALLY_VERIFIED");
    }
  });

  it("does not count CI evidence that names no pull request", () => {
    const planWithCi = plan([scope, ciCheck]);
    expect(v.summarize(planWithCi, [confirmed("scope")], withCi({ pr: undefined })).verdict).toBe("LOCALLY_VERIFIED");
  });

  it("is FAILED when CI failed, or a pull request deployed, and an attested claim of failure also fails", () => {
    expect(v.summarize(P, allGood, withCi({ test: "failure" })).verdict).toBe("FAILED");
    expect(v.summarize(P, allGood, withCi({ deploy: "success" })).verdict).toBe("FAILED");
    expect(v.summarize(P, allGood, { attestedCi: { test: "failure" } }).verdict).toBe("FAILED");
    expect(v.summarize(P, allGood, { ciEvidence: { validated: false, failed: true, reason: "the latest run concluded failure" } }).verdict).toBe("FAILED");
  });

  it("does not count CI for a different commit than the one checked out, or a tree with changes on top", () => {
    const state = { head: "a".repeat(40), dirty: false, digest: "d" };
    const planOnlyManual = plan([scope, ciCheck]);
    expect(v.summarize(planOnlyManual, [confirmed("scope")], { ...withCi(), state }).verdict).toBe("VERIFIED");
    expect(v.summarize(planOnlyManual, [confirmed("scope")], { ...withCi({ headSha: "b".repeat(40) }), state }).verdict).toBe("LOCALLY_VERIFIED");
    expect(v.summarize(planOnlyManual, [confirmed("scope")], { ...withCi(), state: { ...state, dirty: true } }).verdict).toBe("LOCALLY_VERIFIED");
  });

  it("lists attested checks as such", () => {
    const s = v.summarize(P, allGood, withCi());
    expect(s.attestedOnly).toEqual(["scope"]);
    expect(v.renderReport(s)).toMatch(/Attested by hand, not observed by this tool:\*\*\s+`scope`/);
  });

  it("is BLOCKED by a problem in the change, whatever passed", () => {
    const blocked = plan(P.required, [], { problems: ["online/test/_x.test.ts looks like a scratch file but is staged"] });
    const s = v.summarize(blocked, allGood, withCi());
    expect(s.verdict).toBe("BLOCKED");
    expect(v.exitCodeFor(s.verdict)).toBe(1);
  });

  it("does not hold a recommended check that was not run against the verdict, but lists it", () => {
    const rec = plan([scope], [check("deep")]);
    const s = v.summarize(rec, [confirmed("scope")]);
    expect(s.verdict).toBe("LOCALLY_VERIFIED");
    expect(s.recommendedNotRun).toEqual(["deep"]);
    expect(v.renderReport(s)).toMatch(/`deep` \(recommended, NOT RUN\)/);
  });

  it("treats a docs-only plan with no CI requirement as locally verified, and says CI still runs", () => {
    const s = v.summarize(plan([scope]), [confirmed("scope")]);
    expect(s.verdict).toBe("LOCALLY_VERIFIED");
    expect(s.ciRequired).toBe(false);
    expect(v.renderReport(s)).toMatch(/No CI check was required/);
  });

  it("ignores results for checks that are not in the plan, and says so", () => {
    const s = v.summarize(P, [...allGood, ok("something-else")]);
    expect(s.unplanned).toEqual(["something-else"]);
    expect(v.renderReport(s)).toContain("something-else");
  });

  it("gives the same summary whatever order the results arrive in", () => {
    const a = v.summarize(P, allGood);
    const b = v.summarize(P, [...allGood].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("the report", () => {
  it("lists the failing tests by name, the skipped checks, the risks and the approvals", () => {
    const P = plan([scope, check("tests", { needsDatabase: true }), check("tc")], [], { needsDatabase: true, approvalsNeeded: ["Database schema"] });
    const s = v.summarize(P, [
      confirmed("scope"),
      { id: "tests", exitCode: 1, output: " Tests  1 failed | 4 passed (5)\n × the unrevealed result stays hidden 4ms\n" },
      { id: "tc", exitCode: 0, output: "" },
    ]);
    const text = v.renderReport(s);
    expect(text).toContain("**Verdict: FAILED");
    expect(text).toContain("the unrevealed result stays hidden");
    expect(text).toMatch(/\| tests \| REQUIRED \| FAILED \|/);
    expect(text).toMatch(/PGlite/);
    expect(text).toContain("Needs your approval");
    expect(text).toContain("- Database schema");
  });

  it("states a skipped required check as unverified, not as fine", () => {
    const s = v.summarize(plan([scope, check("tests")]), [confirmed("scope")]);
    const text = v.renderReport(s);
    expect(text).toMatch(/\*\*Verdict: INCOMPLETE/);
    expect(text).toMatch(/Required check `tests` did not run, so what it covers is unverified/);
  });

  it("is deterministic", () => {
    const s = v.summarize(plan([scope, check("a")]), [confirmed("scope"), ok("a")]);
    expect(v.renderReport(s)).toBe(v.renderReport(structuredClone(s)));
  });
});

describe("the runner", () => {
  /**
   * The real policy refuses everything but verification commands, so these tests need a way to run a
   * harmless script that records what the runner did. This policy is passed in code only; no command-line
   * option sets it. It allows `node <name>.js` for scripts the test writes into a temporary directory.
   */
  const testPolicy: Policy = {
    safeCharacters: /^[A-Za-z0-9_@/.:=,+\- ]+$/,
    extra: [(command) => (/^node [a-z0-9]+\.js$/.test(command) ? { ok: true, kind: "test-script", argv: command.split(" "), cwd: "." } : null)],
  };
  // best-effort: after a timeout the killed shell's child can still hold its directory for a moment on Windows
  const rmDir = (dir: string) => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // the operating system clears the temp directory
    }
  };
  const scripts = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-runner-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };

  it("refuses anything that is not a known verification command", () => {
    const refused = [
      "git push origin master", "curl https://example.com", "gh pr merge 4", "rm -rf node_modules",
      'node -e "process.exit(0)"', "node script.js", "npx cowsay hi", "npx --yes some-package", "npm run online:migrate",
      "npm run build", "npm run deploy", "npm install left-pad", "npm test -- --config evil.js", "npm test -u",
      "npx vitest run -u test/verify-selector.test.ts", "npx vitest run --config evil.config.ts test/verify-selector.test.ts",
      "npx vitest run --reporter=json test/verify-selector.test.ts", "npx vitest run package.json",
      "NODE_OPTIONS=--require=x npm test", "./node_modules/.bin/vitest run test/verify-selector.test.ts",
    ];
    for (const cmd of refused) expect(runner.refusal(cmd, { repoRoot: ROOT }), cmd).not.toBeNull();
    expect(runner.refusal("git push origin master", { repoRoot: ROOT })).toMatch(/not one of the verification commands/);
  });

  it("refuses shell operators and quoting in every form", () => {
    for (const tail of ["&& git push", "; rm x", "| tee out", "> out.txt", "< in.txt", "$(whoami)", "`whoami`", "& calc", "%COMSPEC%", '"quoted"', "'quoted'", "\nrm x", "^", "\\server\share"]) {
      expect(runner.refusal(`npm test ${tail}`, { repoRoot: ROOT }), tail).toMatch(/not allowed|not one of/);
    }
    expect(runner.refusal("npm test\n", { repoRoot: ROOT })).not.toBeNull();
    expect(runner.refusal("npm  test", { repoRoot: ROOT })).not.toBeNull();
  });

  it("accepts the verification commands the project actually uses", () => {
    for (const cmd of ["npm run typecheck", "npm run online:typecheck", "npm test", "npm run online:test", "npm --prefix ui-source run typecheck", "npm --prefix ui-source run build", "npm --prefix ui-source run test", "npx tsx analysis/39_league_metrics.ts", "npm run franchise:stress -- --mode smoke"]) {
      expect(runner.refusal(cmd, { repoRoot: ROOT }), cmd).toBeNull();
    }
    expect(runner.refusal("npx vitest run test/verify-selector.test.ts", { repoRoot: ROOT })).toBeNull();
    expect(runner.refusal("npx vitest run --root online --no-file-parallelism test/lobby.test.ts", { repoRoot: ROOT })).toBeNull();
    expect(runner.refusal("npm --prefix ui-source run test -- src/state/reveal.test.ts", { repoRoot: ROOT })).toBeNull();
    expect(runner.refusal("npx vitest related src/throttle.ts --root online --run", { repoRoot: ROOT })).toBeNull();
    expect(runner.refusal("npx vitest related src/state/roasts.ts --run", { repoRoot: ROOT, cwd: "ui-source" })).toBeNull();
  });

  it("every command in the risk map is one it would run", () => {
    for (const [id, c] of Object.entries(sel.loadMap().checks)) {
      for (const cmd of c.commands) {
        if (c.kind !== "command" || cmd.includes("{")) continue;
        expect(runner.refusal(cmd, { repoRoot: ROOT, cwd: (c as { cwd?: string }).cwd ?? "." }), `${id}: ${cmd}`).toBeNull();
      }
    }
  });

  it("records the real exit code and output", async () => {
    const dir = scripts({ ok: "x" , "ok.js": "console.log('Tests  2 passed (2)')" });
    try {
      const rec = await runner.runCheck(check("a", { commands: ["node ok.js"] }), { cwd: dir, policy: testPolicy });
      expect(rec.exitCode).toBe(0);
      expect(rec.output).toContain("Tests  2 passed (2)");
      expect(rec.evidence).toBe("observed");
      expect(v.judge(check("a"), rec).status).toBe("PASSED");
    } finally {
      rmDir(dir);
    }
  });

  it("records a failing exit code, and stops at the first failing command", async () => {
    const dir = scripts({ "bad.js": "process.exit(3)", "next.js": "console.log('not reached')" });
    try {
      const rec = await runner.runCheck(check("a", { commands: ["node bad.js", "node next.js"] }), { cwd: dir, policy: testPolicy });
      expect(rec.exitCode).toBe(3);
      expect(rec.commands).toHaveLength(1);
      expect(rec.output).not.toContain("not reached");
      expect(v.judge(check("a"), rec).status).toBe("FAILED");
    } finally {
      rmDir(dir);
    }
  });

  it("will not run a refused command, runs none of the check's commands if any is refused, and records why", async () => {
    const dir = scripts({ "ok.js": "require('node:fs').writeFileSync('ran.txt','x')" });
    try {
      const rec = await runner.runCheck(check("a", { commands: ["node ok.js", "git push origin master"] }), { cwd: dir, policy: testPolicy });
      expect(rec.exitCode).toBeNull();
      expect(rec.error).toMatch(/refused to run/);
      expect(rec.commands).toEqual([]);
      expect(() => readFileSync(join(dir, "ran.txt"))).toThrow(); // the first, allowed, command did not run either
      expect(v.judge(check("a"), rec).status).toBe("FAILED");
    } finally {
      rmDir(dir);
    }
  });

  it("records a timeout as one", async () => {
    const dir = scripts({ "slow.js": "setTimeout(function(){},2500)" });
    try {
      const rec = await runner.runCheck(check("a", { commands: ["node slow.js"] }), { cwd: dir, timeoutSec: 1, policy: testPolicy });
      expect(rec.timedOut).toBe(true);
      expect(v.judge(check("a"), rec).status).toBe("FAILED");
    } finally {
      rmDir(dir);
    }
  });

  it("passes only the settings a check may set, and refuses any other", async () => {
    const dir = scripts({ "env.js": "console.log('Tests  1 passed (1) ' + process.env.STATS_SEEDS + ' ' + process.env.WENTZ_PROBE + ' ' + process.env.NODE_OPTIONS)" });
    try {
      const rec = await runner.runCheck(check("a", { commands: ["node env.js"], env: { STATS_SEEDS: "12" } }), { cwd: dir, policy: testPolicy, parentEnv: { ...process.env, WENTZ_PROBE: "inherited", NODE_OPTIONS: "--no-warnings" } });
      expect(rec.output).toContain("12 undefined undefined"); // declared setting passed; inherited ones are not
      for (const env of [{ NODE_OPTIONS: "--require x" }, { PATH: "/evil" }, { STATS_SEEDS: "12; rm x" }, { CI: "1" }]) {
        const bad = await runner.runCheck(check("a", { commands: ["node env.js"], env }), { cwd: dir, policy: testPolicy });
        expect(bad.error, JSON.stringify(env)).toMatch(/refused to run/);
        expect(bad.commands).toEqual([]);
      }
    } finally {
      rmDir(dir);
    }
  });

  it("chooses checks by id, tier and level, and leaves out database checks unless asked", () => {
    const P = plan(
      [scope, check("t0", { tier: 0 }), check("t1", { tier: 1 }), check("db", { tier: 1, needsDatabase: true }), ciCheck],
      [check("deep", { tier: 4 })],
    );
    expect(runner.selectChecks(P).map((c) => c.id)).toEqual(["t0", "t1", "deep"]);
    expect(runner.selectChecks(P, { tierMax: 0 }).map((c) => c.id)).toEqual(["t0"]);
    expect(runner.selectChecks(P, { level: "required" }).map((c) => c.id)).toEqual(["t0", "t1"]);
    expect(runner.selectChecks(P, { testDatabase: "local-pglite" }).map((c) => c.id)).toEqual(["t0", "t1", "db", "deep"]);
    // a database that is not a test database on this machine selects no database check at all
    expect(runner.selectChecks(P, { testDatabase: "postgres://u:p@ep-cool-name.neon.tech/neondb" }).map((c) => c.id)).toEqual(["t0", "t1", "deep"]);
    expect(runner.selectChecks(P, { ids: ["t1"] }).map((c) => c.id)).toEqual(["t1"]);
  });
});

describe("the commands, end to end", () => {
  const run = (script: string, args: string[]) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [join(DIR, script), ...args], { encoding: "utf8", stdio: "pipe" }), stderr: "" };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { status: err.status, stdout: err.stdout, stderr: err.stderr };
    }
  };
  const tmp = () => mkdtempSync(join(tmpdir(), "wentz-verdict-"));

  /** A throwaway git repository with a package.json whose scripts the real policy allows. */
  const makeRepo = (typecheckScript = "process.exit(0)") => {
    const dir = tmp();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t", version: "0.0.0", scripts: { typecheck: `node -e "${typecheckScript}"` } }));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    return { dir, git };
  };
  const tcCheck = () => check("tc-engine", { tier: 0, commands: ["npm run typecheck"] });

  it("goes from a change to a verdict, and a docs-only change is locally verified once the scope is confirmed", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "changes.json"), JSON.stringify({ changes: [{ path: "docs/a.md", status: "M", sources: ["unstaged"] }] }));
      const planned = run("select-checks.mjs", ["--cwd", ROOT, "--changes-file", join(dir, "changes.json"), "--json"]);
      expect(planned.status).toBe(0);
      writeFileSync(join(dir, "plan.json"), planned.stdout);
      writeFileSync(join(dir, "results.json"), JSON.stringify({ results: [] }));

      const unconfirmed = run("report.mjs", ["--plan", join(dir, "plan.json"), "--results", join(dir, "results.json")]);
      expect(unconfirmed.status).toBe(4);
      expect(unconfirmed.stdout).toMatch(/INCOMPLETE/);

      const done = run("report.mjs", ["--plan", join(dir, "plan.json"), "--results", join(dir, "results.json"), "--confirm", "scope"]);
      expect(done.status).toBe(0);
      expect(done.stdout).toMatch(/LOCALLY VERIFIED/);

      // a hand-typed CI result changes nothing, and --confirm will not attest a command check
      const typed = run("report.mjs", ["--plan", join(dir, "plan.json"), "--results", join(dir, "results.json"), "--confirm", "scope", "--ci", '{"test":"success","deploy":"skipped","event":"pull_request","validated":true}']);
      expect(typed.stdout).not.toMatch(/Verdict: VERIFIED/);
      expect(typed.stdout).toMatch(/LOCALLY VERIFIED/);
      expect(run("report.mjs", ["--plan", join(dir, "plan.json"), "--results", join(dir, "results.json"), "--confirm", "tc-engine"]).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records a failing check and reports FAILED with a failing exit code", () => {
    const { dir } = makeRepo("process.exit(5)");
    const out = tmp();
    try {
      writeFileSync(join(out, "plan.json"), JSON.stringify(plan([tcCheck()])));
      const ran = run("run-checks.mjs", ["--plan", join(out, "plan.json"), "--out", join(out, "results.json"), "--cwd", dir]);
      expect(ran.status).toBe(0); // the runner records; it does not judge
      const history = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
      expect(history.runs[0]).toMatchObject({ id: "tc-engine", exitCode: 5, evidence: "observed", attempt: 1 });
      expect(history.runs[0].binding.treeDigest).toMatch(/^[0-9a-f]{64}$/);
      const rep = run("report.mjs", ["--plan", join(out, "plan.json"), "--results", join(out, "results.json"), "--cwd", dir]);
      expect(rep.status).toBe(1);
      expect(rep.stdout).toMatch(/Verdict: FAILED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses to run a hand-edited plan that asks for something else, and records no run", () => {
    const { dir } = makeRepo();
    const out = tmp();
    try {
      writeFileSync(join(dir, "marker.txt"), "keep");
      const evil = check("evil", { tier: 0, commands: ['node -e "require(\'fs\').unlinkSync(\'marker.txt\')"'] });
      writeFileSync(join(out, "plan.json"), JSON.stringify(plan([evil])));
      run("run-checks.mjs", ["--plan", join(out, "plan.json"), "--out", join(out, "results.json"), "--cwd", dir]);
      expect(readFileSync(join(dir, "marker.txt"), "utf8")).toBe("keep");
      const history = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
      expect(history.runs[0].error).toMatch(/refused to run/);
      expect(history.runs[0].commands).toEqual([]);
      expect(run("report.mjs", ["--plan", join(out, "plan.json"), "--results", join(out, "results.json"), "--cwd", dir]).stdout).toMatch(/Verdict: FAILED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("says which database checks it left out, and refuses a database that is not a clear test database", () => {
    const { dir } = makeRepo();
    const out = tmp();
    try {
      writeFileSync(join(out, "plan.json"), JSON.stringify(plan([check("db", { needsDatabase: true })])));
      const ran = run("run-checks.mjs", ["--plan", join(out, "plan.json"), "--out", join(out, "results.json"), "--cwd", dir]);
      expect(ran.stdout).toMatch(/not running \(need a database.*\): db/);
      expect(JSON.parse(readFileSync(join(out, "results.json"), "utf8")).runs).toEqual([]);
      for (const bad of ["postgres://u:p@ep-cool-name.neon.tech/neondb", "postgres://localhost:5432/postgres", "postgres://localhost:5433/postgres?host=prod.example.com", "not a url"]) {
        const refused = run("run-checks.mjs", ["--plan", join(out, "plan.json"), "--out", join(out, "results2.json"), "--cwd", dir, "--test-database", bad]);
        expect(refused.status, bad).toBe(2);
        expect(refused.stderr).toMatch(/nothing was run/);
      }
      expect(run("run-checks.mjs", ["--plan", join(out, "plan.json"), "--out", join(out, "r3.json"), "--with-database"]).stderr).toMatch(/--with-database was removed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  describe("results are tied to what they were results of", () => {
    const setup = () => {
      const { dir, git } = makeRepo();
      const out = tmp();
      const planPath = join(out, "plan.json");
      const resultsPath = join(out, "results.json");
      writeFileSync(planPath, JSON.stringify(plan([scope, tcCheck(), ciCheck])));
      const go = () => run("run-checks.mjs", ["--plan", planPath, "--out", resultsPath, "--cwd", dir]);
      const report = (...more: string[]) => run("report.mjs", ["--plan", planPath, "--results", resultsPath, "--cwd", dir, "--confirm", "scope", ...more]);
      const cleanup = () => {
        rmSync(dir, { recursive: true, force: true });
        rmSync(out, { recursive: true, force: true });
      };
      return { dir, git, out, planPath, resultsPath, go, report, cleanup };
    };

    it("counts a result while nothing has changed", () => {
      const t = setup();
      try {
        t.go();
        const r = t.report();
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/LOCALLY VERIFIED/);
        expect(r.stdout).toMatch(/\| tc-engine \| REQUIRED \| PASSED \| observed \|/);
      } finally {
        t.cleanup();
      }
    });

    it("marks a result stale when a file changes afterwards, and no longer counts it", () => {
      const t = setup();
      try {
        t.go();
        writeFileSync(join(t.dir, "new-file.ts"), "export const x = 1;\n");
        const r = t.report();
        expect(r.status).toBe(4);
        expect(r.stdout).toMatch(/INCOMPLETE/);
        expect(r.stdout).toMatch(/stale: its result no longer applies because files in the working tree have changed/);
      } finally {
        t.cleanup();
      }
    });

    it("marks it stale when a tracked file is edited, committed, or the plan or command changes", () => {
      const t = setup();
      try {
        t.go();
        writeFileSync(join(t.dir, "package.json"), JSON.stringify({ name: "t", version: "0.0.1", scripts: { typecheck: 'node -e "process.exit(0)"' } }));
        expect(t.report().stdout).toMatch(/stale/);
        t.git("add", "-A");
        t.git("commit", "-qm", "edit");
        expect(t.report().stdout).toMatch(/HEAD has moved/);
        // a changed command
        t.go();
        expect(t.report().status).toBe(0);
        const edited = JSON.parse(readFileSync(t.planPath, "utf8"));
        edited.required[1].commands = ["npm run typecheck", "npm test"];
        writeFileSync(t.planPath, JSON.stringify(edited));
        expect(t.report().stdout).toMatch(/the plan has changed|the command or its settings have changed/);
      } finally {
        t.cleanup();
      }
    });

    it("keeps an earlier failure in the history and the report after a rerun passes", () => {
      const t = setup();
      try {
        writeFileSync(join(t.dir, "package.json"), JSON.stringify({ name: "t", version: "0.0.0", scripts: { typecheck: 'node -e "process.exit(5)"' } }));
        t.go();
        expect(t.report().status).toBe(1);
        writeFileSync(join(t.dir, "package.json"), JSON.stringify({ name: "t", version: "0.0.0", scripts: { typecheck: 'node -e "process.exit(0)"' } }));
        t.go();
        const history = JSON.parse(readFileSync(t.resultsPath, "utf8"));
        expect(history.runs.map((r: { attempt: number; exitCode: number }) => [r.attempt, r.exitCode])).toEqual([[1, 5], [2, 0]]);
        const r = t.report();
        expect(r.status).toBe(0); // the latest attempt applies to the files as they are now
        expect(r.stdout).toMatch(/Earlier failed attempts/);
        expect(r.stdout).toMatch(/`tc-engine` attempt 1: exit code 5/);
        expect(r.stdout).toMatch(/\[attempt 2\]/);
      } finally {
        t.cleanup();
      }
    });

    it("calls a pass after a failure on identical inputs possibly flaky", () => {
      const s = v.summarize(plan([tcCheck()]), [
        { id: "tc-engine", attempt: 1, exitCode: 1, output: "", evidence: "observed", binding: { planDigest: "p", commandDigest: "c", head: "h", treeDigest: "t" } },
        { id: "tc-engine", attempt: 2, exitCode: 0, output: "", evidence: "observed", binding: { planDigest: "p", commandDigest: "c", head: "h", treeDigest: "t" } },
      ]);
      expect(s.rows[0]?.flaky).toBe(true);
      expect(s.flaky).toEqual(["tc-engine"]);
      expect(v.renderReport(s)).toMatch(/possibly flaky/);
    });

    it("reads a results file in the old format as unbound, which counts for nothing", () => {
      const t = setup();
      try {
        writeFileSync(t.resultsPath, JSON.stringify({ results: [{ id: "tc-engine", exitCode: 0, output: "" }] }));
        const r = t.report();
        expect(r.status).toBe(4);
        expect(r.stdout).toMatch(/carries no binding/);
      } finally {
        t.cleanup();
      }
    });

    it("gets VERIFIED only through --check-ci with GitHub's validated answer for this very commit", async () => {
      const t = setup();
      try {
        t.go();
        const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: t.dir, encoding: "utf8" }).trim();
        const reportMod = await import("../.claude/skills/wentz-verify/report.mjs");
        const answers = (sha: string, deploy = "skipped", base = "master") => async (url: string) => {
          const body = url.includes("/jobs")
            ? { jobs: [{ name: "test", conclusion: "success" }, { name: "deploy", conclusion: deploy }] }
            : url.includes("/pulls/")
              ? { number: 12, state: "open", head: { sha: head, ref: "feat/x", repo: { full_name: "o/r" } }, base: { ref: base, repo: { full_name: "o/r" } } }
              : { workflow_runs: [{ id: 9, head_sha: sha, event: "pull_request", path: ".github/workflows/deploy-render.yml", status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", run_number: 1, html_url: "https://github.com/o/r/actions/runs/9", pull_requests: [{ number: 12, base: { ref: "master" } }] }] };
          return { ok: true, status: 200, json: async () => body } as Response;
        };
        const args = ["--plan", t.planPath, "--results", t.resultsPath, "--cwd", t.dir, "--confirm", "scope", "--check-ci", "--repo", "o/r"];
        const text: string[] = [];
        const write = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((s: string) => (text.push(String(s)), true)) as typeof process.stdout.write;
        let codes: number[];
        try {
          codes = [
            await reportMod.main(args, { fetchImpl: answers(head) as unknown as typeof fetch }),
            await reportMod.main(args, { fetchImpl: answers("f".repeat(40)) as unknown as typeof fetch }), // a different commit
            await reportMod.main(args, { fetchImpl: answers(head, "success") as unknown as typeof fetch }), // deploy ran
            await reportMod.main(args, { fetchImpl: answers(head, "skipped", "feat/wentz-verify-selector") as unknown as typeof fetch }), // retargeted away from master
            await reportMod.main([...args, "--pr", "13"], { fetchImpl: answers(head) as unknown as typeof fetch }), // a different pull request number
          ];
        } finally {
          process.stdout.write = write;
        }
        expect(codes).toEqual([0, 0, 1, 0, 0]);
        expect(text[0]).toMatch(/Verdict: VERIFIED/);
        expect(text[1]).toMatch(/Verdict: LOCALLY VERIFIED/);
        expect(text[1]).toMatch(/no pull_request run/);
        expect(text[2]).toMatch(/Verdict: FAILED/);
        expect(text[3]).toMatch(/Verdict: LOCALLY VERIFIED/);
        expect(text[3]).toMatch(/targets master|targets feat\/wentz-verify-selector, not master/);
        expect(text[4]).toMatch(/Verdict: LOCALLY VERIFIED/);
        expect(text[4]).toMatch(/belongs to pull request #12, not #13/);
      } finally {
        t.cleanup();
      }
    });
  });

  it("exits 2 on bad arguments", () => {
    expect(run("report.mjs", ["--nonsense"]).status).toBe(2);
    expect(run("run-checks.mjs", ["--plan", "x"]).status).toBe(2);
  });
});
