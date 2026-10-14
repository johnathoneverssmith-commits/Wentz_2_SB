import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { buildFixtures } from "../support/fixtures-build.ts";
import { buildUi, startUi, type StartOptions } from "../support/stack.ts";

/**
 * Nothing this run starts may outlive a failure of the run. Each way startup can fail is made to happen on
 * purpose and followed by the same check: the server process (and anything it started) is gone and no temporary
 * directory is left. A leak is a real cost: an orphaned server holds a port, and the directories pile up in the
 * system temp folder.
 */
test.describe.configure({ mode: "serial" });

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const leftovers = (): string[] => readdirSync(tmpdir()).filter((n) => n.startsWith("wentz-e2e-")).sort();

/** Records what a start creates and, afterwards, proves none of it remains. */
function watch() {
  const before = new Set(leftovers());
  const dirs: string[] = [];
  const pids: number[] = [];
  const extraPids: number[] = [];
  return {
    onResource: (r: { kind: "directory"; path: string } | { kind: "process"; pid: number }) => (r.kind === "directory" ? dirs.push(r.path) : pids.push(r.pid)),
    /** A pid written by a stub for a process the stub itself started. */
    grandchild: (file: string) => {
      if (existsSync(file)) extraPids.push(Number(readFileSync(file, "utf8")));
    },
    async expectNothingLeft() {
      await sleep(800); // a killed tree needs a moment to be gone
      for (const d of dirs) expect(existsSync(d), `directory ${d} is still there`).toBe(false);
      for (const p of [...pids, ...extraPids]) expect(alive(p), `process ${p} is still running`).toBe(false);
      expect(leftovers().filter((n) => !before.has(n)), "new temporary directories").toEqual([]);
    },
  };
}

const scratch: string[] = [];
test.afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
function stub(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "wentz-stub-"));
  scratch.push(dir);
  const file = join(dir, name);
  writeFileSync(file, body);
  return file;
}
/** A script that starts a child of its own (recording its pid) and then waits: a tree that a plain kill leaves half alive. */
const withGrandchild = (pidFile: string, rest: string): string => `
  import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
  const kid = spawn(process.execPath, ["-e", "setInterval(function(){},1000)"], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(pidFile)}, String(kid.pid));
  ${rest}
`;
/** A build that is instant: a directory with a page in it, as the real build would leave. */
const quickBuild: NonNullable<StartOptions["build"]> = async () => {
  const dir = mkdtempSync(join(tmpdir(), "wentz-e2e-ui-"));
  writeFileSync(join(dir, "index.html"), "<h1>stub</h1>");
  return { dir, ms: 1 };
};

