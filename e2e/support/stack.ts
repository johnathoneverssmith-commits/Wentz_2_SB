/**
 * The local UI under test: built once for this run into a temporary directory and served by a static server
 * process this run owns, on a free loopback port. Nothing is reused, so a test can never attach to a dev server,
 * a tunnel, or anything pointed at a deployed service.
 *
 * Everything this module creates (a temporary build directory, a server process) is released if anything after
 * its creation fails: a failed build, no free port, a server that cannot be started or dies, one that never says
 * it is ready, an identity request that is refused, times out, or is answered by something else. There is no step
 * after the first resource exists that can throw without cleaning up.
 *
 * Solo play needs nothing else: the league lives in the browser, and the UI's league API is aimed at a closed
 * loopback port for good measure (the browser guard blocks it too).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";
import { killTree, runProcess } from "../../.claude/skills/wentz-verify/run-checks.mjs";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI_DIR = join(REPO_ROOT, "ui-source");
const STATIC_SERVER = fileURLToPath(new URL("./static-server.mjs", import.meta.url));

/** The closed port the built UI's league API points at. Requests to it are blocked by the browser guard anyway. */
export const DEAD_API = "http://127.0.0.1:9";

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const a = probe.address();
      const port = typeof a === "object" && a ? a.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rejects if `promise` has not settled in `ms`, whether or not the thing behind it honours an abort signal. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export interface UiStack {
  /** `http://127.0.0.1:<port>`: the only origin the test browser may reach. */
  origin: string;
  port: number;
  pid: number;
  dir: string;
  buildMs: number;
  /** Ends the server and its children and removes the build directory. Safe to call more than once. */
  stop: () => Promise<void>;
}

export interface BuildOptions {
  /** Replaces the Vite entry script (tests only: a script that fails or hangs). */
  viteScript?: string;
  timeoutMs?: number;
}

/** Builds the production bundle of the UI into a temporary directory. The directory is removed if the build fails. */
export async function buildUi(options: BuildOptions = {}): Promise<{ dir: string; ms: number }> {
  const dir = mkdtempSync(join(tmpdir(), "wentz-e2e-ui-"));
  const started = Date.now();
  try {
    const vite = options.viteScript ?? join(UI_DIR, "node_modules", "vite", "bin", "vite.js");
    const r = await runProcess(
      { file: process.execPath, args: [vite, "build", "--configLoader", "runner", "--outDir", dir, "--emptyOutDir"], shell: false },
      {
        cwd: UI_DIR,
        // a scrubbed environment (no database or deployment settings) and an API address that cannot reach anything
        env: { ...baseEnvironment(process.env), VITE_LEAGUE_API: DEAD_API },
        timeoutMs: options.timeoutMs ?? 300_000, // runProcess ends the whole process tree on a timeout
      },
    );
    if (r.timedOut) throw new Error(`building the UI timed out after ${options.timeoutMs ?? 300_000} ms; its process tree was ended`);
    if (r.error) throw new Error(`building the UI could not start: ${r.error}`);
    if (r.status !== 0) throw new Error(`building the UI failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(-1500)}`);
    return { dir, ms: Date.now() - started };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

export interface StartOptions {
  /**
   * Seams for the tests of this module's own failure handling. The defaults are the real thing, and nothing
   * outside the tests passes any of them.
   */
  build?: () => Promise<{ dir: string; ms: number }>;
  serverScript?: string;
  /** The program that runs the server script (a path that does not exist makes spawning fail). */
  nodePath?: string;
  readyTimeoutMs?: number;
  identityTimeoutMs?: number;
  identityFetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** Told about each resource as it is created, so a test can check afterwards that none is left. */
  onResource?: (resource: { kind: "directory"; path: string } | { kind: "process"; pid: number }) => void;
}

/** Builds the UI and serves it from a process this run owns. Everything it created is released if it fails. */
export async function startUi(options: StartOptions = {}): Promise<UiStack> {
  const built = await (options.build ?? buildUi)();
  options.onResource?.({ kind: "directory", path: built.dir });
  let child: ChildProcess | undefined;
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child?.pid) killTree(child.pid);
    await sleep(300);
    rmSync(built.dir, { recursive: true, force: true });
  };

  try {
    const port = await freePort();
    const token = randomBytes(12).toString("hex");
    let output = "";
    let spawnError: Error | undefined;
    child = spawn(options.nodePath ?? process.execPath, [options.serverScript ?? STATIC_SERVER, built.dir, String(port), token, String(process.pid)], {
      env: baseEnvironment(process.env),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    // without a listener, a spawn failure is an unhandled 'error' event that takes the whole run down with the directory still on disk
    child.once("error", (e) => (spawnError = e));
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    if (child.pid) options.onResource?.({ kind: "process", pid: child.pid });

    const deadline = Date.now() + (options.readyTimeoutMs ?? 20_000);
    while (!output.includes(`READY ${token}`)) {
      if (spawnError) throw new Error(`the static UI server could not be started: ${spawnError.message}`);
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the static UI server exited before it was ready (code ${child.exitCode ?? child.signalCode}): ${output.trim() || "no output"}`);
      if (Date.now() > deadline) throw new Error(`the static UI server was not ready after ${options.readyTimeoutMs ?? 20_000} ms: ${output.trim() || "no output"}`);
      await sleep(50);
    }

    // it must be the server this run started, not whatever else answers on that port
    const origin = `http://127.0.0.1:${port}`;
    const identityMs = options.identityTimeoutMs ?? 5_000;
    const doFetch = options.identityFetch ?? ((url: string, init: { signal: AbortSignal }) => fetch(url, init));
    const res = await withTimeout(doFetch(`${origin}/`, { signal: AbortSignal.timeout(identityMs) }), identityMs, "the identity request to the UI server");
    if (res.headers.get("x-e2e-token") !== token) throw new Error("the port is answered by something other than this run's UI server");

    return { origin, port, pid: child.pid ?? 0, dir: built.dir, buildMs: built.ms, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
