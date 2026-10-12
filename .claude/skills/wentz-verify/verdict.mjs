/**
 * Turns what was actually run into a status per check and one overall verdict,
 * and renders the report. It exists so that "all green" cannot be written
 * while something failed, was skipped, or was never run.
 *
 * The rules are small and strict:
 *   - a command that exited non-zero FAILED, whatever its output says;
 *   - a command that exited 0 but whose output reports failures FAILED;
 *   - tests that all skipped, or none that ran, are SKIPPED, not PASSED;
 *   - a check that needs a database is SKIPPED unless the output shows the
 *     database was really used (the suites return early without one, and a
 *     test runner counts an early return as a pass);
 *   - one FAILED check anywhere, required or recommended, makes the verdict FAILED;
 *   - a required check that was not run makes the verdict INCOMPLETE;
 *   - nothing local can make the verdict VERIFIED: only a passing CI run can.
 */

/** Overall verdicts, worst first. */
export const VERDICTS = ["BLOCKED", "FAILED", "INCOMPLETE", "LOCALLY_VERIFIED", "VERIFIED"];
export const STATUSES = ["PASSED", "FAILED", "SKIPPED", "NOT_RUN", "PENDING_CI", "CONFIRMED"];

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Counts from a vitest summary line such as `Tests  3 failed | 12 passed | 1 skipped (16)`. */
function counts(line) {
  const out = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  if (!line) return null;
  for (const m of line.matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) out[m[2]] = Number(m[1]);
  const total = /\((\d+)\)/.exec(line);
  out.total = total ? Number(total[1]) : out.passed + out.failed + out.skipped + out.todo;
  return out;
}

/** What a test or typecheck run says about itself. Reads text only. */
export function parseTestOutput(raw = "") {
  const text = String(raw).replace(ANSI, "");
  const tests = counts(/^\s*Tests\s+(.*)$/m.exec(text)?.[0] ?? "");
  const files = counts(/^\s*Test Files\s+(.*)$/m.exec(text)?.[0] ?? "");
  const failures = [];
  for (const m of text.matchAll(/^\s*(?:×|✗|✕|FAIL)\s+(.+?)(?:\s+\d+ms)?\s*$/gm)) {
    if (!failures.includes(m[1])) failures.push(m[1]);
    if (failures.length >= 12) break;
  }
  return {
    tests,
    files,
    failures,
    tscErrors: (text.match(/\berror TS\d+/g) ?? []).length,
    // printed by test/globalSetup.ts only when it really applied the schema to a database
    databaseUsed: /\[test setup\] database schema applied once/.test(text),
    databaseSetupFailed: /DATABASE SCHEMA NOT APPLIED/.test(text),
  };
}

const isTestRun = (check) =>
  (check.commands ?? []).some((c) => /\bvitest\b|^npm test\b|\bonline:test\b|\brun test\b|\bfranchise:stress\b/.test(c));

function short(parsed) {
  const t = parsed.tests;
  return t ? `${t.passed} passed${t.failed ? `, ${t.failed} failed` : ""}${t.skipped ? `, ${t.skipped} skipped` : ""}` : "";
}

/**
 * One check's status, from the record of running it.
 * `run`: { exitCode: number | null, output?, timedOut?, error?, durationSec?, status?, ci? }
 */
