/**
 * The local UI under test: built once for this run into a temporary directory and served by a static server
 * process this run owns, on a free loopback port. Nothing is reused, so a test can never attach to a dev server,
 * a tunnel, or anything pointed at a deployed service.
 *
 * Solo play needs nothing else: the league lives in the browser, and the UI's league API is aimed at a closed
 * loopback port for good measure (the browser guard blocks it too).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";
import { killTree } from "../../.claude/skills/wentz-verify/run-checks.mjs";

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

export interface UiStack {
  /** `http://127.0.0.1:<port>`: the only origin the test browser may reach. */
  origin: string;
  port: number;
  pid: number;
  dir: string;
  buildMs: number;
  stop: () => Promise<void>;
}

/** Builds the production bundle of the UI into a temporary directory. Returns the directory and how long it took. */
export function buildUi(): { dir: string; ms: number } {
  const dir = mkdtempSync(join(tmpdir(), "wentz-e2e-ui-"));
  const started = Date.now();
  const vite = join(UI_DIR, "node_modules", "vite", "bin", "vite.js");
  const r = spawnSync(process.execPath, [vite, "build", "--configLoader", "runner", "--outDir", dir, "--emptyOutDir"], {
    cwd: UI_DIR,
    // a scrubbed environment (no database or deployment settings) and an API address that cannot reach anything
    env: { ...baseEnvironment(process.env), VITE_LEAGUE_API: DEAD_API },
    encoding: "utf8",
    timeout: 300_000,
    windowsHide: true,
  });
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`building the UI failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(-1500)}`);
  }
  return { dir, ms: Date.now() - started };
}

/** Builds the UI and serves it from a process this run owns. */
export async function startUi(): Promise<UiStack> {
  const { dir, ms } = buildUi();
  const port = await freePort();
  const token = randomBytes(12).toString("hex");
  const child: ChildProcess = spawn(process.execPath, [STATIC_SERVER, dir, String(port), token, String(process.pid)], {
    env: baseEnvironment(process.env),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const pid = child.pid ?? 0;
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const stop = async (): Promise<void> => {
    killTree(pid);
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  };
  const deadline = Date.now() + 20_000;
  while (!out.includes(`READY ${token}`)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`the static UI server did not start: ${out.trim() || "no output"}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const origin = `http://127.0.0.1:${port}`;
  // it must be the server this run started, not whatever else answers on that port
  const res = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5000) });
  if (res.headers.get("x-e2e-token") !== token) {
    await stop();
    throw new Error("the port is answered by something other than this run's UI server");
  }
  return { origin, port, pid, dir, buildMs: ms, stop };
}
