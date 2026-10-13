/**
 * What the runner is allowed to execute. A plan is data (a JSON file anyone can
 * edit), so nothing in it is trusted: every command is matched against the
 * short list of verification commands this repository has, and anything else
 * is refused before a process is started.
 *
 * The rules, in order of importance:
 *   - the command must be one of the TEMPLATES below, with only the slots they
 *     name filled in (test file paths that exist, a `--root online`, ...);
 *   - it is made only of letters, digits and `_ @ / . : = , + -` and single
 *     spaces, so there is no quote, redirect, pipe, `$`, backtick, `;`, `&`,
 *     `%` or newline for a shell to act on;
 *   - the executable is `npm`, `npx` or the stated script runner, never a path;
 *   - every path stays inside the repository and names a file that exists;
 *   - the only environment a check may set is DB_POOL_MAX, CI and STATS_SEEDS,
 *     with values of the expected shape (the database URL is chosen elsewhere,
 *     see db-safety.mjs).
 *
 * `validateCommand` returns what to run as an argument list; nothing here runs
 * anything. On Linux the process is started without a shell. On Windows `npm`
 * and `npx` are .cmd files that need one, which is safe only because of the
 * character set above, so `launchSpec` refuses to build a command that breaks it.
 */
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** Anything outside this set (quotes, `;`, `&`, `|`, `<`, `>`, `$`, backtick, `%`, `^`, `\`, newline, tab) is refused. */
export const SAFE_COMMAND = /^[A-Za-z0-9_@/.:=,+\- ]+$/;

/** Commands with nothing to fill in. Value: where they run. */
const FIXED = new Map([
  ["npm run typecheck", "."],
  ["npm run online:typecheck", "."],
  ["npm test", "."],
  ["npm run online:test", "."],
  ["npm run online:test -- --no-file-parallelism", "."],
  ["npm --prefix ui-source run typecheck", "."],
  ["npm --prefix ui-source run build", "."],
  ["npm --prefix ui-source run test", "."],
  ["npx tsx analysis/39_league_metrics.ts", "."],
]);

const STRESS = "npm run franchise:stress -- --mode smoke";
const CWDS = new Set([".", "ui-source"]);

export const ENV_RULES = {
  DB_POOL_MAX: /^[1-9][0-9]?$/,
  CI: /^true$/,
  STATS_SEEDS: /^[1-9][0-9]{0,2}$/,
};

const exists = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The real location of a path, with every symlink and Windows junction followed; null if it cannot be resolved. */
const realOf = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

const insideRepo = (repoRoot, absolute) => {
  const rel = relative(repoRoot, absolute);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * A repo file named in a command. `baseDir` is the directory the command resolves it from.
 * Returns null when fine, else why not.
 */
function badPath(token, { baseDir, repoRoot, fileExists, realPath, allowParent, pattern, what }) {
  if (token.startsWith("-")) return `"${token}" looks like an option, not ${what}`;
  if (token.startsWith("/") || token.includes(":")) return `"${token}" is an absolute path`;
  const parts = token.split("/");
  if (parts.some((p) => p === "")) return `"${token}" has an empty path segment`;
  if (!allowParent && parts.includes("..")) return `"${token}" leaves the project`;
  if (parts.includes("node_modules") || parts.includes(".git")) return `"${token}" is inside node_modules or .git`;
  if (!pattern.test(token)) return `"${token}" is not ${what}`;
  const absolute = resolve(baseDir, token);
  if (!insideRepo(repoRoot, absolute)) return `"${token}" is outside the repository`;
  if (!fileExists(absolute)) return `"${token}" does not exist`;
  // the name can be inside the repository while a symlink or junction in the path leads outside it
  const rootReal = realPath(repoRoot);
  const fileReal = realPath(absolute);
  if (!rootReal || !fileReal || !insideRepo(rootReal, fileReal)) return `"${token}" resolves outside the repository (a symlink or junction)`;
  return null;
}

const TEST_FILE = /\.test\.(?:ts|tsx)$/;
const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/**
 * @param {string} command  one command line from a plan
 * @param {object} ctx
 * @param {string} ctx.repoRoot   absolute path of the repository
 * @param {string} [ctx.cwd]      "." or "ui-source": where the command is meant to run
 * @param {(path: string) => boolean} [ctx.fileExists]
 * @param {Policy} [ctx.policy]   replaced only by tests
 * @returns {{ ok: true, kind: string, argv: string[], cwd: string } | { ok: false, reason: string }}
 */
export function validateCommand(command, { repoRoot, cwd = ".", fileExists = exists, realPath = realOf, policy = DEFAULT_POLICY } = {}) {
  if (typeof command !== "string" || command.trim() === "") return { ok: false, reason: "the command is empty" };
  if (!policy.safeCharacters.test(command)) return { ok: false, reason: "contains a character that is not allowed (quotes, redirects, pipes, $, `, ;, &, %, or a newline)" };
  if (command !== command.trim() || command.includes("  ")) return { ok: false, reason: "has leading, trailing or repeated spaces" };
  if (!CWDS.has(cwd)) return { ok: false, reason: `"${cwd}" is not a directory a check may run in` };
  const root = resolve(repoRoot);
  if (cwd !== ".") {
    const rootReal = realPath(root);
    const dirReal = realPath(resolve(root, cwd));
    if (!rootReal || !dirReal || !insideRepo(rootReal, dirReal)) return { ok: false, reason: `"${cwd}" resolves outside the repository (a symlink or junction)` };
  }

  for (const rule of policy.extra) {
    const hit = rule(command, { repoRoot: root, cwd });
    if (hit) return hit;
  }

  if (FIXED.has(command)) {
    if (cwd !== ".") return { ok: false, reason: `"${command}" only runs from the repository root` };
    return { ok: true, kind: "fixed", argv: command.split(" "), cwd };
  }
  if (command === STRESS) {
    if (cwd !== ".") return { ok: false, reason: "the stress test only runs from the repository root" };
    return { ok: true, kind: "stress", argv: command.split(" "), cwd };
  }

  const tokens = command.split(" ");
  const bad = (reason) => ({ ok: false, reason });

  // npm --prefix ui-source run test -- <ui test files>
  const uiPrefix = "npm --prefix ui-source run test -- ";
  if (command.startsWith(uiPrefix)) {
    if (cwd !== ".") return bad("the UI test command only runs from the repository root");
    const files = tokens.slice(6);
    if (files.length === 0) return bad("names no test file");
    for (const f of files) {
      const why = badPath(f, { baseDir: resolve(root, "ui-source"), repoRoot: root, fileExists, realPath, allowParent: false, pattern: TEST_FILE, what: "a .test.ts or .test.tsx file" });
      if (why) return bad(why);
    }
    return { ok: true, kind: "ui-test", argv: tokens, cwd };
  }

  // npx vitest run [--root online] [--no-file-parallelism] <test files>
  if (tokens[0] === "npx" && tokens[1] === "vitest" && tokens[2] === "run") {
    if (cwd !== ".") return bad("this vitest command only runs from the repository root");
    let i = 3;
    let online = false;
    let serial = false;
    for (; i < tokens.length && tokens[i].startsWith("-"); i++) {
      if (tokens[i] === "--root" && tokens[i + 1] === "online" && !online) {
        online = true;
        i++;
      } else if (tokens[i] === "--no-file-parallelism" && !serial) serial = true;
      else return bad(`the option "${tokens[i]}" is not allowed`);
    }
    const files = tokens.slice(i);
    if (files.length === 0) return bad("names no test file");
    const baseDir = online ? resolve(root, "online") : root;
    for (const f of files) {
      const why = badPath(f, { baseDir, repoRoot: root, fileExists, realPath, allowParent: false, pattern: TEST_FILE, what: "a .test.ts or .test.tsx file" });
      if (why) return bad(why);
    }
    return { ok: true, kind: "vitest-run", argv: tokens, cwd };
  }

  // npx vitest related <files> [--root online] --run   (from the repo root, or from ui-source)
  if (tokens[0] === "npx" && tokens[1] === "vitest" && tokens[2] === "related") {
    if (tokens[tokens.length - 1] !== "--run") return bad("a related run must end with --run");
    const body = tokens.slice(3, -1);
    let online = false;
    const files = [...body];
    // the one other option: one test file at a time, which a single-session local database needs (after the root, before --run)
    if (files[files.length - 1] === "--no-file-parallelism") files.pop();
    const rootAt = files.indexOf("--root");
    if (rootAt >= 0) {
      if (files[rootAt + 1] !== "online" || rootAt + 2 !== files.length) return bad("only `--root online`, after the files, is allowed");
      if (cwd !== ".") return bad("--root online is only used from the repository root");
      online = true;
      files.splice(rootAt, 2);
    }
    if (files.length === 0) return bad("names no file");
    const baseDir = resolve(root, online ? "online" : cwd);
    for (const f of files) {
      const why = badPath(f, { baseDir, repoRoot: root, fileExists, realPath, allowParent: true, pattern: CODE_FILE, what: "a source file" });
      if (why) return bad(why);
    }
    return { ok: true, kind: "vitest-related", argv: tokens, cwd };
  }

  return { ok: false, reason: `"${command.split(" ").slice(0, 3).join(" ")}..." is not one of the verification commands this tool runs` };
}

