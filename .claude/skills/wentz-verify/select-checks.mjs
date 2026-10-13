#!/usr/bin/env node
/**
 * Picks the checks a change needs. It does not run anything.
 *
 *   node .claude/skills/wentz-verify/select-checks.mjs [--base origin/master] [--json]
 *        [--no-untracked] [--changes-file changes.json] [--cwd <dir>] [--map risk-map.json] [--out plan.json]
 *
 * `--out` also writes the plan as JSON (UTF-8, no byte-order mark) for run-checks.mjs and
 * report.mjs. Prefer it to a shell redirect: Windows PowerShell 5.1 writes redirects as UTF-16.
 *
 * The change set is everything that differs from the base: commits on this
 * branch since it left the base, staged changes, unstaged changes and
 * untracked files. A file renamed or deleted counts at both its paths. A path
 * no rule in risk-map.json covers is never ignored: a source file asks for the
 * conservative set (everything CI runs), and any other file is listed as
 * unclassified so it is at least visible.
 *
 * Exit codes: 0 a plan was produced; 2 it could not be (bad arguments, not a
 * git repository); 3 a plan was produced but the change has a PROBLEM that
 * should be fixed first (a scratch file staged or committed). The plan is
 * printed in every case.
 *
 * Everything below `main` is a pure function of its arguments, so it can be
 * tested without git or a file system (test/verify-selector.test.ts).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readJson } from "./io.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** From least to most demanding. "conservative" means the selector could not classify a path. */
export const RISK_ORDER = ["none", "low", "medium", "high", "conservative"];
/** Which source of a change came first; later sources describe the file as it is now. */
const SOURCE_RANK = { committed: 0, staged: 1, unstaged: 2, untracked: 3 };
const MAX_FILES_IN_COMMAND = 40;

export function loadMap(path = join(HERE, "risk-map.json")) {
  return readJson(path);
}

/* ---------------------------------------------------------------- globs -- */

/** `a/{b,c}.ts` -> [`a/b.ts`, `a/c.ts`] (one level of braces is all the map uses). */
export function expandBraces(glob) {
  const open = glob.indexOf("{");
  if (open < 0) return [glob];
  const close = glob.indexOf("}", open);
  if (close < 0) return [glob];
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return glob
    .slice(open + 1, close)
    .split(",")
    .flatMap((alt) => expandBraces(head + alt + tail));
}

/** `*` stays inside a path segment, `**` crosses them, `**` + `/` also matches nothing. */
export function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if ("\\^$+.()|{}[]".includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`${re}$`);
}

export function compileGlobs(globs) {
  return globs.flatMap(expandBraces).map(globToRegExp);
}

export function matchesAny(path, globs) {
  return compileGlobs(globs).some((re) => re.test(path));
}

/* ----------------------------------------------------------------- git --- */

/** Parses `git diff --name-status -M` output. Returns [{ path, oldPath?, status, source }]. */
export function parseNameStatus(text, source) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const code = (cols[0] ?? "")[0];
    if (!code) continue;
    if ((code === "R" || code === "C") && cols.length >= 3) {
      out.push({ path: norm(cols[2]), oldPath: norm(cols[1]), status: code, source });
    } else if (cols[1]) {
      const status = code === "T" || code === "U" ? "M" : code;
      out.push({ path: norm(cols[1]), status, source });
    }
  }
  return out;
}

export function parseUntracked(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter(Boolean)
    .map((p) => ({ path: norm(p), status: "A", source: "untracked" }));
}

