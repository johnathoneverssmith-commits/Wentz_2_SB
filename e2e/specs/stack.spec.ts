import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { killTree } from "../../.claude/skills/wentz-verify/run-checks.mjs";
import { freePort } from "../support/stack.ts";

/** The static UI server, on its own: what it serves, what it refuses, and that it cannot be left behind. */
const SERVER = fileURLToPath(new URL("../support/static-server.mjs", import.meta.url));
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(dir: string, port: number, parent?: number) {
  const token = "t".repeat(24);
  const child = spawn(process.execPath, [SERVER, dir, String(port), token, ...(parent ? [String(parent)] : [])], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 100 && !out.includes(`READY ${token}`); i++) await sleep(50);
  expect(out).toContain(`READY ${token}`);
  return { child, pid: child.pid!, token };
}

test.describe("the UI server this run owns", () => {
  test("serves its own directory on loopback, read-only, and nothing outside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-static-"));
    const outside = join(dir, "..", `wentz-secret-${process.pid}.txt`);
    writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
    writeFileSync(outside, "do not serve");
    const port = await freePort();
    const s = await start(dir, port);
    try {
      const base = `http://127.0.0.1:${port}`;
      const home = await fetch(`${base}/`);
      expect(home.status).toBe(200);
      expect(home.headers.get("x-e2e-token")).toBe(s.token);
      expect(await home.text()).toBe("<h1>hi</h1>");
      expect((await fetch(`${base}/index.html`, { method: "HEAD" })).status).toBe(200);
      expect((await fetch(`${base}/nope.js`)).status).toBe(404);
      expect((await fetch(`${base}/`, { method: "POST", body: "x" })).status).toBe(405);
      expect((await fetch(`${base}/`, { method: "DELETE" })).status).toBe(405);
      // traversal: the raw request line is sent as is (fetch would tidy the dots away)
      for (const target of ["/../" + outside.split(/[\\/]/).pop(), "/%2e%2e/" + outside.split(/[\\/]/).pop(), "/..%2f" + outside.split(/[\\/]/).pop()]) {
        const status = await new Promise<number>((resolve) => {
          import("node:net").then(({ default: net }) => {
            const sock = net.connect(port, "127.0.0.1", () => sock.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
            let data = "";
            sock.on("data", (d) => (data += d));
            sock.on("close", () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1] ?? 0)));
          });
        });
        expect([403, 404], target).toContain(status);
      }
      // loopback only: not reachable on another interface
      const os = await import("node:os");
      const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
      if (lan) {
        const reached = await fetch(`http://${lan}:${port}/`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
        expect(reached, "reachable from another interface").toBe(false);
      }
    } finally {
      killTree(s.pid);
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });

  test("refuses a port that is already taken and exits, rather than sharing it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-static-"));
    const port = await freePort();
    const first = await start(dir, port);
    try {
      const second = spawnSync(process.execPath, [SERVER, dir, String(port), "x".repeat(24)], { encoding: "utf8", timeout: 20_000 });
      expect(second.status).toBe(1);
      expect(second.stderr).toMatch(/EADDRINUSE|address already in use/i);
    } finally {
      killTree(first.pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ends when the run that started it is gone, however the run ended", async () => {
    test.setTimeout(60_000);
    const dir = mkdtempSync(join(tmpdir(), "wentz-static-"));
    const port = await freePort();
    // a stand-in for a test run, which starts the server naming itself as the parent and then dies without cleaning up
    const mother = spawn(
      process.execPath,
      ["-e", `const { spawn } = require("node:child_process"); const c = spawn(process.execPath, [${JSON.stringify(SERVER)}, ${JSON.stringify(dir)}, "${port}", "${"p".repeat(24)}", String(process.pid)], { stdio: "ignore" }); console.log("CHILD " + c.pid); setTimeout(() => process.exit(0), 1500);`],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    let out = "";
    mother.stdout.on("data", (d) => (out += d));
    for (let i = 0; i < 100 && !/CHILD \d+/.test(out); i++) await sleep(50);
    const pid = Number(/CHILD (\d+)/.exec(out)![1]);
    try {
      expect(pid).toBeGreaterThan(0);
      await sleep(500);
      expect(alive(pid), "the server runs while its parent does").toBe(true);
      for (let i = 0; i < 80 && alive(pid); i++) await sleep(250); // the parent exits at 1.5 s; the server checks every 1.5 s
      expect(alive(pid), "the server outlived the run that started it").toBe(false);
    } finally {
      if (alive(pid)) killTree(pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