/** Which environment variables a check may set, with their values. Everything else is refused. */
export function validateEnv(env = {}) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === "DATABASE_URL") continue; // documentation in the plan: the URL actually used is chosen with --test-database
    const rule = ENV_RULES[key];
    if (!rule) return { ok: false, reason: `the environment variable ${key} is not one a check may set` };
    if (typeof value !== "string" || !rule.test(value)) return { ok: false, reason: `${key} has a value of the wrong shape` };
    out[key] = value;
  }
  return { ok: true, env: out };
}

/**
 * How to start a validated command. On Windows the program is a .cmd file, which only a shell can start;
 * the character set has already been checked, and is checked again here so this function is safe on its own.
 */
export function launchSpec(validated, { platform = process.platform, appendArgs = [] } = {}) {
  const argv = [...validated.argv, ...appendArgs];
  if (platform === "win32") {
    // appendArgs come from this tool (a scratch directory), never from a plan; quote them for cmd.exe
    if (!SAFE_COMMAND.test(validated.argv.join(" "))) throw new Error("refusing to build a shell command from an unvalidated string");
    const line = [...validated.argv, ...appendArgs.map((a) => `"${String(a).replace(/["%^&|<>]/g, "")}"`)].join(" ");
    return { file: line, args: [], shell: true, display: line };
  }
  return { file: argv[0], args: argv.slice(1), shell: false, display: argv.join(" ") };
}

/**
 * @typedef {{ safeCharacters: RegExp, extra: Array<(command: string, ctx: object) => object | null> }} Policy
 * The policy is a parameter only so tests can run a harmless command that the real one refuses.
 * The command line never sets it.
 */
export const DEFAULT_POLICY = Object.freeze({ safeCharacters: SAFE_COMMAND, extra: Object.freeze([]) });
