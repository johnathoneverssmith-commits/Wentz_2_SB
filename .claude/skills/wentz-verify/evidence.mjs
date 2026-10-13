/**
 * Ties a recorded result to what it was a result OF.
 *
 * A passing run is evidence about one command, run against one state of the
 * repository, under one plan. Edit a file, switch commit, change the command
 * or the plan, and the old result says nothing about the new state. So every
 * record the runner writes carries a binding, and the report only counts a
 * record whose binding still matches:
 *
 *   planDigest     the plan's checks and the change set it was made from
 *   commandDigest  this check's commands, directory and environment settings
 *   treeDigest     HEAD plus the content of every modified, staged, deleted and
 *                  untracked file, plus the build and test configuration files
 *
 * Records are never overwritten. A rerun appends an attempt, so a failure stays
 * in the history and the report can show it.
 *
 * Evidence is `observed` when this tool ran the command and recorded the
 * result itself, and `attested` when a person said it was done (a manual check).
 * A results file is an ordinary file and can be edited by hand: these bindings
 * stop honest mistakes and an agent summarising from memory, not a person who
 * rewrites the file on purpose. GitHub CI, fetched by the tool, is the check
 * that does not depend on this file.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** JSON with sorted keys, so equal values give equal text. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** What a check's result depends on besides the files: what it runs, where, and with which settings. */
export function commandDigest(check) {
  return sha256(canonical({ id: check.id, commands: check.commands ?? [], cwd: check.cwd ?? ".", env: check.env ?? {}, needsDatabase: Boolean(check.needsDatabase), parser: check.parser ?? null }));
}

/** The plan as far as results are concerned: which checks, with which commands, for which change set. */
export function planDigest(plan) {
  const pick = (c) => ({ id: c.id, level: c.level, digest: commandDigest(c) });
  return sha256(
    canonical({
      base: plan.base ?? null,
      mergeBase: plan.mergeBase ?? null,
      changes: (plan.changes ?? []).map((c) => ({ path: c.path, status: c.status })),
      required: (plan.required ?? []).map(pick),
      recommended: (plan.recommended ?? []).map(pick),
    }),
  );
}

const CONFIG_FILES = [
  "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts",
  "online/package.json", "online/tsconfig.json", "online/vitest.config.ts", "online/schema.sql",
  "ui-source/package.json", "ui-source/package-lock.json", "ui-source/vitest.config.ts", "ui-source/vite.config.ts",
  ".github/workflows/deploy-render.yml", ".claude/skills/wentz-verify/risk-map.json",
];

/**
 * Files that are ignored by git yet change what the tests do: the engine tests use data/players.local.json when
 * it exists and a committed fixture when it does not, and environment files change configuration. Only a hash
 * of each is kept (an environment file can hold secrets, so its content is never recorded), and a file that is
 * absent is recorded as absent, so creating or deleting one changes the fingerprint.
 */
const RUNTIME_INPUTS = ["data/players.local.json", ".env", ".env.local", "online/.env", "online/.env.local", "ui-source/.env", "ui-source/.env.local"];

function hashFile(path) {
  try {
    const st = lstatSync(path);
    if (st.isDirectory()) return "directory";
    if (!st.isFile()) return "not-a-file";
    return sha256(readFileSync(path));
  } catch {
    return "absent";
  }
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** Paths git reports as modified, staged, deleted, renamed or untracked (not ignored). */
export function parsePorcelainZ(text) {
  const parts = text.split("\0");
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (code.includes("R") || code.includes("C")) paths.push(parts[++i] ?? ""); // the old path follows
  }
  return [...new Set(paths.filter(Boolean))].sort();
}

/**
 * The state of the repository at `cwd`: HEAD and the exact content of everything that differs from it.
 * Never throws: if git cannot answer, `error` says so and callers treat every binding as unverifiable.
 */
export function fingerprint(cwd) {
  try {
    const head = git(cwd, ["rev-parse", "HEAD"]).trim();
    const changed = parsePorcelainZ(git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
    const files = changed.map((path) => ({ path, hash: hashFile(join(cwd, path)) }));
    const config = CONFIG_FILES.filter((f) => existsSync(join(cwd, f))).map((f) => ({ path: f, hash: hashFile(join(cwd, f)) }));
    for (const dir of ["", "ui-source"]) {
      if (!existsSync(join(cwd, dir || "."))) continue;
      for (const name of readdirSync(join(cwd, dir || "."))) {
        if (/^tsconfig.*\.json$/.test(name) && !config.some((c) => c.path === join(dir, name).replace(/\\/g, "/"))) {
          config.push({ path: join(dir, name).replace(/\\/g, "/"), hash: hashFile(join(cwd, dir, name)) });
        }
      }
    }
    config.sort((a, b) => a.path.localeCompare(b.path));
    const runtimeNames = new Set(RUNTIME_INPUTS);
    if (existsSync(join(cwd, "data"))) for (const name of readdirSync(join(cwd, "data"))) if (/\.local\.[a-z]+$/.test(name)) runtimeNames.add(`data/${name}`);
    const runtime = [...runtimeNames].sort().map((path) => ({ path, hash: hashFile(join(cwd, path)) }));
    // the interpreter version is part of what a result was a result of
    return { head, dirty: files.length > 0, files, config, runtime, node: process.version, digest: sha256(canonical({ head, files, config, runtime, node: process.version })) };
  } catch (e) {
    return { error: `could not read the repository state: ${e.message.split("\n")[0]}` };
  }
}

/** What a run record is bound to. */
export function bindingFor(check, plan, state, extra = {}) {
  return { planDigest: planDigest(plan), commandDigest: commandDigest(check), head: state.head, treeDigest: state.digest, databaseDigest: extra.databaseDigest ?? null };
}

/** Why a record no longer counts for the plan and repository as they are now. Empty means it still does. */
export function bindingProblems(run, check, plan, state, options = {}) {
  if (!run?.binding) return ["it carries no binding, so there is no telling what it was run against"];
  if (!state || state.error) return [state?.error ?? "the repository state is unknown"];
  const b = run.binding;
  const out = [];
  if (b.planDigest !== planDigest(plan)) out.push("the plan has changed since it ran (different checks or changed files)");
  if (b.commandDigest !== commandDigest(check)) out.push("the command or its settings have changed since it ran");
  if (b.head !== state.head) out.push("HEAD has moved since it ran");
  if (b.treeDigest !== state.digest) out.push("files in the working tree have changed since it ran");
  if (check.needsDatabase) {
    if (!b.databaseDigest) out.push("no test database selection was recorded for this database check");
    else if (options.databaseDigest && b.databaseDigest !== options.databaseDigest) out.push("it ran against a different test database than the one selected now");
  }
  return out;
}

/* ------------------------------------------------------------- history -- */

/** Reads a results file in either format. The old format (`results`) has no bindings, so it is read as unbound. */
export function normalizeHistory(data) {
  if (Array.isArray(data?.runs)) return { version: 2, runs: data.runs };
  const legacy = Array.isArray(data?.results) ? data.results : [];
  return { version: 2, runs: legacy.map((r, i) => ({ attempt: 1, evidence: "unbound", ...r, legacyIndex: i })) };
}

/** Adds an attempt without touching what is already recorded. */
export function appendRun(history, run) {
  const attempt = history.runs.filter((r) => r.id === run.id).length + 1;
  return { ...history, runs: [...history.runs, { ...run, attempt }] };
}

/** The attempts for one check, oldest first. */
export const attemptsFor = (history, id) => history.runs.filter((r) => r.id === id);