export function judge(check, run) {
  const base = { id: check.id, durationSec: run?.durationSec ?? null };
  // CI is not something a local run produces: no record yet means GitHub has not reported
  if (!run && check.kind === "ci") return { ...base, status: "PENDING_CI", detail: "GitHub CI has not reported" };
  if (!run) return { ...base, status: "NOT_RUN", detail: "no record that this was run" };

  if (check.kind === "manual") {
    if (run.status === "CONFIRMED") return { ...base, status: "CONFIRMED", detail: run.detail ?? "confirmed by hand" };
    return { ...base, status: "NOT_RUN", detail: "not confirmed" };
  }

  if (check.kind === "ci") {
    const ci = run.ci;
    if (!ci || run.status === "PENDING_CI") return { ...base, status: "PENDING_CI", detail: "GitHub CI has not reported" };
    if (ci.test !== "success") return { ...base, status: "FAILED", detail: `the required \`test\` job was ${ci.test ?? "not reported"}` };
    if (ci.event === "pull_request" && ci.deploy !== "skipped") {
      return { ...base, status: "FAILED", detail: `a pull request must not deploy, but deploy was ${ci.deploy ?? "not reported"}` };
    }
    return { ...base, status: "PASSED", detail: `\`test\` ${ci.test}, \`deploy\` ${ci.deploy ?? "n/a"}` };
  }

  if (run.timedOut) return { ...base, status: "FAILED", detail: "timed out" };
  if (run.error) return { ...base, status: "FAILED", detail: `could not run: ${run.error}` };
  if (run.exitCode === null || run.exitCode === undefined) return { ...base, status: "NOT_RUN", detail: "no exit code was recorded" };

  const parsed = parseTestOutput(run.output ?? "");
  const failures = parsed.failures.slice(0, 5);
  if (run.exitCode !== 0) {
    const what = parsed.tests?.failed ? `${parsed.tests.failed} test(s) failed` : parsed.tscErrors ? `${parsed.tscErrors} type error(s)` : "";
    return { ...base, status: "FAILED", detail: `exit code ${run.exitCode}${what ? `: ${what}` : ""}`, failures };
  }
  if ((parsed.tests?.failed ?? 0) > 0 || (parsed.files?.failed ?? 0) > 0) {
    return { ...base, status: "FAILED", detail: `exit code 0 but the output reports ${parsed.tests?.failed ?? 0} failed test(s): not counted as a pass`, failures };
  }
  if (parsed.tscErrors > 0) return { ...base, status: "FAILED", detail: `exit code 0 but the output shows ${parsed.tscErrors} type error(s)` };
  if (parsed.databaseSetupFailed) return { ...base, status: "FAILED", detail: "the database schema could not be applied", failures };

  if (isTestRun(check)) {
    if (!parsed.tests) {
      return { ...base, status: "FAILED", detail: "exit code 0 but no test summary could be read: not counted as a pass" };
    }
    if (parsed.tests.total === 0 || parsed.tests.passed === 0) {
      return { ...base, status: "SKIPPED", detail: parsed.tests.skipped ? `all ${parsed.tests.skipped} test(s) skipped, none ran` : "no tests ran" };
    }
    if (check.needsDatabase && !parsed.databaseUsed) {
      return {
        ...base,
        status: "SKIPPED",
        detail: "no database was used, so these suites returned early (a runner counts that as a pass); not exercised",
      };
    }
    const skipped = parsed.tests.skipped;
    return { ...base, status: "PASSED", detail: short(parsed) + (skipped ? ` (${skipped} skipped, not exercised)` : ""), skipped };
  }
  return { ...base, status: "PASSED", detail: "exit code 0" };
}

/**
 * The verdict for a whole plan.
 * @param plan    output of select-checks.mjs --json
 * @param results array of run records: { id, exitCode, output, ... } (see `judge`)
 */
export function summarize(plan, results = []) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const rows = [];
  for (const level of ["required", "recommended"]) {
    for (const check of plan[level]) {
      const j = judge(check, byId.get(check.id));
      rows.push({ ...j, label: check.label, level: level.toUpperCase(), kind: check.kind, commands: check.commands, needsDatabase: check.needsDatabase });
    }
  }
  const planned = new Set(rows.map((r) => r.id));
  const unplanned = results.filter((r) => !planned.has(r.id)).map((r) => r.id).sort();

  const required = rows.filter((r) => r.level === "REQUIRED");
  const requiredLocal = required.filter((r) => r.kind !== "ci");
  const requiredCi = required.filter((r) => r.kind === "ci");
  const failed = rows.filter((r) => r.status === "FAILED");
  const notDone = requiredLocal.filter((r) => r.status === "NOT_RUN" || r.status === "SKIPPED");

  let verdict;
  if (plan.problems.length > 0) verdict = "BLOCKED";
  else if (failed.length > 0) verdict = "FAILED";
  else if (notDone.length > 0) verdict = "INCOMPLETE";
  else if (requiredCi.length > 0 && requiredCi.every((r) => r.status === "PASSED")) verdict = "VERIFIED";
  else verdict = "LOCALLY_VERIFIED";

  return {
    verdict,
    base: plan.base,
    risk: plan.risk,
    conservative: plan.conservative,
    rows,
    failed: failed.map((r) => r.id),
    notRun: notDone.map((r) => r.id),
    recommendedNotRun: rows.filter((r) => r.level === "RECOMMENDED" && (r.status === "NOT_RUN" || r.status === "SKIPPED")).map((r) => r.id),
    unplanned,
    problems: plan.problems,
    approvalsNeeded: plan.approvalsNeeded,
    needsDatabase: plan.needsDatabase,
    limitations: plan.limitations,
    notes: plan.notes,
    ciRequired: requiredCi.length > 0,
  };
}