function norm(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Folds the four sources into one record per path. The file as it is NOW wins:
 * committed then deleted in the working tree is a deletion; added in a commit
 * then deleted before ever reaching the base is no change at all. A rename
 * leaves a deletion at the old path, so both paths get classified.
 */
export function mergeChanges(entries) {
  const sorted = [...entries].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const byPath = new Map();
  const touch = (path) => {
    if (!byPath.has(path)) byPath.set(path, { path, status: "M", sources: new Set() });
    return byPath.get(path);
  };
  for (const e of sorted) {
    if ((e.status === "R" || e.status === "C") && e.oldPath) {
      if (e.status === "R") {
        const old = touch(e.oldPath);
        old.sources.add(e.source);
        if (old.status === "A" && old.sources.size === 1) old.vanished = true;
        old.status = "D";
        old.renamedTo = e.path;
      }
      const cur = touch(e.path);
      cur.sources.add(e.source);
      cur.status = e.status === "R" ? "R" : "A";
      cur.oldPath = e.oldPath;
      delete cur.vanished;
      continue;
    }
    const cur = touch(e.path);
    const previously = cur.sources.size > 0 ? cur.status : null;
    cur.sources.add(e.source);
    if (e.status === "D") {
      // added on this branch and removed again: the base never had it, so nothing changed
      cur.vanished = previously === "A" || cur.vanished === true;
      cur.status = "D";
    } else if (e.status === "A") {
      cur.status = previously === "D" ? "M" : "A";
      delete cur.vanished;
    } else {
      cur.status = previously === "A" ? "A" : previously === "R" ? "R" : e.status;
      delete cur.vanished;
    }
  }
  return [...byPath.values()]
    .filter((c) => !c.vanished)
    .map((c) => ({ ...c, sources: [...c.sources].sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b]) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** What differs from `base`, from all four sources. Never throws for a missing base: it reports it. */
export function collectChanges({ cwd = process.cwd(), base = "origin/master", includeUntracked = true } = {}) {
  const warnings = [];
  let mergeBase = null;
  try {
    mergeBase = git(cwd, ["merge-base", base, "HEAD"]).trim();
  } catch {
    warnings.push(`could not find a common ancestor with ${base}; fetch it, or name another base with --base`);
  }
  const entries = [];
  if (mergeBase) entries.push(...parseNameStatus(git(cwd, ["diff", "--name-status", "-M", mergeBase, "HEAD"]), "committed"));
  entries.push(...parseNameStatus(git(cwd, ["diff", "--cached", "--name-status", "-M"]), "staged"));
  entries.push(...parseNameStatus(git(cwd, ["diff", "--name-status", "-M"]), "unstaged"));
  if (includeUntracked) entries.push(...parseUntracked(git(cwd, ["ls-files", "--others", "--exclude-standard"])));
  return { changes: mergeChanges(entries), mergeBase, base, baseMissing: mergeBase === null, warnings };
}

/* ------------------------------------------------------- classification -- */

const compiledCache = new WeakMap();
function compiled(map) {
  if (!compiledCache.has(map)) {
    compiledCache.set(map, {
      scratch: compileGlobs(map.scratch ?? []),
      rules: map.rules.map((rule) => ({ rule, res: compileGlobs(rule.match) })),
    });
  }
  return compiledCache.get(map);
}

/**
 * Whether a name looks like a throwaway file (`_probe.test.ts`, `online/*.tsv`).
 * Names starting with two underscores are real (`__init__.py`, `__soak.test.ts`).
 * Looking like scratch is not enough to be skipped: see `plan`.
 */
export function looksLikeScratch(path, map) {
  const base = path.split("/").pop();
  if (base.startsWith("__")) return false;
  return compiled(map).scratch.some((re) => re.test(path));
}

export function isSourceLike(path, map) {
  const name = path.split("/").pop();
  if ((map.sourceNames ?? []).includes(name) || name.startsWith(".env")) return true;
  const i = path.lastIndexOf(".");
  const ext = i > path.lastIndexOf("/") ? path.slice(i).toLowerCase() : "";
  return map.sourceExtensions.includes(ext);
}

/** Files vitest can follow imports from. Anything else is read at run time (fs), so no import graph sees it. */
export function isCodeFile(path) {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(path);
}

/** { kind: "rule" | "unknown-source" | "unclassified", rule? } */
export function classify(path, map) {
  const c = compiled(map);
  for (const { rule, res } of c.rules) if (res.some((re) => re.test(path))) return { kind: "rule", rule };
  return { kind: isSourceLike(path, map) ? "unknown-source" : "unclassified" };
}

export function projectOf(path, map) {
  for (const [project, def] of Object.entries(map.projects)) {
    if (def.prefixes.some((p) => path.startsWith(p))) return project;
  }
  return null;
}

export function isTestFile(path) {
  return /\.test\.(?:ts|tsx|mjs|js)$/.test(path);
}

/* ---------------------------------------------------------- test index --- */

/** Import specifiers in a file, as written. */
export function extractSpecifiers(source) {
  const out = new Set();
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock)\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  for (let m = re.exec(source); m; m = re.exec(source)) out.add(m[1]);
  return [...out];
}

function stripExt(p) {
  return p.replace(/\.(?:js|jsx|ts|tsx|mjs|mts|cjs|json)$/, "");
}

/** A specifier written in `fromPath`, as a repo-relative path without extension (or null for a package). */
export function specifierKey(spec, fromPath) {
  let p;
  if (spec.startsWith(".")) p = posixNormalize(`${fromPath.split("/").slice(0, -1).join("/")}/${spec}`);
  else if (spec.startsWith("@/")) p = `ui-source/src/${spec.slice(2)}`;
  else return null;
  return stripExt(p);
}

function posixNormalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Every test file with the repo-relative keys of what it imports. */
export function buildTestIndex(root, map) {
  const tests = [];
  const walk = (dirRel, project, projectRoot) => {
    const abs = join(root, dirRel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const rel = `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") walk(rel, project, projectRoot);
      } else if (isTestFile(entry.name)) {
        const imports = extractSpecifiers(readFileSync(join(root, rel), "utf8"))
          .map((s) => specifierKey(s, rel))
          .filter(Boolean);
        tests.push({ path: rel, project, projectRoot, imports });
      }
    }
  };
  for (const t of map.testTrees) walk(t.dir, t.project, t.root);
  return tests.sort((a, b) => a.path.localeCompare(b.path));
}

/** Tests that import the file directly, or sit beside it with the same name. */
export function directTestsFor(path, testIndex) {
  const key = stripExt(path);
  const alt = key.replace(/\/index$/, "");
  const base = key.split("/").pop();
  const dir = key.split("/").slice(0, -1).join("/");
  return testIndex.filter((t) => {
    if (t.imports.includes(key) || t.imports.includes(alt)) return true;
    const tdir = t.path.split("/").slice(0, -1).join("/");
    const tbase = t.path.split("/").pop().replace(/\.test\.[a-z]+$/, "");
    return tdir === dir && tbase === base;
  });
}

/* ----------------------------------------------------------------- plan -- */

const LEVEL_RANK = { REQUIRED: 1, RECOMMENDED: 0 };

/** `path` as seen from the directory `projectRoot` (both repo-relative, posix): `../ui-source/x.ts` for a file outside it. */
function relativeTo(path, projectRoot) {
  if (projectRoot === ".") return path;
  const from = projectRoot.split("/").filter(Boolean);
  const to = path.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
}

/**
 * Builds the plan from the change set. Pure: no git, no file system.
 *
 * @param {object} args
 * @param {Array}  args.changes   from mergeChanges / collectChanges
 * @param {Array}  args.testIndex from buildTestIndex
 * @param {object} args.map       risk-map.json
 * @param {object} [args.context] { base, mergeBase, baseMissing, warnings }
 */
export function plan({ changes, testIndex, map, context = {} }) {
  const checks = new Map(); // id -> { id, level, reasons:Set, files:Set }
  const notes = new Set();
  const approvals = new Set();
  const classes = new Set();
  const problems = [];
  const warnings = [...(context.warnings ?? [])];
  const unknown = [];
  const unclassified = [];
  const scratch = [];
  const rows = [];
  let risk = "none";
  let conservative = Boolean(context.baseMissing);

  const raise = (r) => {
    if (RISK_ORDER.indexOf(r) > RISK_ORDER.indexOf(risk)) risk = r;
  };
  const add = (id, level, reason, files = []) => {
    const cur = checks.get(id) ?? { id, level, reasons: new Set(), files: new Set() };
    if (LEVEL_RANK[level] > LEVEL_RANK[cur.level]) cur.level = level;
    cur.reasons.add(reason);
    for (const f of files) cur.files.add(f);
    checks.set(id, cur);
  };

  add("scope", "REQUIRED", "every change is reviewed in full");
  if (context.baseMissing) {
    notes.add(`The base ${context.base ?? "(none)"} could not be found, so the size of this change is unknown: verifying conservatively.`);
    for (const id of map.unknown.conservative) add(id, "REQUIRED", "the base to compare with could not be found");
    raise("conservative");
  }

  // sorted, so the plan never depends on the order the changes arrived in
  for (const change of [...changes].sort((a, b) => a.path.localeCompare(b.path))) {
    const { path } = change;
    const c = classify(path, map);
    const deleted = change.status === "D";
    // A scratch-looking file that is only untracked is skipped (and said so). One that is
    // tracked is checked like any other file, and flagged: nothing is silently dropped.
    const scratchLooking = looksLikeScratch(path, map);
    const untrackedOnly = change.sources.every((s) => s === "untracked");
    rows.push({
      path,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      ...(change.renamedTo ? { renamedTo: change.renamedTo } : {}),
      status: change.status,
      sources: change.sources,
      class: scratchLooking && untrackedOnly ? "scratch" : c.kind === "rule" ? c.rule.class : c.kind,
    });

    if (change.renamedTo) notes.add(`${path} was renamed to ${change.renamedTo}: both paths are classified, and the typecheck finds importers still using the old one.`);
    else if (deleted) notes.add(`${path} was deleted: anything still importing it must be fixed (the typecheck finds it), and a deleted test means less coverage.`);

    if (scratchLooking && untrackedOnly) {
      scratch.push(path);
      warnings.push(`${path} looks like an untracked scratch file: leave it unstaged.`);
      continue;
    }
    if (scratchLooking && (change.sources.includes("committed") || change.sources.includes("staged"))) {
      problems.push(`${path} looks like a scratch file but is ${change.sources.includes("committed") ? "committed" : "staged"}: scratch files must not be committed.`);
    }
    if (c.kind === "unclassified") {
      unclassified.push(path);
      continue;
    }
    if (c.kind === "unknown-source") {
      unknown.push(path);
      conservative = true;
      for (const id of map.unknown.conservative) add(id, "REQUIRED", `${path}: no rule covers this path`);
      raise("conservative");
      continue;
    }

    const { rule } = c;
    classes.add(rule.class);
    raise(rule.risk);
    for (const n of rule.notes ?? []) notes.add(n);
    if (rule.approval) approvals.add(rule.approval);
    const component = rule.component ?? projectOf(path, map);

    const expand = (ids, level) => {
      for (const id of ids) {
        const reason = `${path} (${rule.class})`;
        if (id === "direct-tests") {
          if (deleted || isTestFile(path)) continue;
          const direct = directTestsFor(path, testIndex);
          if (direct.length === 0 && !isCodeFile(path)) {
            // a data file is read at run time: no import graph, and so no `related` run, can find its tests
            notes.add(`${path}: not a code file, so no test imports it and a related-tests run cannot find its users: the whole ${component ?? "engine"} suite is selected instead.`);
            add(`full-${component ?? "engine"}`, level, `${reason}: data file with no direct tests`);
          } else if (direct.length === 0) {
            notes.add(`${path}: no test imports it directly, so the transitive related-tests run is required instead.`);
            if (component) add(`related-${component}`, level, `${reason}: no direct tests`, [path]);
          } else for (const t of direct) add(`direct:${t.project}`, level, reason, [t.path]);
        } else if (id === "run-changed-tests") {
          if (deleted) notes.add(`${path} (a test) was deleted: confirm the behaviour it covered is tested elsewhere.`);
          else if (isTestFile(path)) {
            const project = projectOf(path, map) ?? component;
            add(`direct:${project}`, level, reason, [path]);
          } else {
            // a helper or fixture beside the tests: run the tests that import it, or the whole project if none do
            const users = directTestsFor(path, testIndex);
            const project = projectOf(path, map) ?? component;
            if (users.length > 0) for (const t of users) add(`direct:${t.project}`, level, `${reason}: imported by this test`, [t.path]);
            else {
              notes.add(`${path} is not a test and no test imports it (a fixture or data file?), so the whole ${project} suite is selected: it cannot be traced to the tests that read it.`);
              add(`full-${project}`, level, `${reason}: support file with no importing test`);
            }
          }
        } else if (id.startsWith("related-")) {
          if (!deleted && !isTestFile(path)) add(id, level, reason, [path]);
          else if (deleted) add(`full-${id.slice("related-".length)}`, level, `${reason}: deleted, so nothing can be traced from it`);
        } else add(id, level, reason);
      }
    };
    expand(rule.requires, "REQUIRED");
    expand(rule.recommends ?? [], "RECOMMENDED");
    if (deleted && component && !isTestFile(path)) add(`full-${component}`, "RECOMMENDED", `${path} was deleted`);
  }

  const nothing = changes.length === 0;
  if (nothing && !context.baseMissing) {
    notes.add("Nothing differs from the base. Check that this is the right branch and worktree before concluding there is nothing to verify.");
  }

  if (conservative && unknown.length > 0) {
    notes.add(`Unknown source path(s): ${unknown.join(", ")}. ${map.unknown.why} Add a rule to risk-map.json if the area is new.`);
  }

  // turn the accumulated ids into concrete checks
  const out = [];
  for (const entry of [...checks.values()]) {
    const files = [...entry.files].sort();
    out.push(materialize(entry, files, map, /^[0-9a-f]{7,64}$/.test(context.mergeBase ?? "") ? context.mergeBase : null));
  }
  out.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));

  const database = out.some((c) => c.needsDatabase);
  if (database) {
    notes.add("Some selected checks need PostgreSQL. Locally that is PGlite (one session, version 18): it cannot show locks, deadlocks or concurrency, and runs must be one file at a time. CI's PostgreSQL 16 is the authority.");
  }

  return {
    version: 1,
    base: context.base ?? null,
    mergeBase: context.mergeBase ?? null,
    empty: nothing,
    conservative,
    risk,
    classes: [...classes].sort(),
    changes: rows.sort((a, b) => a.path.localeCompare(b.path)),
    unknownSourcePaths: unknown.sort(),
    unclassifiedPaths: unclassified.sort(),
    scratchPaths: scratch.sort(),
    problems: problems.sort(),
    warnings: [...new Set(warnings)].sort(),
    approvalsNeeded: [...approvals].sort(),
    notes: [...notes].sort(),
    needsDatabase: database,
    required: out.filter((c) => c.level === "REQUIRED"),
    recommended: out.filter((c) => c.level === "RECOMMENDED"),
    limitations: map.limitations,
    localVersusCi: "Everything above is a LOCAL plan. Only GitHub CI on the pull request (the required `test` job passing, `deploy` skipped) is authoritative.",
  };
}

/** One check, with its commands filled in. */
function materialize(entry, files, map, mergeBaseOf) {
  const reasons = [...entry.reasons].sort();
  if (entry.id.startsWith("direct:")) {
    const project = entry.id.slice("direct:".length);
    const tree = map.testTrees.find((t) => t.project === project);
    const rel = files.map((f) => relativeTo(f, tree?.root ?? "."));
    const dbFiles = files.filter((f) => map.databaseSuites.includes(f.split("/").pop()));
    const list = rel.join(" ");
    const serial = dbFiles.length > 0 ? " --no-file-parallelism" : "";
    const command =
      project === "ui"
        ? `npm --prefix ui-source run test -- ${list}`
        : project === "online"
          ? `npx vitest run --root online${serial} ${list}`
          : `npx vitest run${serial} ${list}`;
    return {
      id: entry.id,
      level: entry.level,
      kind: "command",
      tier: 1,
      label: `Tests that import the changed ${project} files (${files.length} file${files.length === 1 ? "" : "s"})`,
      commands: [command],
      files,
      reasons,
      needsDatabase: dbFiles.length > 0,
      ...(dbFiles.length > 0
        ? {
            env: map.checks["db-suites"].env,
            prerequisite: map.checks["db-suites"].prerequisite,
            note: `${dbFiles.map((f) => f.split("/").pop()).join(", ")} need a database: pass --no-file-parallelism and run them one at a time on PGlite. Without a database they skip, and a skip is not a pass.`,
          }
        : {}),
    };
  }
  const def = map.checks[entry.id];
  if (!def) throw new Error(`risk-map.json has no check called ${entry.id}`);
  let commands = def.commands;
  let usedFiles = [];
  let cwd = def.cwd;
  let fallbackNote;
  if (def.projectFiles) {
    const root = def.relativeTo ?? ".";
    const source = files.filter((f) => !isTestFile(f));
    usedFiles = source;
    const full = map.checks[{ engine: "full-engine", ui: "full-ui", online: "full-online" }[def.projectFiles]];
    // vitest can only follow imports: a data file, a long list, or no file at all cannot be turned into a
    // `related` run, so the whole project's suite runs instead (never a command with a placeholder left in it)
    if (source.length === 0 || source.length > MAX_FILES_IN_COMMAND || source.some((f) => !isCodeFile(f))) {
      commands = full.commands;
      cwd = full.cwd;
      fallbackNote =
        source.length === 0
          ? "No changed file is left to trace from, so the whole suite runs."
          : source.some((f) => !isCodeFile(f))
            ? "A changed file is not code, so it cannot be traced through imports: the whole suite runs."
            : `More than ${MAX_FILES_IN_COMMAND} files changed: the whole suite runs.`;
    } else {
      const list = source.map((f) => relativeTo(f, root)).join(" ");
      commands = def.commands.map((c) => c.replace("{files}", list));
    }
  }
  commands = commands.map((c) => c.replace("{base}", mergeBaseOf ?? "HEAD"));
  return {
    id: entry.id,
    level: entry.level,
    kind: def.kind,
    tier: def.tier,
    label: def.label,
    commands,
    ...(cwd && cwd !== "." ? { cwd } : {}),
    files: usedFiles,
    reasons,
    needsDatabase: Boolean(def.needsDatabase),
    ...(def.env ? { env: def.env } : {}),
    ...(def.prerequisite ? { prerequisite: def.prerequisite } : {}),
    ...(def.parser ? { parser: def.parser } : {}),
    ...(def.seconds ? { seconds: def.seconds } : {}),
    ...(def.note || fallbackNote ? { note: [def.note, fallbackNote].filter(Boolean).join(" ") } : {}),
    ...(def.authoritative ? { authoritative: true } : {}),
  };
}

/* ------------------------------------------------------------ rendering -- */

const TIER_NAMES = ["T0 always", "T1 targeted", "T2 wider", "T3 full suites", "T4 deep", "CI"];

export function renderText(p) {
  const L = [];
  L.push(`Verification plan  (base ${p.base ?? "?"}${p.mergeBase ? `, merge-base ${p.mergeBase.slice(0, 7)}` : ""})`);
  L.push(`Risk: ${p.risk.toUpperCase()}${p.conservative ? "  (conservative: something could not be classified)" : ""}   Classes: ${p.classes.join(", ") || "-"}`);
  L.push("");
  L.push(`Changes (${p.changes.length}):`);
  for (const c of p.changes) {
    const rename = c.oldPath ? `  <- ${c.oldPath}` : c.renamedTo ? `  -> ${c.renamedTo}` : "";
    L.push(`  ${c.status.padEnd(2)} ${c.path}${rename}  [${c.sources.join("+")}]  ${c.class}`);
  }
  const section = (title, items) => {
    if (items.length === 0) return;
    L.push("", `${title}:`);
    for (const i of items) L.push(`  - ${i}`);
  };
  section("PROBLEMS (fix first)", p.problems);
  section("Unknown source paths (verifying conservatively)", p.unknownSourcePaths);
  section("Unclassified, not source (no checks; listed so they are not invisible)", p.unclassifiedPaths);
  section("Warnings", p.warnings);
  section("Approval needed before this is pushed", p.approvalsNeeded);
  section("Notes", p.notes);
  const checks = (title, list) => {
    L.push("", `${title} (${list.length}):`);
    let tier = -1;
    for (const c of list) {
      if (c.tier !== tier) {
        tier = c.tier;
        L.push(`  -- ${TIER_NAMES[tier] ?? `tier ${tier}`}`);
      }
      const secs = c.seconds ? `  ~${c.seconds.local}s local${c.seconds.ci ? ` / ~${c.seconds.ci}s CI` : ""}` : "";
      L.push(`  [${c.id}] ${c.label}${secs}${c.needsDatabase ? "  (needs a database)" : ""}`);
      if (c.prerequisite) L.push(`      first: ${c.prerequisite}`);
      if (c.env) L.push(`      env:   ${Object.entries(c.env).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      if (c.cwd) L.push(`      in:    ${c.cwd}/`);
      for (const cmd of c.commands) L.push(`      $ ${cmd}`);
      if (c.note) L.push(`      note: ${c.note}`);
    }
  };
  checks("REQUIRED", p.required);
  checks("RECOMMENDED (deeper; not needed to call this change verified)", p.recommended);
  L.push("", p.localVersusCi, "", "Limitations:");
  for (const l of p.limitations) L.push(`  - ${l}`);
  return L.join("\n");
}

/* ------------------------------------------------------------------ cli -- */

function parseArgs(argv) {
  const o = { base: "origin/master", json: false, untracked: true, cwd: process.cwd(), changesFile: null, mapPath: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--no-untracked") o.untracked = false;
    else if (a === "--base") o.base = argv[++i];
    else if (a === "--cwd") o.cwd = resolve(argv[++i]);
    else if (a === "--changes-file") o.changesFile = argv[++i];
    else if (a === "--map") o.mapPath = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  try {
    const map = args.mapPath ? loadMap(args.mapPath) : loadMap();
    let collected;
    if (args.changesFile) {
      const given = readJson(args.changesFile);
      collected = { changes: given.changes ?? given, base: given.base ?? args.base, mergeBase: given.mergeBase ?? null, baseMissing: false, warnings: [] };
    } else collected = collectChanges({ cwd: args.cwd, base: args.base, includeUntracked: args.untracked });
    const testIndex = buildTestIndex(args.cwd, map);
    const result = plan({ changes: collected.changes, testIndex, map, context: collected });
    if (args.out) writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${args.json ? JSON.stringify(result, null, 2) : renderText(result)}\n`);
    return result.problems.length > 0 ? 3 : 0;
  } catch (e) {
    process.stderr.write(`select-checks: ${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
