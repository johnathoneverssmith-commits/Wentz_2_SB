import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as sel from "../.claude/skills/wentz-verify/select-checks.mjs";
import type { Check, Plan } from "../.claude/skills/wentz-verify/select-checks.mjs";
import * as io from "../.claude/skills/wentz-verify/io.mjs";
import * as runner from "../.claude/skills/wentz-verify/run-checks.mjs";
import * as v from "../.claude/skills/wentz-verify/verdict.mjs";
import type { RunRecord } from "../.claude/skills/wentz-verify/verdict.mjs";

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
const ci = (extra: Partial<NonNullable<RunRecord["ci"]>> = {}): RunRecord => ({ id: "ci-pr", ci: { test: "success", deploy: "skipped", event: "pull_request", ...extra } });
const scope = check("scope", { kind: "manual", commands: [] });
const ciCheck = check("ci-pr", { kind: "ci", commands: [], tier: 5 });
const confirmed = (id: string): RunRecord => ({ id, status: "CONFIRMED" });

describe("reading a runner's output", () => {
  it("reads vitest's counts", () => {
    const p = v.parseTestOutput(" Test Files  2 failed | 5 passed | 1 skipped (8)\n      Tests  3 failed | 40 passed | 2 skipped (45)\n");
    expect(p.tests).toEqual({ passed: 40, failed: 3, skipped: 2, todo: 0, total: 45 });
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

  it("needs a human's word for a manual check, and GitHub's for CI", () => {
    const m = check("scope", { kind: "manual", commands: [] });
    expect(v.judge(m, undefined).status).toBe("NOT_RUN");
    expect(v.judge(m, { id: "scope", status: "PASSED" }).status).toBe("NOT_RUN"); // only CONFIRMED counts
    expect(v.judge(m, confirmed("scope")).status).toBe("CONFIRMED");
    expect(v.judge(ciCheck, undefined).status).toBe("PENDING_CI");
  });

  it("judges CI: test must succeed, and a pull request must not deploy", () => {
    expect(v.judge(ciCheck, ci()).status).toBe("PASSED");
    expect(v.judge(ciCheck, ci({ test: "failure" })).status).toBe("FAILED");
    expect(v.judge(ciCheck, ci({ deploy: "success" })).status).toBe("FAILED");
    expect(v.judge(ciCheck, ci({ deploy: "success", event: "push" })).status).toBe("PASSED");
    expect(v.judge(ciCheck, { id: "ci-pr", ci: { event: "pull_request" } }).status).toBe("FAILED");
  });
});

describe("the overall verdict", () => {
  const P = plan([scope, check("tc"), check("tests"), ciCheck]);
  const allGood = [confirmed("scope"), ok("tc"), ok("tests")];

  it("is FAILED when one required check failed among many passes", () => {
    const s = v.summarize(P, [...allGood.slice(0, 2), { id: "tests", exitCode: 1, output: PASS }, ci()]);
    expect(s.verdict).toBe("FAILED");
    expect(s.failed).toEqual(["tests"]);
    expect(v.exitCodeFor(s.verdict)).toBe(1);
  });

  it("is FAILED when only a RECOMMENDED check failed: a failure is never an overall pass", () => {
    const rec = plan([scope, ciCheck], [check("deep")]);
    const s = v.summarize(rec, [confirmed("scope"), { id: "deep", exitCode: 1, output: "" }, ci()]);
    expect(s.verdict).toBe("FAILED");
  });

  it("is FAILED even when CI passed if a local check failed", () => {
    expect(v.summarize(P, [...allGood.slice(0, 2), { id: "tests", exitCode: 2 }, ci()]).verdict).toBe("FAILED");
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

  it("is VERIFIED only when CI has passed too", () => {
    const s = v.summarize(P, [...allGood, ci()]);
    expect(s.verdict).toBe("VERIFIED");
    expect(v.renderReport(s)).not.toMatch(/NOT the CI result/);
  });

  it("never reaches VERIFIED on the strength of local results alone", () => {
    for (const results of [allGood, [...allGood, { id: "ci-pr", status: "PASSED" } as RunRecord]]) {
      expect(v.summarize(P, results).verdict).not.toBe("VERIFIED");
    }
  });

  it("is FAILED when CI failed, or a pull request deployed", () => {
    expect(v.summarize(P, [...allGood, ci({ test: "failure" })]).verdict).toBe("FAILED");
    expect(v.summarize(P, [...allGood, ci({ deploy: "success" })]).verdict).toBe("FAILED");
  });

  it("is BLOCKED by a problem in the change, whatever passed", () => {
    const blocked = plan(P.required, [], { problems: ["online/test/_x.test.ts looks like a scratch file but is staged"] });
    const s = v.summarize(blocked, [...allGood, ci()]);
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
  const node = (script: string) => `node -e "${script}"`;

  it("refuses anything that is not npm, npx or node, and any shell operator", () => {
    expect(runner.refusal("git push origin master")).toMatch(/not npm, npx or node/);
    expect(runner.refusal("curl https://example.com")).not.toBeNull();
    expect(runner.refusal("gh pr merge 4")).not.toBeNull();
    expect(runner.refusal("rm -rf node_modules")).not.toBeNull();
    expect(runner.refusal("npm test && git push")).toMatch(/shell operator/);
    expect(runner.refusal("npm test; rm x")).toMatch(/shell operator/);
    expect(runner.refusal("npm test | tee out")).toMatch(/shell operator/);
    expect(runner.refusal("npm test > out.txt")).toMatch(/shell operator/);
    expect(runner.refusal("npm test $(whoami)")).toMatch(/shell operator/);
    expect(runner.refusal("npm run typecheck")).toBeNull();
    expect(runner.refusal("npx vitest run --root online test/a.test.ts")).toBeNull();
    expect(runner.refusal("npm --prefix ui-source run test -- src/state/a.test.ts")).toBeNull();
  });

  it("every command in the risk map is one it would run", () => {
    for (const [id, c] of Object.entries(sel.loadMap().checks)) {
      for (const cmd of c.commands) {
        if (c.kind === "command") expect(runner.refusal(cmd), `${id}: ${cmd}`).toBeNull();
      }
    }
  });

  it("records the real exit code and output", () => {
    const rec = runner.runCheck(check("a", { commands: [node("console.log('Tests  2 passed (2)')")] }), { cwd: ROOT });
    expect(rec.exitCode).toBe(0);
    expect(rec.output).toContain("Tests  2 passed (2)");
    expect(v.judge(check("a"), rec).status).toBe("PASSED");
  });

  it("records a failing exit code, and stops at the first failing command", () => {
    const rec = runner.runCheck(check("a", { commands: [node("process.exit(3)"), node("console.log('not reached')")] }), { cwd: ROOT });
    expect(rec.exitCode).toBe(3);
    expect(rec.commands).toHaveLength(1);
    expect(rec.output).not.toContain("not reached");
    expect(v.judge(check("a"), rec).status).toBe("FAILED");
  });

  it("will not run a refused command, and records that nothing ran", () => {
    const rec = runner.runCheck(check("a", { commands: ["git push origin master"] }), { cwd: ROOT });
    expect(rec.exitCode).toBeNull();
    expect(rec.error).toMatch(/refused to run/);
    expect(rec.commands).toEqual([]);
    expect(v.judge(check("a"), rec).status).toBe("FAILED");
  });

  it("records a timeout as one", () => {
    const rec = runner.runCheck(check("a", { commands: [node("setTimeout(function(){},4000)")] }), { cwd: ROOT, timeoutSec: 1 });
    expect(rec.timedOut).toBe(true);
    expect(v.judge(check("a"), rec).status).toBe("FAILED");
  });

  it("passes a check's environment to its command", () => {
    const rec = runner.runCheck(check("a", { commands: [node("console.log('Tests  1 passed (1) ' + process.env.WENTZ_PROBE)")], env: { WENTZ_PROBE: "hello" } }), { cwd: ROOT });
    expect(rec.output).toContain("hello");
  });

  it("chooses checks by id, tier and level, and leaves out database checks unless asked", () => {
    const P = plan(
      [scope, check("t0", { tier: 0 }), check("t1", { tier: 1 }), check("db", { tier: 1, needsDatabase: true }), ciCheck],
      [check("deep", { tier: 4 })],
    );
    expect(runner.selectChecks(P).map((c) => c.id)).toEqual(["t0", "t1", "deep"]);
    expect(runner.selectChecks(P, { tierMax: 0 }).map((c) => c.id)).toEqual(["t0"]);
    expect(runner.selectChecks(P, { level: "required" }).map((c) => c.id)).toEqual(["t0", "t1"]);
    expect(runner.selectChecks(P, { withDatabase: true }).map((c) => c.id)).toEqual(["t0", "t1", "db", "deep"]);
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records a failing check and reports FAILED with a failing exit code", () => {
    const dir = tmp();
    try {
      const P = plan([check("boom", { tier: 0, commands: ['node -e "process.exit(5)"'] })]);
      writeFileSync(join(dir, "plan.json"), JSON.stringify(P));
      const ran = run("run-checks.mjs", ["--plan", join(dir, "plan.json"), "--out", join(dir, "results.json"), "--cwd", ROOT]);
      expect(ran.status).toBe(0); // the runner records; it does not judge
      expect(JSON.parse(readFileSync(join(dir, "results.json"), "utf8")).results[0]).toMatchObject({ id: "boom", exitCode: 5 });
      const rep = run("report.mjs", ["--plan", join(dir, "plan.json"), "--results", join(dir, "results.json")]);
      expect(rep.status).toBe(1);
      expect(rep.stdout).toMatch(/Verdict: FAILED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says which database checks it left out", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "plan.json"), JSON.stringify(plan([check("db", { needsDatabase: true })])));
      const ran = run("run-checks.mjs", ["--plan", join(dir, "plan.json"), "--out", join(dir, "results.json")]);
      expect(ran.stdout).toMatch(/not running \(need a database.*\): db/);
      expect(JSON.parse(readFileSync(join(dir, "results.json"), "utf8")).results).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 on bad arguments", () => {
    expect(run("report.mjs", ["--nonsense"]).status).toBe(2);
    expect(run("run-checks.mjs", ["--plan", "x"]).status).toBe(2);
  });
});

describe("reading the files the scripts pass to each other", () => {
  const sample = JSON.stringify({ results: [{ id: "x", exitCode: 0 }] });
  const write = (bytes: Buffer) => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-io-"));
    const file = join(dir, "f.json");
    writeFileSync(file, bytes);
    return { file, dir };
  };
  const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const utf16be = (text: string) => {
    const body = Buffer.from(text, "utf16le");
    body.swap16();
    return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
  };

  it.each([
    ["plain UTF-8", () => Buffer.from(sample, "utf8")],
    ["UTF-8 with a byte-order mark (PowerShell Out-File -Encoding utf8)", () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sample, "utf8")])],
    ["UTF-16 LE with a byte-order mark (a PowerShell 5.1 redirect)", () => utf16le(sample)],
    ["UTF-16 BE with a byte-order mark", () => utf16be(sample)],
  ])("reads %s", (_name, make) => {
    const { file, dir } = write(make());
    try {
      expect(io.readJson(file)).toEqual({ results: [{ id: "x", exitCode: 0 }] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps non-ASCII text intact", () => {
    const { file, dir } = write(utf16le('{"s":"× é ✓"}'));
    try {
      expect(io.readJson(file)).toEqual({ s: "× é ✓" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets report.mjs judge a plan and results that PowerShell wrote as UTF-16", () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-io-"));
    try {
      const P = plan([scope]);
      writeFileSync(join(dir, "plan.json"), utf16le(JSON.stringify(P)));
      writeFileSync(join(dir, "results.json"), utf16le(JSON.stringify({ results: [] })));
      const out = execFileSync(process.execPath, [join(DIR, "report.mjs"), "--plan", join(dir, "plan.json"), "--results", join(dir, "results.json"), "--confirm", "scope"], { encoding: "utf8" });
      expect(out).toMatch(/LOCALLY VERIFIED/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the plan with --out as UTF-8 with no byte-order mark, which the other scripts read", () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-io-"));
    try {
      writeFileSync(join(dir, "changes.json"), JSON.stringify({ changes: [{ path: "docs/a.md", status: "M", sources: ["unstaged"] }] }));
      execFileSync(process.execPath, [join(DIR, "select-checks.mjs"), "--cwd", ROOT, "--changes-file", join(dir, "changes.json"), "--out", join(dir, "plan.json")], { encoding: "utf8" });
      const bytes = readFileSync(join(dir, "plan.json"));
      expect(bytes[0]).toBe(0x7b); // "{", not a byte-order mark
      expect((JSON.parse(bytes.toString("utf8")) as Plan).required.map((c) => c.id)).toEqual(["scope"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