test.describe("starting the UI server", () => {
  test("a good start and stop leaves nothing behind, and stop can be called again", async () => {
    const w = watch();
    const ui = await startUi({ build: quickBuild, onResource: w.onResource });
    expect(alive(ui.pid)).toBe(true);
    expect((await fetch(`${ui.origin}/`)).status).toBe(200);
    await ui.stop();
    await ui.stop(); // the teardown after a failed test may run stop a second time
    await w.expectNothingLeft();
  });

  test("the real build, then stop, leaves nothing behind either", async () => {
    test.setTimeout(120_000);
    const w = watch();
    const ui = await startUi({ onResource: w.onResource });
    expect((await fetch(`${ui.origin}/`)).headers.get("x-e2e-token")).toBeTruthy();
    await ui.stop();
    await w.expectNothingLeft();
  });

  test("an identity request that is refused: the server is stopped and the directory removed", async () => {
    const w = watch();
    await expect(
      startUi({ build: quickBuild, onResource: w.onResource, identityFetch: () => Promise.reject(new TypeError("fetch failed")) }),
    ).rejects.toThrow(/fetch failed/);
    await w.expectNothingLeft();
  });

  test("an identity request that times out, even if the fetch ignores its abort signal", async () => {
    const w = watch();
    const t0 = Date.now();
    await expect(
      startUi({ build: quickBuild, onResource: w.onResource, identityTimeoutMs: 700, identityFetch: () => new Promise<Response>(() => {}) }),
    ).rejects.toThrow(/identity request to the UI server timed out after 700 ms/);
    expect(Date.now() - t0).toBeLessThan(10_000);
    await w.expectNothingLeft();
  });

  test("a port answered by something that is not this run's server", async () => {
    const w = watch();
    await expect(
      startUi({ build: quickBuild, onResource: w.onResource, identityFetch: async () => new Response("x", { headers: { "x-e2e-token": "someone-else" } }) }),
    ).rejects.toThrow(/answered by something other than this run's UI server/);
    await w.expectNothingLeft();
  });

  test("the server cannot be spawned: the error is reported (not thrown at the process) and the directory removed", async () => {
    const w = watch();
    await expect(startUi({ build: quickBuild, onResource: w.onResource, nodePath: join(tmpdir(), "no-such-program-for-e2e") })).rejects.toThrow(/could not be started/);
    await w.expectNothingLeft();
  });

  test("the server exits before it is ready, and what it printed is in the error", async () => {
    const w = watch();
    const script = stub("exit-early.mjs", `console.log("static server: cannot bind"); process.exit(3);`);
    await expect(startUi({ build: quickBuild, onResource: w.onResource, serverScript: script })).rejects.toThrow(/exited before it was ready \(code 3\): static server: cannot bind/);
    await w.expectNothingLeft();
  });

  test("the server says it is ready and then dies before the identity request", async () => {
    const w = watch();
    const script = stub("ready-then-die.mjs", `console.log("READY " + process.argv[4]); setTimeout(() => process.exit(0), 5);`);
    await expect(startUi({ build: quickBuild, onResource: w.onResource, serverScript: script })).rejects.toThrow();
    await w.expectNothingLeft();
  });

  test("the server never becomes ready: it is ended with everything it started", async () => {
    const w = watch();
    const pidFile = join(tmpdir(), `wentz-stubpid-${process.pid}-${Date.now()}.txt`);
    const script = stub("silent.mjs", withGrandchild(pidFile, `setInterval(function(){}, 1000);`));
    const t0 = Date.now();
    try {
      await expect(startUi({ build: quickBuild, onResource: w.onResource, serverScript: script, readyTimeoutMs: 2500 })).rejects.toThrow(/was not ready after 2500 ms/);
      expect(Date.now() - t0).toBeLessThan(20_000);
      w.grandchild(pidFile);
      await w.expectNothingLeft();
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  test("a build that fails or hangs leaves no directory and no process", async () => {
    test.setTimeout(60_000);
    const failing = stub("vite-fails.mjs", `console.error("vite: boom"); process.exit(1);`);
    const before = new Set(leftovers());
    await expect(buildUi({ viteScript: failing })).rejects.toThrow(/building the UI failed \(exit 1\)[\s\S]*vite: boom/);
    expect(leftovers().filter((n) => !before.has(n))).toEqual([]);

    const pidFile = join(tmpdir(), `wentz-stubpid-${process.pid}-${Date.now()}.txt`);
    const hanging = stub("vite-hangs.mjs", withGrandchild(pidFile, `setInterval(function(){}, 1000);`));
    try {
      await expect(buildUi({ viteScript: hanging, timeoutMs: 2500 })).rejects.toThrow(/timed out after 2500 ms; its process tree was ended/);
      expect(leftovers().filter((n) => !before.has(n))).toEqual([]);
      const kid = Number(readFileSync(pidFile, "utf8"));
      await sleep(800);
      expect(alive(kid), "the build's child process is still running").toBe(false);
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  test("a build that fails inside startUi leaves nothing for the caller to clean up", async () => {
    const w = watch();
    const failing = stub("vite-fails2.mjs", `process.exit(1);`);
    await expect(startUi({ build: () => buildUi({ viteScript: failing }), onResource: w.onResource })).rejects.toThrow(/building the UI failed/);
    await w.expectNothingLeft();
  });
});

test.describe("building the fixtures", () => {
  test("a builder that fails leaves no directory", async () => {
    test.setTimeout(60_000);
    const before = new Set(leftovers());
    const failing = stub("builder-fails.mjs", `console.error("builder: no league"); process.exit(2);`);
    await expect(buildFixtures({ script: failing })).rejects.toThrow(/building the fixtures failed \(exit 2\)[\s\S]*builder: no league/);
    expect(leftovers().filter((n) => !before.has(n))).toEqual([]);
  });

  test("a builder that hangs is stopped with its children and leaves no directory", async () => {
    test.setTimeout(60_000);
    const before = new Set(leftovers());
    const pidFile = join(tmpdir(), `wentz-stubpid-${process.pid}-${Date.now()}.txt`);
    const hanging = stub("builder-hangs.mjs", withGrandchild(pidFile, `setInterval(function(){}, 1000);`));
    try {
      await expect(buildFixtures({ script: hanging, timeoutMs: 3000 })).rejects.toThrow(/timed out after 3000 ms; its process tree was ended/);
      expect(leftovers().filter((n) => !before.has(n))).toEqual([]);
      const kid = Number(readFileSync(pidFile, "utf8"));
      await sleep(800);
      expect(alive(kid), "the builder's child process is still running").toBe(false);
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  test("a successful build leaves exactly the directory it returns, which the caller removes", async () => {
    test.setTimeout(120_000);
    const before = new Set(leftovers());
    const fx = await buildFixtures();
    try {
      expect(leftovers().filter((n) => !before.has(n))).toEqual([fx.dir.split(/[\\/]/).pop()]);
      expect(existsSync(join(fx.dir, "preseason.json"))).toBe(true);
    } finally {
      rmSync(fx.dir, { recursive: true, force: true });
    }
    expect(leftovers().filter((n) => !before.has(n))).toEqual([]);
  });
});

