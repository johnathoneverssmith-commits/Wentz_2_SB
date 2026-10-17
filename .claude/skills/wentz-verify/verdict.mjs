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
 *   - each tool is read the way it reports: Vitest by its summary lines (all of
 *     them, when a command runs more than one), the stress test by its own
 *     summary, a typecheck or build by its exit code;
 *   - a result only counts while the plan, the command and the files it was run
 *     against are unchanged (see evidence.mjs); otherwise it is stale and the
 *     check is NOT RUN again;
 *   - one FAILED check anywhere, required or recommended, makes the verdict FAILED,
 *     and an earlier failed attempt stays in the report after a rerun;
 *   - a required check that was not run makes the verdict INCOMPLETE;
 *   - only GitHub CI for this exact commit, fetched and validated by the tool
 *     (ci-evidence.mjs), can make the verdict VERIFIED. Nothing typed in by hand
 *     can: a manual attestation of CI is shown, but it leaves the verdict at
 *     LOCALLY VERIFIED.
 */
import { bindingProblems } from "./evidence.mjs";

/** Overall verdicts, worst first. */
export const VERDICTS = ["BLOCKED", "FAILED", "INCOMPLETE", "LOCALLY_VERIFIED", "VERIFIED"];
export const STATUSES = ["PASSED", "FAILED", "SKIPPED", "NOT_RUN", "PENDING_CI", "CONFIRMED"];

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Counts from a vitest summary line such as `Tests  3 failed | 12 passed | 1 skipped (16)`. */
function counts(line) {
  const out = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  for (const m of line.matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) out[m[2]] = Number(m[1]);
  const total = /\((\d+)\)/.exec(line);
  out.total = total ? Number(total[1]) : out.passed + out.failed + out.skipped + out.todo;
  return out;
}

/** Adds up every summary line of one kind: a command can run Vitest more than once. */
function sumSummaries(text, label) {
  const lines = [...text.matchAll(new RegExp(`^\\s*${label}\\s+(.*)$`, "gm"))].map((m) => m[0]);
  if (lines.length === 0) return null;
  const sum = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0 };
  for (const line of lines) {
    const c = counts(line);
    for (const k of Object.keys(sum)) sum[k] += c[k];
  }
  return { ...sum, summaries: lines.length };
}

/** What a test or typecheck run says about itself. Reads text only. */
export function parseTestOutput(raw = "") {
  const text = String(raw).replace(ANSI, "");
  const tests = sumSummaries(text, "Tests");
  const files = sumSummaries(text, "Test Files");
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

/** The franchise stress test prints its own summary and sets its exit code from it; it is not a Vitest run. */
export function parseStressOutput(raw = "") {
  const text = String(raw).replace(ANSI, "");
  const failures = /Invariant failures and crashes:\s*(\d+)/.exec(text);
  const replay = /Deterministic replay:\s*([A-Za-z_]+)/.exec(text);
  const seasons = /Team seasons completed:\s*(\d+)/.exec(text);
  return { invariantFailures: failures ? Number(failures[1]) : null, replay: replay ? replay[1] : null, teamSeasons: seasons ? Number(seasons[1]) : null };
}

/**
 * How a check reports: "vitest", "stress" or "exit" (a typecheck, a build, a script: only its exit code).
 * Decided from the commands alone. A plan is an editable file, and a check that could name its own parser
 * could switch off failure detection for a Vitest run by calling it "exit".
 */
export function parserFor(check) {
  const commands = check.commands ?? [];
  if (commands.some((c) => /\bfranchise:stress\b/.test(c))) return "stress";
  if (commands.some((c) => /\bvitest\b|^npm test\b|\bonline:test\b|\brun test\b/.test(c))) return "vitest";
  return "exit";
}

function short(parsed) {
  const t = parsed.tests;
  return t ? `${t.passed} passed${t.failed ? `, ${t.failed} failed` : ""}${t.skipped ? `, ${t.skipped} skipped` : ""}` : "";
}

/** The parsed form of the signals the runner scanned from one command's whole output (output-signals.mjs). */
function parsedFromSignals(signals = {}) {
  const parsed = parseTestOutput((signals.interesting ?? []).join("\n"));
  return {
    ...parsed,
    failures: signals.failureNames ?? [],
    failureLines: signals.failureLines ?? 0,
    tscErrors: signals.tscErrors ?? 0,
    databaseUsed: Boolean(signals.databaseUsed),
    databaseSetupFailed: Boolean(signals.databaseSetupFailed),
    overflow: (signals.interestingOverflow ?? 0) > 0,
    text: (signals.interesting ?? []).join("\n"),
  };
}

const addCounts = (parts) => {
  const live = parts.filter(Boolean);
  if (live.length === 0) return null;
  const sum = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0, summaries: 0 };
  for (const p of live) for (const k of Object.keys(sum)) sum[k] += p[k] ?? 0;
  return sum;
};

