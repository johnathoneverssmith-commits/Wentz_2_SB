#!/usr/bin/env node
/**
 * Runs checks from a plan and records exactly what happened.
 *
 *   node select-checks.mjs --out plan.json
 *   node run-checks.mjs --plan plan.json --out results.json [--tier-max 1] [--ids a,b]
 *        [--level required|all] [--test-database local-pglite|<local url>] [--timeout-sec 900] [--cwd <repo>]
 *   node report.mjs --plan plan.json --results results.json
 *
 * A plan is a file anyone can edit, so nothing in it is trusted:
 *   - each command must match one of the verification commands in
 *     command-policy.mjs (an allowlist of exact shapes: typecheck, the test
 *     scripts, `vitest run|related` on files that exist, the two analysis
 *     scripts). Arbitrary `node -e`, other npx packages, other npm scripts,
 *     paths outside the repository and any shell operator are refused;
 *   - a check never inherits this shell's environment. In particular a
 *     DATABASE_URL, TEST_DATABASE_URL or Neon/Postgres variable that happens to
 *     be exported is NOT passed on (db-safety.mjs). A check that needs a
 *     database runs only with `--test-database`, which must be a database on
 *     this machine that is clearly a test database; without it, or with
 *     anything else, the check does not run.
 *
 * The record (exit code, the end of the output, how long it took) is written by
 * this script, not retyped by whoever is reporting, and is bound to the plan,
 * the command and the exact state of the working tree (evidence.mjs). Records
 * are appended: a rerun keeps the earlier attempts, failures included.
 * Manual and CI checks are never run here.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_POLICY, launchSpec, validateCommand, validateEnv } from "./command-policy.mjs";
import { environmentFor, resolveTestDatabase } from "./db-safety.mjs";
import { appendRun, bindingFor, fingerprint, normalizeHistory, planDigest } from "./evidence.mjs";
import { readJson } from "./io.mjs";

/** The last part of the output, where a runner prints its summary. */
const KEEP_OUTPUT_CHARS = 16_000;

/**
 * Ends a process and everything it started. A timeout that only killed the shell would leave npm, node and
 * vitest running, holding database connections, file handles and CPU, so the whole tree goes.
 * Windows: `taskkill /T /F`. Elsewhere the child leads its own process group (see `runProcess`) and the group is killed.
 */
export function killTree(pid, { platform = process.platform } = {}) {
  if (!pid) return;
  try {
    if (platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/**
 * Runs one process to the end or to the timeout, and on a timeout kills the whole tree before returning.
 * Resolves with { status, stdout, stderr, timedOut, error }; never rejects.
 */
export function runProcess(spec, { cwd, env, timeoutMs, maxBytes = 64 * 1024 * 1024, platform = process.platform }) {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;
    let timer;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done({ stdout, stderr, timedOut, ...result });
    };
    let child;
    try {
      child = spawn(spec.file, spec.args, { cwd, env, shell: spec.shell, windowsHide: true, detached: platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      finish({ status: null, error: e.message });
      return;
    }
    const keep = (current, chunk) => {
      const next = current + chunk;
      return next.length > maxBytes ? next.slice(-maxBytes) : next;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout = keep(stdout, c)));
    child.stderr.on("data", (c) => (stderr = keep(stderr, c)));
    child.on("error", (e) => finish({ status: null, error: e.message }));
    child.on("close", (status) => {
      // a normal exit can still leave a background child of the command behind: end the group
      if (platform !== "win32") killTree(child.pid, { platform });
      finish({ status: timedOut ? null : status });
    });
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, { platform });
    }, timeoutMs);
  });
}

/** Why a command may not be run, or null if it may. */
export function refusal(command, { repoRoot = process.cwd(), cwd = ".", policy = DEFAULT_POLICY, fileExists } = {}) {
  const v = validateCommand(command, { repoRoot, cwd, policy, ...(fileExists ? { fileExists } : {}) });
  return v.ok ? null : v.reason;
}

/** Which of the plan's checks this invocation would run. A database check needs `testDatabase`, a valid one. */
export function selectChecks(plan, { ids = null, tierMax = 99, level = "all", testDatabase = undefined } = {}) {
  const pool = level === "required" ? plan.required : [...plan.required, ...plan.recommended];
  const haveDatabase = resolveTestDatabase(testDatabase).ok;
  return pool.filter((c) => {
    if (c.kind !== "command") return false;
    if (ids && !ids.includes(c.id)) return false;
    if (c.tier > tierMax) return false;
    if (c.needsDatabase && !haveDatabase) return false;
    return true;
  });
}