const VERDICT_TEXT = {
  BLOCKED: "BLOCKED - fix the problems below first",
  FAILED: "FAILED - at least one check failed",
  INCOMPLETE: "INCOMPLETE - required checks were not run or were skipped",
  LOCALLY_VERIFIED: "LOCALLY VERIFIED - every required local check passed; this is NOT the CI result",
  VERIFIED: "VERIFIED - every required local check passed and GitHub CI passed",
};

/** The report, as Markdown. Deterministic. */
export function renderReport(s) {
  const L = [];
  L.push("## Verification report", "");
  L.push(`**Verdict: ${VERDICT_TEXT[s.verdict]}**`, "");
  L.push(`Base: ${s.base ?? "?"}. Risk: ${s.risk}${s.conservative ? " (conservative: some path could not be classified)" : ""}.`);
  if (s.verdict !== "VERIFIED") {
    L.push(s.ciRequired ? "GitHub CI has not (yet) passed on the pull request. Only that result is authoritative." : "No CI check was required by this plan; CI still runs on the pull request.");
  }
  L.push("");
  if (s.problems.length > 0) L.push("**Problems**", ...s.problems.map((p) => `- ${p}`), "");
  if (s.failed.length > 0) {
    L.push("**Failed**");
    for (const r of s.rows.filter((x) => x.status === "FAILED")) {
      L.push(`- \`${r.id}\` (${r.level.toLowerCase()}): ${r.detail}`);
      for (const f of r.failures ?? []) L.push(`    - ${f}`);
    }
    L.push("");
  }
  L.push("| Check | Level | Status | Detail |", "|---|---|---|---|");
  for (const r of s.rows) {
    const secs = r.durationSec != null ? ` (${Math.round(r.durationSec)} s)` : "";
    L.push(`| ${r.id} | ${r.level} | ${r.status.replace("_", " ")} | ${String(r.detail).replace(/\|/g, "/")}${secs} |`);
  }
  L.push("");
  const notRun = s.rows.filter((r) => r.status === "NOT_RUN" || r.status === "SKIPPED" || r.status === "PENDING_CI");
  L.push("**Skipped / not run**");
  if (notRun.length === 0) L.push("- none");
  for (const r of notRun) L.push(`- \`${r.id}\` (${r.level.toLowerCase()}, ${r.status.replace("_", " ")}): ${r.detail}`);
  L.push("");
  L.push("**Unverified risks**");
  if (s.needsDatabase) L.push("- Locks, deadlocks and true concurrency are not shown by a local PGlite (one session; version 18, CI runs 16). Only CI's PostgreSQL shows them.");
  for (const r of s.rows.filter((x) => x.level === "REQUIRED" && (x.status === "NOT_RUN" || x.status === "SKIPPED"))) L.push(`- Required check \`${r.id}\` did not run, so what it covers is unverified.`);
  for (const l of s.limitations.slice(0, 2)) L.push(`- ${l}`);
  L.push("");
  if (s.approvalsNeeded.length > 0) {
    L.push("**Needs your approval before this is pushed**", ...s.approvalsNeeded.map((a) => `- ${a}`), "");
  }
  if (s.unplanned.length > 0) L.push(`Results recorded for checks that are not in the plan (ignored): ${s.unplanned.join(", ")}`, "");
  return L.join("\n");
}

/** Process exit code for a verdict: 0 only when nothing failed and nothing required is missing. */
export function exitCodeFor(verdict) {
  return verdict === "VERIFIED" || verdict === "LOCALLY_VERIFIED" ? 0 : verdict === "INCOMPLETE" ? 4 : 1;
}