/**
 * What the record proves, per executed command and then together.
 *   - Records written by the runner carry `commandResults`, one entry per command with the signals scanned from its
 *     whole output. Those are what is judged; the bounded `output` is only for people.
 *   - An older record (or one written by hand) has only `output`, which is parsed as before.
 * A database is "used" only if every Vitest command of the check printed the marker: one command's marker does
 * not vouch for another, and a database being selected, or a zero exit code, vouches for nothing.
 */
function evidenceOf(run) {
  const results = Array.isArray(run.commandResults) ? run.commandResults : [];
  if (results.length === 0) {
    const parsed = parseTestOutput(run.output ?? "");
    return { parsed: { ...parsed, failureLines: parsed.failures.length, overflow: false, text: String(run.output ?? "") }, missingDatabase: parsed.databaseUsed ? [] : ["(the recorded output)"], noSummary: [], noneRan: [], incomplete: false, commands: 0 };
  }
  const per = results.map((r) => ({ command: r.command, parsed: parsedFromSignals(r.signals), vitest: parserFor({ commands: [r.command] }) === "vitest" }));
  const names = [];
  for (const p of per) for (const n of p.parsed.failures) if (!names.includes(n) && names.length < 12) names.push(n);
  return {
    parsed: {
      tests: addCounts(per.map((p) => p.parsed.tests)),
      files: addCounts(per.map((p) => p.parsed.files)),
      failures: names,
      failureLines: per.reduce((n, p) => n + p.parsed.failureLines, 0),
      tscErrors: per.reduce((n, p) => n + p.parsed.tscErrors, 0),
      databaseSetupFailed: per.some((p) => p.parsed.databaseSetupFailed),
      databaseUsed: per.some((p) => p.vitest) && per.filter((p) => p.vitest).every((p) => p.parsed.databaseUsed),
      overflow: per.some((p) => p.parsed.overflow),
      text: per.map((p) => p.parsed.text).join("\n"),
    },
    missingDatabase: per.filter((p) => p.vitest && !p.parsed.databaseUsed).map((p) => p.command),
    // each Vitest command must itself have run tests: another command's passes cannot stand in for it
    noSummary: per.filter((p) => p.vitest && !p.parsed.tests).map((p) => p.command),
    noneRan: per.filter((p) => p.vitest && p.parsed.tests && (p.parsed.tests.total === 0 || p.parsed.tests.passed === 0)).map((p) => ({ command: p.command, skipped: p.parsed.tests.skipped })),
    // the runner stops at the first command that fails, so a shorter list is only complete when that happened
    incomplete: results.length < (run.commands?.length ?? results.length),
    commands: results.length,
  };
}

/**
 * One check's status, from the record of running it.
 * `run`: { exitCode: number | null, output?, timedOut?, error?, durationSec?, status?, evidence?, ci? }
 */
