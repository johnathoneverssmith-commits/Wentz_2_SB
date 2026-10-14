import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { Policy } from "../.claude/skills/wentz-verify/command-policy.mjs";
import { createCapture, LIMITS } from "../.claude/skills/wentz-verify/output-signals.mjs";
import * as runner from "../.claude/skills/wentz-verify/run-checks.mjs";
import type { Check, Plan } from "../.claude/skills/wentz-verify/select-checks.mjs";
import * as v from "../.claude/skills/wentz-verify/verdict.mjs";
import type { RunRecord } from "../.claude/skills/wentz-verify/verdict.mjs";

/**
 * The verdict must not depend on how much output a command produced. The runner used to keep the last 16,000
 * characters and judge that, so the database marker (printed once, at the start) vanished from a long successful
 * run, and a failing test's name could vanish from a run that ended green. These tests produce megabytes of
 * output on purpose.
 */
const MARKER = "[test setup] database schema applied once, before any test file (900 ms)";
const FAIL_LINE = " × the unrevealed result stays hidden 4ms";
const SUMMARY = (passed: number) => ` Test Files  3 passed (3)\n      Tests  ${passed} passed (${passed})\n`;

/** The real policy refuses everything but verification commands; this one also runs `node <dir>/<name>.js` scripts the test wrote. */
const policy: Policy = {
  safeCharacters: /^[A-Za-z0-9_@/.:=,+\- ]+$/,
  extra: [(c) => (/^node [a-z0-9/]+\.js$/.test(c) ? { ok: true, kind: "test-script", argv: c.split(" "), cwd: "." } : null)],
};
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // temp
    }
  }
});
/** Scripts in a temporary directory: `files` maps a relative path to the script. */
function scripts(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "wentz-signals-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name.split("/").slice(0, -1).join("/") || "."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}
/** JavaScript that writes `megabytes` of filler in 1 MiB pieces. */
const filler = (megabytes: number) => `{ const piece = ("filler line that is not a summary\\n").repeat(32768); for (let i = 0; i < ${megabytes}; i++) process.stdout.write(piece); }`;
const out = (text: string) => `process.stdout.write(${JSON.stringify(text)});`;

const check = (commands: string[], extra: Partial<Check> = {}): Check => ({
  id: "c", level: "REQUIRED", kind: "command", tier: 1, label: "c", commands, files: [], reasons: [], needsDatabase: false, ...extra,
});
const run = (chk: Check, dir: string, options: { testDatabase?: string } = {}) => runner.runCheck(chk, { cwd: dir, policy, ...options });
const plan = (required: Check[]): Plan =>
  ({ version: 1, base: "origin/master", mergeBase: "abc", empty: false, conservative: false, risk: "high", classes: [], changes: [], unknownSourcePaths: [], unclassifiedPaths: [], scratchPaths: [], problems: [], warnings: [], approvalsNeeded: [], notes: [], needsDatabase: true, required, recommended: [], limitations: ["L1", "L2"], localVersusCi: "" }) as Plan;

describe("the scanner", () => {
  it("keeps the database marker and the summary from the start and end of an output of tens of megabytes, at bounded size", () => {
    const cap = createCapture();
    cap.push("stdout", `${MARKER}\n`);
    const piece = "filler line that is not a summary\n".repeat(32768); // 1 MiB
    for (let i = 0; i < 40; i++) cap.push("stdout", piece);
    cap.push("stdout", SUMMARY(120));
    const r = cap.result();
    expect(r.signals.databaseUsed).toBe(true);
    expect(r.signals.interesting.map((l) => l.trim())).toEqual(["Test Files  3 passed (3)", "Tests  120 passed (120)"]);
    expect(r.chars).toBeGreaterThan(40 * 1024 * 1024);
    expect(r.log.length).toBeLessThanOrEqual(LIMITS.head + LIMITS.tail + 80);
    expect(r.log).toContain("characters omitted");
    expect(r.log.startsWith(MARKER)).toBe(true); // the human log keeps the start too
    expect(r.log.trimEnd().endsWith("Tests  120 passed (120)")).toBe(true);
  });

  it("finds a marker that arrives split across chunks, with CRLF, with colour codes", () => {
    const a = createCapture();
    a.push("stdout", "[test setup] database sch");
    a.push("stdout", "ema applied once, before any test file (1 ms)\n");
    expect(a.result().signals.databaseUsed).toBe(true);
    const b = createCapture();
    b.push("stdout", `\u001b[32m${MARKER}\u001b[39m\r\n`);
    expect(b.result().signals.databaseUsed).toBe(true);
    const c = createCapture();
    c.push("stderr", `DATABASE SCHEMA NOT APPLIED: x`); // no newline at the end of the stream
    expect(c.result().signals.databaseSetupFailed).toBe(true);
  });

  it("counts every failing-test line exactly and keeps a few names", () => {
    const cap = createCapture();
    for (let i = 0; i < 500; i++) cap.push("stdout", ` × test number ${i % 40} fails ${i}ms\n`);
    cap.push("stdout", " FAIL  test/a.test.ts > b\n");
    const s = cap.result().signals;
    expect(s.failureLines).toBe(501);
    expect(s.failureNames).toHaveLength(LIMITS.failureNames);
  });

  it("is not grown by a single enormous line, and reads the lines after it", () => {
    const cap = createCapture({ line: 1000 });
    cap.push("stdout", "z".repeat(50_000));
    cap.push("stdout", `\n${MARKER}\n`);
    const r = cap.result();
    expect(r.signals.databaseUsed).toBe(true);
    expect(r.log.length).toBeLessThan(20_000);
  });

  it("flags more summary lines than it keeps, rather than dropping them quietly", () => {
    const cap = createCapture({ interesting: 3 });
    for (let i = 0; i < 5; i++) cap.push("stdout", `      Tests  ${i} passed (${i})\n`);
    const s = cap.result().signals;
    expect(s.interesting).toHaveLength(3);
    expect(s.interestingOverflow).toBe(2);
  });

  it("counts type errors and keeps stress-test summary lines", () => {
    const cap = createCapture();
    cap.push("stdout", "a.ts(1,1): error TS2322: x\nb.ts(2,2): error TS2304: y\n- Invariant failures and crashes: 0\n- Deterministic replay: identical\n- Team seasons completed: 3\n");
    const s = cap.result().signals;
    expect(s.tscErrors).toBe(2);
    expect(s.interesting).toHaveLength(3);
  });
});

describe("a successful database check with oversized output", () => {
  it("is PASSED: the marker printed at the start is not lost, and the record stays small", async () => {
    const dir = scripts({ "big/vitest.js": `${out(`${MARKER}
`)} ${filler(3)} ${out(SUMMARY(120))}` });
    const chk = check(["node big/vitest.js"], { needsDatabase: true });
    const rec = await run(chk, dir, { testDatabase: "local-pglite" });
    expect(rec.exitCode).toBe(0);
    expect(rec.output.length).toBeLessThanOrEqual(LIMITS.head + LIMITS.tail + 120);
    expect(JSON.stringify(rec).length).toBeLessThan(60_000);
    expect(rec.commandResults?.[0]?.logChars).toBeGreaterThan(3 * 1024 * 1024);
    expect(rec.commandResults?.[0]?.signals?.databaseUsed).toBe(true);
    expect(rec.output.includes(MARKER)).toBe(true); // the start of the log is kept for people as well
    expect(rec.output.slice(-LIMITS.tail).includes(MARKER)).toBe(false); // while the last part alone (all the old runner kept) has no marker
    expect(v.judge(chk, rec)).toMatchObject({ status: "PASSED", detail: "120 passed" });
  });

  it("control: judged from the last 16,000 characters alone, as before, the same run reads as never having used a database", () => {
    const lastOnly = `${"filler line that is not a summary\n".repeat(900).slice(-15_000)}${SUMMARY(120)}`;
    const j = v.judge(check(["npx vitest run --root online test/lobby.test.ts"], { needsDatabase: true }), { id: "c", exitCode: 0, output: lastOnly });
    expect(j.status).toBe("SKIPPED");
  });
});

describe("a database check that never used a database", () => {
  it("is SKIPPED even when a test database was selected and the exit code was 0", async () => {
    const dir = scripts({ "big/vitest.js": `${filler(3)} ${out(SUMMARY(311))}` });
    const chk = check(["node big/vitest.js"], { needsDatabase: true });
    const rec = await run(chk, dir, { testDatabase: "local-pglite" });
    expect(rec.exitCode).toBe(0);
    expect(rec.database).toBe("local PGlite on localhost:5433"); // authorized and selected...
    expect(rec.commandResults?.[0]?.signals?.databaseUsed).toBe(false); // ...and not used
    expect(v.judge(chk, rec).status).toBe("SKIPPED");
    expect(v.summarize(plan([chk]), [rec]).verdict).toBe("INCOMPLETE");
  });

  it("is not rescued by a marker-looking line that is not the marker", async () => {
    const dir = scripts({ "x/vitest.js": `${out("database schema applied once\
[test setup] schema is fine\
")} ${out(SUMMARY(5))}` });
    const chk = check(["node x/vitest.js"], { needsDatabase: true });
    expect(v.judge(chk, await run(chk, dir, { testDatabase: "local-pglite" })).status).toBe("SKIPPED");
  });

  it("is FAILED when the schema could not be applied, wherever that was printed", async () => {
    const dir = scripts({ "x/vitest.js": `${out("[test setup] DATABASE SCHEMA NOT APPLIED: boom\
")} ${filler(2)} ${out(SUMMARY(5))}` });
    const chk = check(["node x/vitest.js"], { needsDatabase: true });
    expect(v.judge(chk, await run(chk, dir, { testDatabase: "local-pglite" })).status).toBe("FAILED");
  });
});

describe("failure evidence survives truncation", () => {
  it("an explicit failing-test line at the start of a long, green-looking run still fails it", async () => {
    const dir = scripts({ "f/vitest.js": `${out(`${FAIL_LINE}
 FAIL  test/a.test.ts > the unrevealed result stays hidden
`)} ${filler(3)} ${out(SUMMARY(17))}` });
    const chk = check(["node f/vitest.js"]);
    const rec = await run(chk, dir);
    expect(rec.exitCode).toBe(0);
    expect(rec.output.includes("unrevealed")).toBe(true); // the head of the log has it...
    // control: judged from the tail alone, as the old runner did, the same run reads as a pass: this is the defect
    const tailOnly = { id: "c", exitCode: 0, output: rec.output.slice(-LIMITS.tail) } as RunRecord;
    expect(v.judge(chk, tailOnly).status).toBe("PASSED");
    const j = v.judge(chk, rec);
    expect(j.status).toBe("FAILED");
    expect(j.detail).toMatch(/2 failing test line/);
    expect(j.failures).toContain("the unrevealed result stays hidden");
  });

  it("a failure printed in the middle of megabytes is counted, though neither the head nor the tail has it", async () => {
    const dir = scripts({ "m/vitest.js": `${filler(2)} ${out(`${FAIL_LINE}
`)} ${filler(2)} ${out(SUMMARY(17))}` });
    const chk = check(["node m/vitest.js"]);
    const rec = await run(chk, dir);
    expect(rec.output.includes("unrevealed")).toBe(false);
    expect(rec.commandResults?.[0]?.signals?.failureLines).toBe(1);
    expect(v.judge(chk, rec).status).toBe("FAILED");
  });

  it("a failed-test count in an early summary is not hidden by a clean last one", async () => {
    const dir = scripts({ "s/vitest.js": `${out(" Tests  2 failed | 8 passed (10)\
")} ${filler(2)} ${out(SUMMARY(17))}` });
    const chk = check(["node s/vitest.js"]);
    expect(v.judge(chk, await run(chk, dir)).status).toBe("FAILED");
  });

  it("type errors are counted from the whole output", async () => {
    const dir = scripts({ "t/tsc.js": `${out("a.ts(1,1): error TS2322: nope\
")} ${filler(2)}` });
    const chk = check(["node t/tsc.js"]);
    const j = v.judge(chk, await run(chk, dir));
    expect(j).toMatchObject({ status: "FAILED", detail: expect.stringMatching(/1 type error/) });
  });

  it("more summary lines than can be read is never a pass", async () => {
    const lines = Array.from({ length: LIMITS.interesting + 5 }, (_, i) => `      Tests  ${i} passed (${i})`).join("\n");
    const dir = scripts({ "o/vitest.js": out(`${lines}\n`) });
    const chk = check(["node o/vitest.js"]);
    expect(v.judge(chk, await run(chk, dir))).toMatchObject({ status: "FAILED", detail: expect.stringMatching(/more test summaries than can be read/) });
  });
});

describe("a check with several commands keeps evidence for each", () => {
  const two = (a: string, b: string) => scripts({ "a/vitest.js": a, "b/vitest.js": b });
  const withMarker = (n: number) => `${out(`${MARKER}
`)} ${filler(1)} ${out(SUMMARY(n))}`;
  const chk = check(["node a/vitest.js", "node b/vitest.js"], { needsDatabase: true });

  it("both used a database: PASSED, the counts added, each command's own entry recorded", async () => {
    const rec = await run(chk, two(withMarker(10), withMarker(7)), { testDatabase: "local-pglite" });
    expect(rec.commandResults?.map((r) => r.command)).toEqual(["node a/vitest.js", "node b/vitest.js"]);
    expect(rec.commandResults?.map((r) => r.exitCode)).toEqual([0, 0]);
    expect(rec.commandResults?.every((r) => r.signals?.databaseUsed)).toBe(true);
    expect(v.judge(chk, rec)).toMatchObject({ status: "PASSED", detail: "17 passed across 2 test runs" });
  });

  it("one marker does not vouch for another command: the second without it is SKIPPED, and named", async () => {
    const rec = await run(chk, two(withMarker(10), `${filler(1)} ${out(SUMMARY(7))}`), { testDatabase: "local-pglite" });
    expect(rec.commandResults?.map((r) => r.signals?.databaseUsed)).toEqual([true, false]);
    const j = v.judge(chk, rec);
    expect(j.status).toBe("SKIPPED");
    expect(j.detail).toContain("node b/vitest.js");
    expect(j.detail).not.toContain("node a/vitest.js");
  });

  it("the second fails: FAILED, the first command's evidence is intact, and the run stopped there", async () => {
    const rec = await run(chk, two(withMarker(10), `${out(`${FAIL_LINE}
`)} process.exit(1);`), { testDatabase: "local-pglite" });
    expect(rec.commandResults).toHaveLength(2);
    expect(rec.commandResults?.[0]).toMatchObject({ exitCode: 0 });
    expect(rec.commandResults?.[0]?.signals?.databaseUsed).toBe(true);
    expect(rec.commandResults?.[1]).toMatchObject({ exitCode: 1 });
    expect(rec.exitCode).toBe(1);
    expect(v.judge(chk, rec).status).toBe("FAILED");
  });

  it("a failure in the first command is not outvoted by a green second", async () => {
    const first = `${out(`${FAIL_LINE}\n`)} ${out(`${MARKER}\n`)} ${out(SUMMARY(3))}`;
    const rec = await run(chk, two(first, withMarker(7)), { testDatabase: "local-pglite" });
    expect(rec.exitCode).toBe(0);
    expect(v.judge(chk, rec).status).toBe("FAILED");
  });

  it("a command that is not Vitest needs no marker, and its type errors still count", async () => {
    const dir = scripts({ "a/vitest.js": withMarker(5), "t/tsc.js": out("x.ts(1,1): error TS2322: no\
") });
    const mixed = check(["node a/vitest.js", "node t/tsc.js"], { needsDatabase: true });
    const rec = await run(mixed, dir, { testDatabase: "local-pglite" });
    expect(v.judge(mixed, rec).status).toBe("FAILED");
    const clean = scripts({ "a/vitest.js": withMarker(5), "t/tsc.js": out("done\
") });
    expect(v.judge(mixed, await run(mixed, clean, { testDatabase: "local-pglite" })).status).toBe("PASSED");
  });
});

describe("the verdict stays conservative when the evidence is not enough", () => {
  const chk = check(["node a/vitest.js", "node b/vitest.js"], { needsDatabase: true });
  const good = { command: "node a/vitest.js", exitCode: 0, signals: { interesting: ["      Tests  4 passed (4)"], interestingOverflow: 0, failureLines: 0, failureNames: [], tscErrors: 0, databaseUsed: true, databaseSetupFailed: false, lines: 3 } };

  it("evidence for fewer commands than ran, with exit 0, is not counted", () => {
    const rec = { id: "c", exitCode: 0, commands: ["node a/vitest.js", "node b/vitest.js"], commandResults: [good], evidence: "observed" } as RunRecord;
    expect(v.judge(chk, rec).status).toBe("NOT_RUN");
  });

  it("evidence with no signals at all is not a pass", () => {
    const rec = { id: "c", exitCode: 0, commands: ["node a/vitest.js"], commandResults: [{ command: "node a/vitest.js", exitCode: 0 }], evidence: "observed" } as RunRecord;
    expect(v.judge(check(["node a/vitest.js"]), rec).status).toBe("FAILED"); // exit 0 but no test summary could be read
  });

  it("a timeout keeps its evidence and is FAILED", async () => {
    const dir = scripts({ "w/vitest.js": `${out(MARKER + "\
")} setInterval(function () {}, 1000);` });
    const slow = check(["node w/vitest.js"], { needsDatabase: true });
    const rec = await runner.runCheck(slow, { cwd: dir, policy, testDatabase: "local-pglite", timeoutSec: 2 });
    expect(rec.timedOut).toBe(true);
    expect(rec.commandResults?.[0]).toMatchObject({ timedOut: true, exitCode: null });
    expect(rec.commandResults?.[0]?.signals?.databaseUsed).toBe(true);
    expect(v.judge(slow, rec).status).toBe("FAILED");
  });

  it("records from before this change (output only) are judged as they always were", () => {
    expect(v.judge(check(["npx vitest run test/a.test.ts"]), { id: "c", exitCode: 0, output: SUMMARY(9) })).toMatchObject({ status: "PASSED", detail: "9 passed" });
    expect(v.judge(check(["npx vitest run test/a.test.ts"], { needsDatabase: true }), { id: "c", exitCode: 0, output: SUMMARY(9) }).status).toBe("SKIPPED");
  });
});

describe("a check that needs a database, end to end through the verdict", () => {
  it("a long successful run is LOCALLY VERIFIED; the same run without the marker stays INCOMPLETE", async () => {
    const chk = check(["node big/vitest.js"], { needsDatabase: true });
    const withDb = scripts({ "big/vitest.js": `${out(MARKER + "\
")} ${filler(4)} ${out(SUMMARY(311))}` });
    const without = scripts({ "big/vitest.js": `${filler(4)} ${out(SUMMARY(311))}` });
    const a = await run(chk, withDb, { testDatabase: "local-pglite" });
    const b = await run(chk, without, { testDatabase: "local-pglite" });
    expect(v.summarize(plan([chk]), [a]).verdict).toBe("LOCALLY_VERIFIED");
    expect(v.summarize(plan([chk]), [b]).verdict).toBe("INCOMPLETE");
  });
});

describe("memory", () => {
  it("a command that prints more than a hundred megabytes leaves a small record and a correct reading", async () => {
    const dir = scripts({ "h/vitest.js": `${out(MARKER + "\
")} ${filler(120)} ${out(SUMMARY(42))}` });
    const chk = check(["node h/vitest.js"], { needsDatabase: true });
    const started = Date.now();
    const rec = await run(chk, dir, { testDatabase: "local-pglite" });
    expect(rec.commandResults?.[0]?.logChars).toBeGreaterThan(120 * 1024 * 1024);
    expect(JSON.stringify(rec).length).toBeLessThan(60_000);
    expect(v.judge(chk, rec)).toMatchObject({ status: "PASSED", detail: "42 passed" });
    expect(Date.now() - started).toBeLessThan(120_000);
  }, 180_000);
});

describe("a line too long to hold is still read to its end", () => {
  const long = (n: number) => "x".repeat(n);
  const stream = (name: "stdout" | "stderr", text: string) => `process.${name}.write(${JSON.stringify(text)});`;
  /** Delivers `text` in chunks, the way a pipe does. */
  const feed = (cap: ReturnType<typeof createCapture>, name: "stdout" | "stderr", text: string, size = 50_000) => {
    for (let i = 0; i < text.length; i += size) cap.push(name, text.slice(i, i + size));
  };
  /** A line of `total` characters with `needle` at `at`: past the first piece, inside what used to be thrown away. */
  const lineWith = (needle: string, at: number, total: number) => `${long(at)} ${needle} ${long(total - at - needle.length - 2)}`;

  for (const name of ["stdout", "stderr"] as const) {
    it(`${name}: a type error past the first ${LIMITS.line} characters of a line is counted`, () => {
      const cap = createCapture();
      feed(cap, name, `${lineWith("error TS2322: late", 100_000, 300_000)}\n`);
      expect(cap.result().signals.tscErrors).toBe(1);
    });

    it(`${name}: a type error on the unfinished last line, with no newline, is counted`, () => {
      const cap = createCapture();
      feed(cap, name, lineWith("error TS2322: late", 100_000, 300_000));
      expect(cap.result().signals.tscErrors).toBe(1);
    });

    it(`${name}: a database marker deep inside one long line is seen`, () => {
      const cap = createCapture();
      feed(cap, name, `${lineWith(MARKER, 90_000, 400_000)}\n`);
      expect(cap.result().signals.databaseUsed).toBe(true);
    });

    it(`${name}: a marker or a type error cut in two by the end of a piece is still seen`, () => {
      for (const target of [MARKER, "error TS2322: late"]) {
        for (let cut = 1; cut < target.length; cut += 3) {
          const cap = createCapture({ line: 1000, overlap: 64 });
          cap.push(name, `${long(1100)} ${target.slice(0, cut)}`);
          cap.push(name, `${target.slice(cut)}\n`);
          const s = cap.result().signals;
          if (target === MARKER) expect(s.databaseUsed, `marker cut at ${cut}`).toBe(true);
          else expect(s.tscErrors, `error cut at ${cut}`).toBeGreaterThanOrEqual(1);
        }
      }
    });
  }

  it("a type error is not counted twice when the same line is read in overlapping pieces", () => {
    const cap = createCapture({ line: 1000, overlap: 64 });
    feed(cap, "stdout", `${long(990)} error TS2322: a ${long(3000)}\n`, 700);
    expect(cap.result().signals.tscErrors).toBe(1);
  });

  it("many chunks of one endless line cost bounded memory and every piece is scanned", () => {
    const cap = createCapture({ line: 4096 });
    for (let i = 0; i < 500; i++) cap.push("stdout", long(10_000));
    cap.push("stdout", " error TS2322: at the very end\n");
    const r = cap.result();
    expect(r.signals.tscErrors).toBe(1);
    expect(r.log.length).toBeLessThan(20_000);
  });

  it("the first piece is still read as a line, and a later piece does not become a fake one", () => {
    const cap = createCapture({ line: 1000 });
    feed(cap, "stdout", `${FAIL_LINE}${long(3000)}\n`, 700);
    expect(cap.result().signals.failureLines).toBe(1);
    const mid = createCapture({ line: 1000 });
    feed(mid, "stdout", `${long(1500)} × not at the start of its line ${long(1500)}\n`, 700);
    expect(mid.result().signals.failureLines).toBe(0);
  });

  for (const name of ["stdout", "stderr"] as const) {
    it(`${name}: end to end, an error in an oversized line followed by a passing summary is not a PASS`, async () => {
      const dir = scripts({ "o/tsc.js": `${stream(name, `${lineWith("error TS2322: late", 100_000, 300_000)}\n`)} ${stream("stdout", "all fine\n")}` });
      const chk = check(["node o/tsc.js"]);
      const j = v.judge(chk, await run(chk, dir));
      expect(j).toMatchObject({ status: "FAILED", detail: expect.stringMatching(/1 type error/) });
    });

    it(`${name}: end to end, a database marker inside an oversized line counts as used`, async () => {
      const dir = scripts({ "o/vitest.js": `${stream(name, `${lineWith(MARKER, 100_000, 300_000)}\n`)} ${out(SUMMARY(4))}` });
      const chk = check(["node o/vitest.js"], { needsDatabase: true });
      expect(v.judge(chk, await run(chk, dir, { testDatabase: "local-pglite" }))).toMatchObject({ status: "PASSED" });
    });
  }
});

describe("every test command must itself have run tests", () => {
  const SKIPPED_ALL = " Test Files  1 skipped (1)\n      Tests  5 skipped (5)\n";
  const ZERO = " Test Files  0 passed (0)\n      Tests  0 passed (0)\n";
  const pair = (a: string, b: string) => scripts({ "a/vitest.js": a, "b/vitest.js": b });
  const marked = (summary: string) => `${out(`${MARKER}\n`)} ${out(summary)}`;
  const chk = check(["node a/vitest.js", "node b/vitest.js"], { needsDatabase: true });
  const judged = async (a: string, b: string) => v.judge(chk, await run(chk, pair(a, b), { testDatabase: "local-pglite" }));

  it("control: two database commands that both ran tests are PASSED", async () => {
    expect(await judged(marked(SUMMARY(3)), marked(SUMMARY(2)))).toMatchObject({ status: "PASSED" });
  });

  it("a command whose tests are all skipped is not masked by a passing one (marker present on both)", async () => {
    const j = await judged(marked(SUMMARY(3)), marked(SKIPPED_ALL));
    expect(j.status).toBe("SKIPPED");
    expect(j.detail).toContain("node b/vitest.js");
    expect(j.detail).toMatch(/5 test\(s\) skipped/);
  });

  it("the same, in the other order", async () => {
    const j = await judged(marked(SKIPPED_ALL), marked(SUMMARY(3)));
    expect(j.status).toBe("SKIPPED");
    expect(j.detail).toContain("node a/vitest.js");
  });

  it("a command that ran zero tests is not masked by a passing one", async () => {
    const j = await judged(marked(SUMMARY(3)), marked(ZERO));
    expect(j.status).toBe("SKIPPED");
    expect(j.detail).toContain("node b/vitest.js");
  });

  it("a command with no summary at all is FAILED, and named, though another passed", async () => {
    const j = await judged(marked(SUMMARY(3)), out(`${MARKER}\nno summary here\n`));
    expect(j.status).toBe("FAILED");
    expect(j.detail).toMatch(/no test summary/);
    expect(j.detail).toContain("node b/vitest.js");
  });

  it("a mix of skipped and summary-less commands is FAILED (the stronger finding)", async () => {
    expect((await judged(marked(SKIPPED_ALL), out(`${MARKER}\n`))).status).toBe("FAILED");
  });

  it("each database command still needs its own marker", async () => {
    const j = await judged(marked(SUMMARY(3)), out(SUMMARY(2)));
    expect(j.status).toBe("SKIPPED");
    expect(j.detail).toContain("node b/vitest.js");
  });

  it("a command that is not Vitest is not asked for a test summary", async () => {
    const dir = scripts({ "a/vitest.js": marked(SUMMARY(3)), "t/tsc.js": out("ok\n") });
    const mixed = check(["node a/vitest.js", "node t/tsc.js"], { needsDatabase: true });
    expect(v.judge(mixed, await run(mixed, dir, { testDatabase: "local-pglite" }))).toMatchObject({ status: "PASSED" });
  });

  it("a hand-built record with a skipped command beside a passing one is not a PASS either", () => {
    const sig = (summary: string) => ({ interesting: summary.split("\n").filter(Boolean), interestingOverflow: 0, failureLines: 0, failureNames: [], tscErrors: 0, databaseUsed: true, databaseSetupFailed: false, lines: 2 });
    const rec = {
      id: "c", exitCode: 0, output: "", durationSec: 1, timedOut: false, evidence: "observed", commands: ["node a/vitest.js", "node b/vitest.js"],
      commandResults: [
        { command: "node a/vitest.js", exitCode: 0, signals: sig(SUMMARY(3)) },
        { command: "node b/vitest.js", exitCode: 0, signals: sig(SKIPPED_ALL) },
      ],
    } as unknown as RunRecord;
    expect(v.judge(chk, rec).status).toBe("SKIPPED");
  });
});
