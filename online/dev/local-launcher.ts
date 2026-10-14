/**
 * Starts the real league server for local testing, safely, and says when it is actually ready.
 *
 * The server runs in a child process whose environment is the validated one from `launcher-safety.ts`
 * (never this process's environment), loopback-only (`loopback-only.mjs`), on a port the launcher has checked
 * is free. "Ready" means the server announced it was listening on 127.0.0.1, it logged `schema ready` (the
 * migration finished against the chosen database), and `/version` answered as the league API. Anything that
 * goes wrong on the way, including a timeout, ends the whole process tree before the error is reported.
 *
 * This module imports neither the server nor any database module: the server code only ever loads inside the
 * child, after the configuration has been validated.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { killTree } from "../../.claude/skills/wentz-verify/run-checks.mjs";

import { LOOPBACK_ADDRESS, redact, type LauncherConfig } from "./launcher-safety.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const TSCONFIG = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const PRELOAD = pathToFileURL(`${HERE}loopback-only.mjs`).href;

export class LauncherError extends Error {
  constructor(
    message: string,
    readonly tail: string[] = [],
  ) {
    super(message);
    this.name = "LauncherError";
  }
}

export interface RunningServer {
  /** http://127.0.0.1:<port> */
  url: string;
  port: number;
  /** The child's pid (the process that runs the server's launcher shim). */
  pid: number;
  /** Resolves with the exit code when the server process ends, however it ends. */
  exited: Promise<number | null>;
  /** Ends the server and everything it started; resolves when it has gone. */
  stop: () => Promise<void>;
  /** The last lines the server printed, with the database URL and password removed. */
  tail: () => string[];
}

const connects = (host: string, port: number, timeoutMs = 600): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

const canBind = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, LOOPBACK_ADDRESS, () => probe.close(() => resolve(true)));
  });

/** Whether anything is listening on, or holds, this port on the loopback interface. */
export async function portInUse(port: number): Promise<boolean> {
  if (await connects(LOOPBACK_ADDRESS, port)) return true;
  if (await connects("::1", port)) return true;
  return !(await canBind(port));
}

/** A free port chosen by the operating system, for runs that must not collide with anything. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, LOOPBACK_ADDRESS, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export interface StartOptions {
  config: LauncherConfig;
  /** How long to wait for "ready" before giving up and ending the process tree. */
  timeoutMs?: number;
  /** Called with each line of the server's output, already redacted. */
  onLog?: (line: string) => void;
  /** Replaces the server entry. For this module's tests only; the command line cannot set it. */
  entry?: string;
}

export async function startLocalServer({ config, timeoutMs = 90_000, onLog, entry = DEFAULT_ENTRY }: StartOptions): Promise<RunningServer> {
  if (await portInUse(config.port)) {
    throw new LauncherError(`port ${config.port} is already in use by something else on this machine. The launcher never reuses a service it did not start: stop it, or choose another PORT.`);
  }

  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const child = spawn(process.execPath, [tsxCli, "--tsconfig", TSCONFIG, "--import", PRELOAD, entry], {
    cwd: REPO_ROOT,
    env: config.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const pid = child.pid ?? 0;

  const lines: string[] = [];
  let listening: string | null = null;
  let schemaReady = false;
  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => {
      exitCode = code;
      resolve(code);
    });
    child.once("error", () => {
      exitCode = null;
      resolve(null);
    });
  });
  const stop = async (): Promise<void> => {
    if (exitCode === undefined) killTree(pid);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    // a group kill can leave the shim's direct child briefly: end the tree once more if anything is still listed
    if (exitCode === undefined) killTree(pid);
  };

  let notify: () => void = () => undefined;
  const onLine = (raw: string) => {
    const line = redact(raw.replace(/\r$/, ""), config.databaseUrl);
    if (!line) return;
    lines.push(line);
    if (lines.length > 60) lines.shift();
    const marker = /^WENTZ_LISTENING (\S+)$/.exec(line);
    if (marker) listening = marker[1] ?? null;
    if (/\bschema ready\b/.test(line)) schemaReady = true;
    onLog?.(line);
    notify();
  };
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      parts.forEach(onLine);
    });
    stream.on("end", () => buffer && onLine(buffer));
  }

  const fail = async (message: string): Promise<never> => {
    await stop();
    throw new LauncherError(message, [...lines]);
  };

  const deadline = Date.now() + timeoutMs;
  while (!(listening && schemaReady)) {
    if (exitCode !== undefined) throw new LauncherError(`the server exited (code ${exitCode}) before it was ready`, [...lines]);
    if (Date.now() > deadline) {
      return fail(`the server was not ready after ${Math.round(timeoutMs / 1000)} s (${listening ? "listening, but the schema was not applied" : "not listening"}); its process tree was ended`);
    }
    await new Promise<void>((resolve) => {
      notify = resolve;
      setTimeout(resolve, 200);
    });
  }

  const bound = String(listening);
  if (!bound.startsWith(`${LOOPBACK_ADDRESS}:`)) return fail(`the server bound ${bound}, not the loopback interface; its process tree was ended`);

  try {
    const res = await fetch(`http://${LOOPBACK_ADDRESS}:${config.port}/version`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { service?: string };
    if (body.service !== "online-api") return fail("something answered on the port, but not as the league server; its process tree was ended");
  } catch (e) {
    return fail(`the server did not answer /version (${(e as Error).message}); its process tree was ended`);
  }

  return { url: `http://${LOOPBACK_ADDRESS}:${config.port}`, port: config.port, pid, exited, stop, tail: () => [...lines] };
}