export function judge(check, run) {
  const base = { id: check.id, durationSec: run?.durationSec ?? null };
  // CI is not something a local run produces: no record yet means GitHub has not reported
  if (!run && check.kind === "ci") return { ...base, status: "PENDING_CI", detail: "GitHub CI has not reported" };
  if (!run) return { ...base, status: "NOT_RUN", detail: "no record that this was run" };

  if (check.kind === "manual") {
    if (run.status === "CONFIRMED") return { ...base, status: "CONFIRMED", detail: run.detail ?? "confirmed by hand (attested, not observed by this tool)" };
    return { ...base, status: "NOT_RUN", detail: "not confirmed" };
  }

  if (check.kind === "ci") return judgeCi(base, run);

  if (run.evidence === "attested") return { ...base, status: "NOT_RUN", detail: "only attested by hand: this tool did not run it, and a command check cannot be confirmed that way" };
  if (run.timedOut) return { ...base, status: "FAILED", detail: "timed out" };
  if (run.error) return { ...base, status: "FAILED", detail: `could not run: ${run.error}` };
  if (run.exitCode === null || run.exitCode === undefined) return { ...base, status: "NOT_RUN", detail: "no exit code was recorded" };

  const parser = parserFor(check);
  const ev = evidenceOf(run);
  const parsed = ev.parsed;
  const failures = parsed.failures.slice(0, 5);

  if (parser === "stress") {
    const s = parseStressOutput(parsed.text);
    const said = s.invariantFailures === null ? "no summary" : `${s.invariantFailures} invariant failure(s), replay ${s.replay ?? "unreported"}, ${s.teamSeasons ?? "unknown"} team season(s)`;
    if (run.exitCode !== 0) return { ...base, status: "FAILED", detail: `exit code ${run.exitCode} (${said})` };
    // a pass needs the whole summary: no failures, the replay compared and identical, and seasons actually played
    if (s.invariantFailures === null || s.replay === null || s.teamSeasons === null) return { ...base, status: "FAILED", detail: `exit code 0 but the stress summary is incomplete (${said}): not counted as a pass` };
    if (s.invariantFailures > 0 || s.replay !== "identical" || s.teamSeasons < 1) return { ...base, status: "FAILED", detail: `exit code 0 but the summary reports ${said}` };
    return { ...base, status: "PASSED", detail: `exit code 0, ${said}` };
  }

  if (run.exitCode !== 0) {
    const what = parser === "vitest" && parsed.tests?.failed ? `${parsed.tests.failed} test(s) failed` : parsed.tscErrors ? `${parsed.tscErrors} type error(s)` : "";
    return { ...base, status: "FAILED", detail: `exit code ${run.exitCode}${what ? `: ${what}` : ""}`, failures: parser === "vitest" ? failures : [] };
  }
  // conservative, whichever tool: a failure line or a failed count in the output is never overridden by a green exit code
  if ((parsed.tests?.failed ?? 0) > 0 || (parsed.files?.failed ?? 0) > 0) {
    return { ...base, status: "FAILED", detail: `exit code 0 but the output reports ${parsed.tests?.failed ?? 0} failed test(s): not counted as a pass`, failures };
  }
  if (parser === "vitest" && parsed.failureLines > 0) {
    return { ...base, status: "FAILED", detail: `exit code 0 but the output lists ${parsed.failureLines} failing test line(s) (${parsed.failures[0] ?? "name not kept"}), even if a later summary is green: not counted as a pass`, failures };
  }
  if (ev.incomplete) return { ...base, status: "NOT_RUN", detail: `evidence was recorded for ${ev.commands} of ${run.commands.length} command(s): not counted` };
  if (parser === "vitest" && parsed.overflow) return { ...base, status: "FAILED", detail: "the output has more test summaries than can be read reliably: not counted as a pass" };
  if (parsed.tscErrors > 0) return { ...base, status: "FAILED", detail: `exit code 0 but the output shows ${parsed.tscErrors} type error(s)` };
  if (parsed.databaseSetupFailed) return { ...base, status: "FAILED", detail: "the database schema could not be applied", failures };

  if (parser === "vitest") {
    if (!parsed.tests || ev.noSummary.length > 0) {
      const which = ev.commands > 1 && ev.noSummary.length > 0 ? ` from ${ev.noSummary.map((c) => `\`${c}\``).join(", ")}` : "";
      return { ...base, status: "FAILED", detail: `exit code 0 but no test summary could be read${which}: not counted as a pass` };
    }
    if (ev.noneRan.length > 0) {
      const what = ev.noneRan.map((n) => `${ev.commands > 1 ? `\`${n.command}\`: ` : ""}${n.skipped ? `all ${n.skipped} test(s) skipped, none ran` : "no tests ran"}`).join("; ");
      return { ...base, status: "SKIPPED", detail: what };
    }
    if (parsed.tests.total === 0 || parsed.tests.passed === 0) {
      return { ...base, status: "SKIPPED", detail: parsed.tests.skipped ? `all ${parsed.tests.skipped} test(s) skipped, none ran` : "no tests ran" };
    }
    if (check.needsDatabase && ev.missingDatabase.length > 0) {
      return {
        ...base,
        status: "SKIPPED",
        detail:
          ev.commands > 1
            ? `no database was used by ${ev.missingDatabase.map((c) => `\`${c}\``).join(", ")}, so its suites returned early (a runner counts that as a pass); not exercised`
            : "no database was used, so these suites returned early (a runner counts that as a pass); not exercised",
      };
    }
    const skipped = parsed.tests.skipped;
    const runs = parsed.tests.summaries > 1 ? ` across ${parsed.tests.summaries} test runs` : "";
    return { ...base, status: "PASSED", detail: short(parsed) + runs + (skipped ? ` (${skipped} skipped, not exercised)` : ""), skipped };
  }
  return { ...base, status: "PASSED", detail: "exit code 0" };
}

/** CI counts only when the tool fetched and validated it. A person's word for it is shown, not believed. */
function judgeCi(base, run) {
  const ci = run.ci;
  if (!ci || run.status === "PENDING_CI") return { ...base, status: "PENDING_CI", detail: run.detail ?? "GitHub CI has not reported" };
  if (run.evidence === "github-api" && ci.failed === true) return { ...base, status: "FAILED", detail: `GitHub CI failed: ${ci.reason}` };
  if (run.evidence !== "github-api" || ci.validated !== true) {
    if (ci.test && ci.test !== "success") return { ...base, status: "FAILED", detail: `an unverified claim says the \`test\` job was ${ci.test}: treated as failed until GitHub shows otherwise` };
    return { ...base, status: "PENDING_CI", detail: ci.reason ?? "CI was asserted by hand, not retrieved from GitHub by this tool: not counted" };
  }
  if (ci.test !== "success") return { ...base, status: "FAILED", detail: `the required \`test\` job was ${ci.test ?? "not reported"}` };
  if (ci.event !== "pull_request") return { ...base, status: "PENDING_CI", detail: `the run was a ${ci.event ?? "unknown"} event, not the pull request check` };
  if (ci.deploy !== "skipped") return { ...base, status: "FAILED", detail: `a pull request must not deploy, but deploy was ${ci.deploy ?? "not reported"}` };
  return { ...base, status: "PASSED", detail: `GitHub run ${ci.runId ?? "?"} for ${String(ci.headSha ?? "").slice(0, 7)}: \`test\` ${ci.test}, \`deploy\` ${ci.deploy} (retrieved by this tool)` };
}