/** Runs one check; returns the record `verdict.mjs` judges. Never throws for a refused command: it records why. */
export async function runCheck(check, { cwd = process.cwd(), timeoutSec = 900, log = () => {}, policy = DEFAULT_POLICY, parentEnv = process.env, testDatabase, platform = process.platform, fileExists } = {}) {
  const started = Date.now();
  const record = { id: check.id, exitCode: null, output: "", durationSec: 0, timedOut: false, commands: [], evidence: "observed", startedAt: new Date(started).toISOString() };
  const finish = () => {
    record.durationSec = (Date.now() - started) / 1000;
    return record;
  };
  const repoRoot = resolve(cwd);
  const runDir = check.cwd ?? ".";

  const declared = validateEnv(check.env);
  if (!declared.ok) {
    record.error = `refused to run: ${declared.reason}`;
    return finish();
  }
  const environment = environmentFor(check, declared.env, { parentEnv, testDatabase });
  if (!environment.ok) {
    record.error = `refused to run: ${environment.reason}`;
    return finish();
  }
  if (environment.database) {
    record.database = environment.database;
    record.databaseDigest = environment.databaseDigest;
    log(`  database: ${environment.database}`);
  }
  // validate every command before starting any, so a bad second command cannot follow a first that already ran
  const validated = [];
  for (const command of check.commands) {
    const v = validateCommand(command, { repoRoot, cwd: runDir, policy, ...(fileExists ? { fileExists } : {}) });
    if (!v.ok) {
      record.error = `refused to run "${command}": ${v.reason}`;
      return finish();
    }
    validated.push({ command, v });
  }

  let out = "";
  for (const { command, v } of validated) {
    let outputDir = null;
    try {
      if (v.kind === "stress") outputDir = mkdtempSync(join(tmpdir(), "wentz-stress-")); // the stress test writes many files: never into the repository
      const spec = launchSpec(v, { platform, appendArgs: outputDir ? ["--output", outputDir] : [] });
      log(`  $ ${command}`);
      const r = await runProcess(spec, { cwd: resolve(repoRoot, v.cwd), env: environment.env, timeoutMs: timeoutSec * 1000, platform });
      record.commands.push(command);
      out += `${r.stdout ?? ""}${r.stderr ?? ""}`;
      if (r.timedOut) {
        record.timedOut = true;
        record.exitCode = null;
        break;
      }
      if (r.error) {
        record.error = r.error;
        record.exitCode = null;
        break;
      }
      record.exitCode = r.status ?? null;
      if (r.status !== 0) break; // a later command cannot make up for this one
    } finally {
      if (outputDir) rmSync(outputDir, { recursive: true, force: true });
    }
  }
  record.output = out.length > KEEP_OUTPUT_CHARS ? out.slice(-KEEP_OUTPUT_CHARS) : out;
  return finish();
}

function parseArgs(argv) {
  const o = { plan: null, out: null, tierMax: 99, ids: null, level: "all", testDatabase: undefined, timeoutSec: 900, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") o.plan = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--tier-max") o.tierMax = Number(argv[++i]);
    else if (a === "--ids") o.ids = argv[++i].split(",").filter(Boolean);
    else if (a === "--level") o.level = argv[++i];
    else if (a === "--test-database") o.testDatabase = argv[++i];
    else if (a === "--with-database") throw new Error("--with-database was removed: it let a run use whatever DATABASE_URL was set. Use --test-database local-pglite (after `npm run online:db`) or a local test database URL");
    else if (a === "--timeout-sec") o.timeoutSec = Number(argv[++i]);
    else if (a === "--cwd") o.cwd = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.plan || !o.out) throw new Error("--plan and --out are required");
  if (!["required", "all"].includes(o.level)) throw new Error("--level must be required or all");
  return o;
}

export async function main(argv = process.argv.slice(2)) {
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  if (a.testDatabase !== undefined) {
    const chosen = resolveTestDatabase(a.testDatabase);
    if (!chosen.ok) {
      process.stderr.write(`${chosen.reason}\nnothing was run.\n`);
      return 2;
    }
    process.stdout.write(`test database: ${chosen.description}\n`);
  }
  const plan = readJson(a.plan);
  const state = fingerprint(a.cwd);
  if (state.error) {
    process.stderr.write(`${state.error}\nnothing was run: a result cannot be tied to a repository state that cannot be read.\n`);
    return 2;
  }
  let history = { version: 2, runs: [] };
  if (existsSync(a.out)) {
    try {
      history = normalizeHistory(readJson(a.out));
    } catch (e) {
      process.stderr.write(`${a.out} exists but cannot be read (${e.message}): not overwriting it. Move it aside to start again.\n`);
      return 2;
    }
  }
  const chosen = selectChecks(plan, a);
  const left = [...plan.required, ...plan.recommended].filter((c) => c.kind === "command" && c.needsDatabase && !chosen.includes(c));
  if (left.length > 0) {
    process.stdout.write(`not running (need a database; start one with \`npm run online:db\` and pass --test-database local-pglite): ${left.map((c) => c.id).join(", ")}\n`);
  }
  const digest = planDigest(plan);
  for (const check of chosen) {
    process.stdout.write(`[${check.id}] ${check.label}\n`);
    const before = fingerprint(a.cwd);
    const rec = await runCheck(check, { cwd: a.cwd, timeoutSec: a.timeoutSec, testDatabase: a.testDatabase, log: (l) => process.stdout.write(`${l}\n`) });
    const after = fingerprint(a.cwd);
    if (before.error || after.error || before.digest !== after.digest) {
      rec.error = rec.error ?? "the working tree changed while this check ran, so its result cannot be tied to one state of the files";
    }
    rec.binding = { ...bindingFor(check, plan, before.error ? { head: null, digest: null } : before, { databaseDigest: rec.databaseDigest ?? null }), planDigest: digest };
    history = appendRun(history, rec);
    const verdict = rec.timedOut ? "TIMED OUT" : rec.error ? "ERROR" : `exit ${rec.exitCode}`;
    process.stdout.write(`    -> ${verdict} in ${rec.durationSec.toFixed(1)} s${rec.error ? `: ${rec.error}` : ""}\n`);
  }
  writeFileSync(a.out, JSON.stringify(history, null, 2));
  process.stdout.write(`recorded ${chosen.length} check(s) in ${a.out} (earlier attempts are kept). Not judged here: run report.mjs.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
