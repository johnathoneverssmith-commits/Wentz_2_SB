#!/usr/bin/env node
/**
 * Runs checks from a plan and records exactly what happened.
 *
 *   node select-checks.mjs --out plan.json
 *   node run-checks.mjs --plan plan.json --out results.json [--tier-max 1] [--ids a,b]
 *        [--level required|all] [--with-database] [--timeout-sec 900] [--cwd <repo>]
 *   node report.mjs --plan plan.json --results results.json
 *
 * The record (exit code, the end of the output, how long it took) is written by
 * this script, not retyped by whoever is reporting, which is what keeps a
 * failure from being summarised as a pass. It only runs commands that appear in
 * the plan AND start with npm, npx or node AND contain no shell operators: it
 * cannot push, merge, deploy, call a network service or delete anything.
 *
 * Checks that need a database are skipped unless --with-database is given, and
 * then it is up to the caller to have started one (`npm run online:db`).
 * Manual and CI checks are never run here; they are confirmed by hand or read
 * from GitHub.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readJson } from "./io.mjs";

const ALLOWED_PROGRAMS = new Set(["npm", "npx", "node"]);
const SHELL_OPERATORS = /[;&|<>`$\n\r]/;
/** The last part of the output, where a runner prints its summary. */
const KEEP_OUTPUT_CHARS = 16_000;

/** Why a command may not be run, or null if it may. */
export function refusal(command) {
  const program = command.trim().split(/\s+/)[0] ?? "";
  if (!ALLOWED_PROGRAMS.has(program)) return `"${program}" is not npm, npx or node`;
  if (SHELL_OPERATORS.test(command)) return "contains a shell operator";
  return null;
}

/** Which of the plan's checks this invocation would run. */
export function selectChecks(plan, { ids = null, tierMax = 99, level = "all", withDatabase = false } = {}) {
  const pool = level === "required" ? plan.required : [...plan.required, ...plan.recommended];
  return pool.filter((c) => {
    if (c.kind !== "command") return false;
    if (ids && !ids.includes(c.id)) return false;
    if (c.tier > tierMax) return false;
    if (c.needsDatabase && !withDatabase) return false;
    return true;
  });
}

/** Runs one check; returns the record `verdict.mjs` judges. */
export function runCheck(check, { cwd, timeoutSec = 900, log = () => {} } = {}) {
  const started = Date.now();
  const record = { id: check.id, exitCode: null, output: "", durationSec: 0, timedOut: false, commands: [] };
  const env = { ...process.env, ...(check.env ?? {}) };
  let out = "";
  for (const command of check.commands) {
    const why = refusal(command);
    if (why) {
      record.error = `refused to run "${command}": ${why}`;
      record.exitCode = null;
      break;
    }
    log(`  $ ${command}`);
    const r = spawnSync(command, { cwd, env, shell: true, encoding: "utf8", timeout: timeoutSec * 1000, maxBuffer: 256 * 1024 * 1024 });
    record.commands.push(command);
    out += `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.error && r.error.code === "ETIMEDOUT") {
      record.timedOut = true;
      record.exitCode = null;
      break;
    }
    if (r.error) {
      record.error = r.error.message;
      record.exitCode = null;
      break;
    }
    record.exitCode = r.status ?? null;
    if (r.status !== 0) break; // a later command cannot make up for this one
  }
  record.output = out.length > KEEP_OUTPUT_CHARS ? out.slice(-KEEP_OUTPUT_CHARS) : out;
  record.durationSec = (Date.now() - started) / 1000;
  return record;
}

function parseArgs(argv) {
  const o = { plan: null, out: null, tierMax: 99, ids: null, level: "all", withDatabase: false, timeoutSec: 900, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") o.plan = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--tier-max") o.tierMax = Number(argv[++i]);
    else if (a === "--ids") o.ids = argv[++i].split(",").filter(Boolean);
    else if (a === "--level") o.level = argv[++i];
    else if (a === "--with-database") o.withDatabase = true;
    else if (a === "--timeout-sec") o.timeoutSec = Number(argv[++i]);
    else if (a === "--cwd") o.cwd = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.plan || !o.out) throw new Error("--plan and --out are required");
  if (!["required", "all"].includes(o.level)) throw new Error("--level must be required or all");
  return o;
}

export function main(argv = process.argv.slice(2)) {
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  const plan = readJson(a.plan);
  let existing = [];
  try {
    existing = readJson(a.out).results ?? [];
  } catch {
    // no earlier record
  }
  const chosen = selectChecks(plan, a);
  const skippedForDatabase = [...plan.required, ...plan.recommended].filter((c) => c.kind === "command" && c.needsDatabase && !a.withDatabase);
  if (skippedForDatabase.length > 0) {
    process.stdout.write(`not running (need a database; pass --with-database after starting one): ${skippedForDatabase.map((c) => c.id).join(", ")}\n`);
  }
  const results = new Map(existing.map((r) => [r.id, r]));
  for (const check of chosen) {
    process.stdout.write(`[${check.id}] ${check.label}\n`);
    const rec = runCheck(check, { cwd: a.cwd, timeoutSec: a.timeoutSec, log: (l) => process.stdout.write(`${l}\n`) });
    results.set(check.id, rec);
    const verdict = rec.timedOut ? "TIMED OUT" : rec.error ? "ERROR" : `exit ${rec.exitCode}`;
    process.stdout.write(`    -> ${verdict} in ${rec.durationSec.toFixed(1)} s\n`);
  }
  writeFileSync(a.out, JSON.stringify({ results: [...results.values()] }, null, 2));
  process.stdout.write(`recorded ${chosen.length} check(s) in ${a.out}. Not judged here: run report.mjs.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