/**
 * The record that stands for a check among its attempts: the latest one that still describes the current
 * plan and files, else the latest of all (reported as stale). `context.state` absent means bindings are not checked.
 */
function chooseRun(check, attempts, plan, context) {
  if (attempts.length === 0) return { run: undefined, stale: null };
  if (!context.state || check.kind !== "command") return { run: attempts[attempts.length - 1], stale: null };
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (bindingProblems(attempts[i], check, plan, context.state, { databaseDigest: context.databaseDigest }).length === 0) return { run: attempts[i], stale: null };
  }
  const last = attempts[attempts.length - 1];
  return { run: last, stale: bindingProblems(last, check, plan, context.state, { databaseDigest: context.databaseDigest }) };
}

/**
 * The verdict for a whole plan.
 * @param plan    output of select-checks.mjs --json
 * @param results every recorded attempt: { id, exitCode, output, binding?, evidence?, attempt?, ... } (see `judge`)
 * @param context { state?: fingerprint of the repository now, ciEvidence?: from fetchCiEvidence, attestedCi?: what a person claimed }
 */
export function summarize(plan, results = [], context = {}) {
  const attemptsById = new Map();
  for (const r of results) {
    if (r.id === "ci-pr") continue; // CI is never read from a results file
    attemptsById.set(r.id, [...(attemptsById.get(r.id) ?? []), r]);
  }
  const ciRecord = ciRecordFrom(context);
  const rows = [];
  for (const level of ["required", "recommended"]) {
    for (const check of plan[level]) {
      let row;
      if (check.kind === "ci") {
        const j = judge(check, ciRecord);
        row = { ...j, evidence: ciRecord?.evidence === "github-api" ? "github (validated)" : ciRecord?.ci ? "claimed (not validated)" : null };
      } else if (check.kind === "manual") {
        const manual = attemptsById.get(check.id);
        const j = judge(check, manual?.[manual.length - 1]);
        row = { ...j, evidence: j.status === "CONFIRMED" ? "attested" : null };
      } else {
        const attempts = attemptsById.get(check.id) ?? [];
        const { run, stale } = chooseRun(check, attempts, plan, context);
        let j = judge(check, run);
        if (stale) j = { id: check.id, durationSec: run?.durationSec ?? null, status: "NOT_RUN", stale: true, detail: `stale: its result no longer applies because ${stale.join("; ")}` };
        const earlier = attempts.filter((a) => a !== run).map((a) => ({ attempt: a.attempt ?? null, ...judge(check, a) })).filter((a) => a.status === "FAILED");
        const chosenBinding = run?.binding;
        const identical = (a) => chosenBinding && a.binding && a.binding.commandDigest === chosenBinding.commandDigest && a.binding.treeDigest === chosenBinding.treeDigest && a.binding.planDigest === chosenBinding.planDigest;
        const sameInputs = attempts.filter((a) => a !== run && identical(a) && judge(check, a).status === "FAILED").length;
        if (j.status === "PASSED" && sameInputs > 0) {
          j = { ...j, flaky: true, detail: `${j.detail}; it FAILED ${sameInputs} earlier time(s) on identical inputs (possibly flaky)` };
        }
        row = { ...j, evidence: run ? (run.evidence === "observed" ? `observed${run.database ? ` (database: ${run.database})` : ""}` : run.evidence ?? "unbound") : null, attempt: run?.attempt ?? null, earlierFailures: earlier };
      }
      rows.push({ ...row, label: check.label, level: level.toUpperCase(), kind: check.kind, commands: check.commands, needsDatabase: check.needsDatabase, ...(check.executionEvidenceRequired ? { executionEvidenceRequired: true } : {}) });
    }
  }
  const planned = new Set(rows.map((r) => r.id));
  const unplanned = [...attemptsById.keys()].filter((id) => !planned.has(id)).sort();

  const required = rows.filter((r) => r.level === "REQUIRED");
  const requiredLocal = required.filter((r) => r.kind !== "ci");
  const requiredCi = required.filter((r) => r.kind === "ci");
  const failed = rows.filter((r) => r.status === "FAILED");
  const notDone = requiredLocal.filter((r) => r.status === "NOT_RUN" || r.status === "SKIPPED");
  // Scope/design attestations retain existing franchise semantics. An execution
  // attestation is different: generic CI never proves that command was executed.
  // Also recognize old arcade plans that predate the explicit metadata flag.
  const executionAttestations = requiredLocal.filter(r => r.kind === "manual" && (r.executionEvidenceRequired || r.id === "arcade-verify"));

  let verdict;
  if (plan.problems.length > 0) verdict = "BLOCKED";
  else if (failed.length > 0) verdict = "FAILED";
  else if (notDone.length > 0) verdict = "INCOMPLETE";
  else if (executionAttestations.length > 0) verdict = "LOCALLY_VERIFIED";
  else if (requiredCi.length > 0 && requiredCi.every((r) => r.status === "PASSED")) verdict = "VERIFIED";
  else verdict = "LOCALLY_VERIFIED";

  return {
    verdict,
    executionAttestations: executionAttestations.map(r => r.id),
    base: plan.base,
    risk: plan.risk,
    conservative: plan.conservative,
    rows,
    failed: failed.map((r) => r.id),
    notRun: notDone.map((r) => r.id),
    stale: rows.filter((r) => r.stale).map((r) => r.id),
    flaky: rows.filter((r) => r.flaky).map((r) => r.id),
    earlierFailures: rows.flatMap((r) => (r.earlierFailures ?? []).map((e) => ({ id: r.id, attempt: e.attempt, detail: e.detail }))),
    attestedOnly: rows.filter((r) => r.evidence === "attested").map((r) => r.id),
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

/** The `ci-pr` record: validated evidence from the tool, a claim, or nothing. */
function ciRecordFrom(context) {
  const e = context.ciEvidence;
  const state = context.state;
  if (e?.validated === true) {
    if (!e.pr?.number) return { id: "ci-pr", status: "PENDING_CI", detail: "the CI evidence names no pull request: not counted" };
    if (state && (state.error || state.dirty || state.head !== e.headSha)) {
      return { id: "ci-pr", status: "PENDING_CI", detail: "CI passed for a commit that is not exactly what is checked out here (or the tree has changes on top of it): not counted" };
    }
    return { id: "ci-pr", evidence: "github-api", ci: e };
  }
  if (e && e.validated === false) {
    if (e.failed) return { id: "ci-pr", evidence: "github-api", ci: { validated: false, failed: true, reason: e.reason, runId: e.runId } };
    return { id: "ci-pr", status: "PENDING_CI", detail: e.reason };
  }
  if (context.attestedCi) return { id: "ci-pr", evidence: "attested", ci: context.attestedCi };
  return undefined;
}

const VERDICT_TEXT = {
  BLOCKED: "BLOCKED - fix the problems below first",
  FAILED: "FAILED - at least one check failed",
  INCOMPLETE: "INCOMPLETE - required checks were not run, were skipped, or no longer apply",
  LOCALLY_VERIFIED: "LOCALLY VERIFIED - every required local check passed; this is NOT the CI result",
  VERIFIED: "VERIFIED - every required check passed here, and GitHub CI for this exact commit passed (retrieved and validated by this tool)",
};

/** The report, as Markdown. Deterministic. */
export function renderReport(s) {
  const L = [];
  L.push("## Verification report", "");
  const executionOnly = (s.executionAttestations ?? []).length > 0;
  const verdictText = s.verdict === "LOCALLY_VERIFIED" && executionOnly
    ? "LOCALLY VERIFIED (qualified) - execution is attested, not observed; generic CI does not prove these checks executed"
    : VERDICT_TEXT[s.verdict];
  L.push(`**Verdict: ${verdictText}**`, "");
  if (executionOnly) L.push(`**Execution evidence limitation:** ${(s.executionAttestations ?? []).map(id => `\`${id}\``).join(", ")} is not observed execution evidence. Inspect the dedicated exact-head arcade workflow separately; this report does not validate it.`, "");
  L.push(`Base: ${s.base ?? "?"}. Risk: ${s.risk}${s.conservative ? " (conservative: some path could not be classified)" : ""}.`);
  const requiredCi = s.rows.filter(r => r.level === "REQUIRED" && r.kind === "ci");
  if (executionOnly && requiredCi.length > 0 && requiredCi.every(r => r.status === "PASSED")) {
    L.push("Required generic GitHub CI passed; its scope is shown below and does not imply arcade execution.");
  } else if (s.verdict !== "VERIFIED") {
    L.push(s.ciRequired ? "GitHub CI for this exact commit has not been shown to pass by this tool. Only that result is authoritative." : "No CI check was required by this plan; CI still runs on the pull request.");
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
  L.push("| Check | Level | Status | Evidence | Detail |", "|---|---|---|---|---|");
  for (const r of s.rows) {
    const secs = r.durationSec != null ? ` (${Math.round(r.durationSec)} s)` : "";
    const attempt = r.attempt > 1 ? ` [attempt ${r.attempt}]` : "";
    L.push(`| ${r.id} | ${r.level} | ${r.status.replace("_", " ")} | ${r.evidence ?? "-"} | ${String(r.detail).replace(/\|/g, "/")}${secs}${attempt} |`);
  }
  L.push("");
  if (s.earlierFailures.length > 0) {
    L.push("**Earlier failed attempts (kept: a rerun does not erase them)**");
    for (const e of s.earlierFailures) L.push(`- \`${e.id}\` attempt ${e.attempt ?? "?"}: ${e.detail}`);
    L.push("");
  }
  if (s.attestedOnly.length > 0) {
    L.push(`**Attested by hand, not observed by this tool:** ${s.attestedOnly.map((i) => `\`${i}\``).join(", ")}`, "");
  }
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
