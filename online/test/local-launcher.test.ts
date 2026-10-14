import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { createServer } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";
import { killTree } from "../../.claude/skills/wentz-verify/run-checks.mjs";
import { DEFAULT_PORT, isConnectionVariable, redact, resolveLauncherConfig, validateLeagueApi, type LauncherConfig } from "../dev/launcher-safety.ts";
import { freePort, LauncherError, portInUse, startLocalServer, type RunningServer } from "../dev/local-launcher.ts";

/**
 * The local league server launcher must never start the real server against a database the developer did not
 * choose. A production-style Neon URL is used throughout, on a host that cannot resolve (`.invalid`, reserved by
 * RFC 2606), so a test that fails could not touch a real database either.
 */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const PROD = "postgres://app_user:hunter2-prod-pw@ep-cool-name-123.eu-central-1.aws.neon.tech.production.invalid/neondb?sslmode=require";
const PROD_PASSWORD = "hunter2-prod-pw";

const base = baseEnvironment(process.env);
const config = (args: string[] = [], env: NodeJS.ProcessEnv = base): LauncherConfig => {
  const r = resolveLauncherConfig(args, env);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.config;
};
const problems = (args: string[], env: NodeJS.ProcessEnv): string => {
  const r = resolveLauncherConfig(args, env);
  expect(r.ok, JSON.stringify(args)).toBe(false);
  return r.ok ? "" : r.problems.join("\n");
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("choosing the database", () => {
  it("defaults to the documented local database, set explicitly with one connection", () => {
    const c = config();
    expect(c.databaseUrl).toBe("postgres://postgres@localhost:5433/postgres");
    expect(c.port).toBe(DEFAULT_PORT);
    expect(c.env.DATABASE_URL).toBe(c.databaseUrl);
    expect(c.env.DB_POOL_MAX).toBe("1");
  });

  it("takes an explicit choice from the command line or the selection variable, and the command line wins", () => {
    expect(config(["--test-database", "postgres://postgres@127.0.0.1:6001/wentz_test"]).databaseUrl).toBe("postgres://postgres@127.0.0.1:6001/wentz_test");
    expect(config([], { ...base, LOCAL_SERVER_TEST_DATABASE: "postgres://postgres@127.0.0.1:6002/wentz_test" }).databaseUrl).toBe("postgres://postgres@127.0.0.1:6002/wentz_test");
    expect(config(["--test-database", "local-pglite"], { ...base, LOCAL_SERVER_TEST_DATABASE: "postgres://postgres@127.0.0.1:6002/wentz_test" }).databaseUrl).toBe("postgres://postgres@localhost:5433/postgres");
  });

  it("refuses an inherited production-style URL, in every variable that can steer the connection", () => {
    for (const name of ["DATABASE_URL", "TEST_DATABASE_URL", "DATABASE_URL_UNPOOLED", "DIRECT_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "PGHOST", "PGDATABASE", "PGPASSWORD", "RENDER_DATABASE_DSN", "MY_DB_URL"]) {
      const text = problems([], { ...base, [name]: name === "PGPASSWORD" ? PROD_PASSWORD : PROD });
      expect(text, name).toContain(name);
      expect(text, name).toMatch(/not used and is refused/);
      // the message names the variable, never what is in it
      expect(text, name).not.toContain(PROD_PASSWORD);
      expect(text, name).not.toContain("neon.tech");
    }
  });

  it("refuses an inherited URL even when it points at a local test database, because it is an override", () => {
    expect(problems([], { ...base, DATABASE_URL: "postgres://postgres@127.0.0.1:6001/wentz_test" })).toContain("DATABASE_URL");
    expect(problems(["--test-database", "postgres://postgres@127.0.0.1:6001/wentz_test"], { ...base, DATABASE_URL: "postgres://postgres@127.0.0.1:6009/wentz_test" })).toContain("DATABASE_URL");
  });

  it("accepts an inherited URL that is exactly the chosen one, and ignores empty ones", () => {
    expect(config([], { ...base, DATABASE_URL: "postgres://postgres@localhost:5433/postgres" }).databaseUrl).toBe("postgres://postgres@localhost:5433/postgres");
    expect(config([], { ...base, DATABASE_URL: "", PGHOST: "" }).databaseUrl).toBe("postgres://postgres@localhost:5433/postgres");
  });

  it("refuses a chosen database that is remote, hosted, not clearly a test database, or tries to redirect", () => {
    for (const chosen of [PROD, "postgres://app:pw@ep-cool.neon.tech:5433/test", "postgres://u@localhost.evil.com:5433/postgres", "postgres://u@10.0.0.5:5433/postgres", "postgres://u@localhost:5433/postgres?host=prod.example.com", "postgres://u@localhost:5432/postgres", "postgres://u@localhost:5433/production", "mysql://u@localhost:5433/test", "not a url", ""]) {
      const text = problems(["--test-database", chosen], base);
      expect(text, chosen).toMatch(/database:/);
      expect(text, chosen).not.toContain(PROD_PASSWORD);
    }
  });

  it("does not treat a hosted service's API key as a connection setting, but still keeps it out of the server", () => {
    const c = config([], { ...base, NEON_API_KEY: "napi_secret", SUPABASE_URL: "https://x.supabase.co" });
    expect(Object.keys(c.env).some((k) => /NEON|SUPABASE/i.test(k))).toBe(false);
    expect(isConnectionVariable("NEON_API_KEY")).toBe(false);
    for (const name of ["DATABASE_URL", "pgpassword", "POSTGRES_HOST", "DIRECT_URL", "X_DSN"]) expect(isConnectionVariable(name), name).toBe(true);
  });
});

describe("the server's environment", () => {
  it("is built from an allowlist: nothing else from the launcher's environment gets through", () => {
    const parent = { ...base, SESSION_SECRET: "s3cret", NODE_OPTIONS: "--require evil.js", RENDER_GIT_COMMIT: "abc", API_TOKEN: "t", NEON_API_KEY: "n", PGSSLMODE: "" };
    const { env } = config([], parent);
    for (const name of ["SESSION_SECRET", "NODE_OPTIONS", "RENDER_GIT_COMMIT", "API_TOKEN", "NEON_API_KEY"]) expect(env, name).not.toHaveProperty(name);
    expect(Object.keys(env).sort()).toEqual([...new Set([...Object.keys(baseEnvironment(parent)), "DATABASE_URL", "DB_POOL_MAX", "PORT", "CLIENT_ORIGIN", "WENTZ_LOOPBACK_ONLY"])].sort());
  });

  it("sets the pool limit itself whatever the shell says", () => {
    expect(config([], { ...base, DB_POOL_MAX: "50" }).env.DB_POOL_MAX).toBe("1");
  });
});

describe("ports and origins", () => {
  it("refuses a bad port and any CLIENT_ORIGIN that is not this machine", () => {
    for (const port of ["80", "70000", "abc", "8788; rm x", "-1"]) expect(problems(["--port", port], base), port).toMatch(/port/i);
    for (const origin of ["https://wentz-2-sb-2.onrender.com", "http://localhost.evil.com:5173", "http://user:pw@localhost:5173", "http://localhost:5173/app", "http://localhost", "ftp://localhost:5173"]) {
      expect(problems(["--client-origin", origin], base), origin).toMatch(/CLIENT_ORIGIN/);
    }
    expect(config(["--client-origin", "http://127.0.0.1:5173"]).clientOrigin).toBe("http://127.0.0.1:5173");
  });
});

describe("the address the HTTP harness may use (LEAGUE_API)", () => {
  it("defaults to the local server and accepts loopback origins", () => {
    expect(validateLeagueApi(undefined)).toEqual({ ok: true, api: "http://localhost:8788" });
    for (const ok of ["http://localhost:8788", "http://127.0.0.1:8790", "http://[::1]:8788", "http://LOCALHOST:8788/"]) expect(validateLeagueApi(ok).ok, ok).toBe(true);
  });

  it("refuses a deployed or any non-local server, and anything carrying more than an origin", () => {
    for (const bad of ["https://wentz-2-sb-2.onrender.com", "https://wentz-2-sb-api.onrender.com:443", "http://localhost.evil.com:8788", "http://192.168.1.20:8788", "http://0.0.0.0:8788", "http://user:pw@localhost:8788", "http://localhost:8788/auth", "http://localhost:8788?x=1", "http://localhost", "http://localhost:80", "javascript:alert(1)", "localhost:8788", ""]) {
      const r = validateLeagueApi(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("stops the real harness before it makes a request", () => {
    const r = spawnSync(process.execPath, [TSX, "--tsconfig", join(ROOT, "online/tsconfig.json"), join(ROOT, "online/dev/e2e-http.ts")], {
      cwd: ROOT,
      env: { ...base, LEAGUE_API: "https://wentz-2-sb-2.onrender.com" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refusing to run: LEAGUE_API points at "wentz-2-sb-2.onrender.com"/);
    expect(r.stdout).not.toMatch(/register|league created/i);
  });
});

describe("redaction", () => {
  it("removes the database URL and its password from a line of output", () => {
    expect(redact(`connect failed for ${PROD}`, PROD)).toBe("connect failed for <test database>");
    expect(redact(`password ${PROD_PASSWORD} rejected`, PROD)).toBe("password <password> rejected");
  });
});

describe("an inherited production URL cannot reach database initialization", { timeout: 240_000 }, () => {
  const run = (cmd: string[], env: Record<string, string>, ms: number) => {
    const child = spawn(process.execPath, cmd, { cwd: ROOT, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const done = new Promise<number | null>((r) => child.once("close", r));
    return { child, output: () => out, done, kill: async () => { killTree(child.pid); await Promise.race([done, sleep(10_000)]); }, ms };
  };

  it("control: started the old way, the server does take the exported URL and reach for the database", async () => {
    const port = await freePort();
    // the old launcher imported the server in-process with the shell's environment: this is that, minus the import
    const old = run([TSX, "--tsconfig", join(ROOT, "online/tsconfig.json"), join(ROOT, "online/src/index.ts")], { ...base, DATABASE_URL: PROD, PORT: String(port) }, 0);
    try {
      const deadline = Date.now() + 90_000;
      while (!/could not reach the database/.test(old.output()) && Date.now() < deadline) await sleep(300);
      expect(old.output()).toMatch(/could not reach the database/); // database initialization was attempted with the inherited URL
    } finally {
      await old.kill();
    }
  });

  it("the launcher refuses before anything is started, names the variable, and prints no secret", async () => {
    const port = await freePort();
    const launcher = run([TSX, "--tsconfig", join(ROOT, "online/tsconfig.json"), join(ROOT, "online/dev/local-server.ts")], { ...base, DATABASE_URL: PROD, TEST_DATABASE_URL: PROD, PGPASSWORD: PROD_PASSWORD, PORT: String(port) }, 0);
    const code = await Promise.race([launcher.done, sleep(60_000).then(() => "timeout" as const)]);
    if (code === "timeout") await launcher.kill();
    expect(code).toBe(2);
    const out = launcher.output();
    expect(out).toMatch(/refused: the environment sets DATABASE_URL, PGPASSWORD, TEST_DATABASE_URL/);
    expect(out).toContain("nothing was started");
    for (const leak of [PROD_PASSWORD, "neon.tech", "ep-cool-name", "production.invalid"]) expect(out, leak).not.toContain(leak);
    // the server was never loaded: none of its log lines, and nothing listening on the port it would have used
    expect(out).not.toMatch(/online league server on|schema ready|could not reach the database/);
    expect(await portInUse(port)).toBe(false);
  });

  it("an exported URL cannot get through the programmatic path either", () => {
    const r = resolveLauncherConfig([], { ...base, DATABASE_URL: PROD });
    expect(r.ok).toBe(false);
  });
});

describe("starting, and refusing to start", { timeout: 120_000 }, () => {
  const started: RunningServer[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    while (started.length) await started.pop()!.stop();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const stub = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-stub-"));
    dirs.push(dir);
    const file = join(dir, "entry.mjs");
    writeFileSync(file, body);
    return file;
  };
  const cfg = async (): Promise<LauncherConfig> => config(["--port", String(await freePort())]);

  it("refuses a port something else is using, never reuses it, and leaves it alone", async () => {
    const port = await freePort();
    // an unknown service that even answers like the league server
    const occupant = createServer((_req, res) => res.end(JSON.stringify({ service: "online-api" })));
    await new Promise<void>((r) => occupant.listen(port, "127.0.0.1", r));
    try {
      await expect(startLocalServer({ config: config(["--port", String(port)]), entry: stub("throw new Error('must never run')"), timeoutMs: 10_000 })).rejects.toThrow(/already in use by something else/);
      expect(await portInUse(port)).toBe(true); // still the occupant's
    } finally {
      await new Promise((r) => occupant.close(r));
    }
  });

  it("ends a server that never becomes ready, and everything it started, and says why", async () => {
    const pidFile = join(tmpdir(), `wentz-grandchild-${process.pid}-${Date.now()}.txt`);
    const entry = stub(`
      import http from "node:http"; import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs";
      const kid = spawn(process.execPath, ["-e", "setInterval(function(){},1000)"], { stdio: "ignore" });
      writeFileSync(${JSON.stringify(pidFile)}, String(kid.pid));
      http.createServer().listen(Number(process.env.PORT)); // listening, but "schema ready" never comes
      setInterval(function () {}, 1000);
    `);
    const t0 = Date.now();
    const err = await startLocalServer({ config: await cfg(), entry, timeoutMs: 8_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LauncherError);
    expect((err as Error).message).toMatch(/not ready after 8 s \(listening, but the schema was not applied\); its process tree was ended/);
    expect(Date.now() - t0).toBeLessThan(60_000);
    const { readFileSync } = await import("node:fs");
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    await sleep(1_500);
    expect(alive(grandchild), "the server's own child process is still running").toBe(false);
    rmSync(pidFile, { force: true });
  });

  it("reports a server that exits early, with what it printed, and leaves nothing running", async () => {
    const err = await startLocalServer({ config: await cfg(), entry: stub(`console.log("boom: cannot start"); process.exit(3);`), timeoutMs: 30_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LauncherError);
    expect((err as Error).message).toMatch(/exited \(code 3\) before it was ready/);
    expect((err as LauncherError).tail.join("\n")).toContain("boom: cannot start");
  });

  it("does not accept a port answered by something that is not the league server", async () => {
    const entry = stub(`
      import http from "node:http";
      http.createServer((req, res) => res.end(JSON.stringify({ service: "something-else" }))).listen(Number(process.env.PORT), () => console.log("schema ready"));
    `);
    const err = await startLocalServer({ config: await cfg(), entry, timeoutMs: 30_000 }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/not as the league server/);
  });

  it("redacts the database URL from what the server prints", async () => {
    const c = await cfg();
    const lines: string[] = [];
    const entry = stub(`
      import http from "node:http";
      console.log("connecting to " + process.env.DATABASE_URL);
      http.createServer((req, res) => res.end(JSON.stringify({ service: "online-api" }))).listen(Number(process.env.PORT), () => console.log("schema ready"));
    `);
    const s = await startLocalServer({ config: c, entry, timeoutMs: 30_000, onLog: (l) => lines.push(l) });
    started.push(s);
    expect(lines.join("\n")).toContain("connecting to <test database>");
    expect(lines.join("\n")).not.toContain(c.databaseUrl);
  });

  it("gives the server only the validated environment: none of the launcher's secrets", async () => {
    process.env.WENTZ_TEST_SECRET = "launcher-only-secret";
    const c = await cfg();
    const entry = stub(`
      import http from "node:http";
      const names = Object.keys(process.env).filter((k) => /SECRET|DATABASE|PG|NODE_OPTIONS|NEON/i.test(k)).sort();
      console.log("ENV " + JSON.stringify(names));
      http.createServer((req, res) => res.end(JSON.stringify({ service: "online-api" }))).listen(Number(process.env.PORT), () => console.log("schema ready"));
    `);
    try {
      const lines: string[] = [];
      const s = await startLocalServer({ config: c, entry, timeoutMs: 30_000, onLog: (l) => lines.push(l) });
      started.push(s);
      expect(lines.find((l) => l.startsWith("ENV "))).toBe('ENV ["DATABASE_URL"]');
    } finally {
      delete process.env.WENTZ_TEST_SECRET;
    }
  });
});

describe("loopback only", { timeout: 60_000 }, () => {
  const lanAddress = (): string | undefined =>
    Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

  const listenWith = (call: string) => {
    const script = `
      const http = require("node:http");
      const s = http.createServer();
      ${call}
      s.on("listening", () => { const a = s.address(); process.stdout.write("BOUND " + a.address + "\\n"); setTimeout(() => process.exit(0), 100); });
    `;
    const r = spawnSync(process.execPath, ["--import", new URL("../dev/loopback-only.mjs", import.meta.url).href, "-e", script], { encoding: "utf8", timeout: 30_000 });
    return `${r.stdout}${r.stderr}`;
  };

  it("pins every form of listen to 127.0.0.1, including an explicit request for all interfaces", () => {
    for (const call of ["s.listen(0);", 's.listen(0, "0.0.0.0");', 's.listen(0, "::");', "s.listen({ port: 0 });", 's.listen({ port: 0, host: "0.0.0.0" });', "s.listen(0, () => {});", 's.listen(0, "0.0.0.0", 511, () => {});']) {
      const out = listenWith(call);
      expect(out, call).toContain("BOUND 127.0.0.1");
      expect(out, call).toContain("WENTZ_LISTENING 127.0.0.1:");
    }
  });

  it("is not reachable from another interface on this machine (when it has one)", async () => {
    const lan = lanAddress();
    if (!lan) return; // no network interface to try
    const c = await (async () => config(["--port", String(await freePort())]))();
    const dir = mkdtempSync(join(tmpdir(), "wentz-lan-"));
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `import http from "node:http"; http.createServer((q, r) => r.end(JSON.stringify({ service: "online-api" }))).listen(Number(process.env.PORT), () => console.log("schema ready"));`);
    const s = await startLocalServer({ config: c, entry, timeoutMs: 30_000 });
    try {
      expect(await new Promise<boolean>((resolve) => {
        const sock = net.connect({ host: lan, port: c.port });
        sock.setTimeout(1500, () => { sock.destroy(); resolve(false); });
        sock.once("connect", () => { sock.destroy(); resolve(true); });
        sock.once("error", () => resolve(false));
      })).toBe(false);
      expect(await portInUse(c.port)).toBe(true); // while the loopback one is
    } finally {
      await s.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the real server, against a real local database", { timeout: 240_000 }, () => {
  it("is ready only after the schema is applied, answers at once, and leaves nothing running when stopped", async () => {
    const dbPort = await freePort();
    const dbEnv = { ...base, LOCAL_DB_PORT: String(dbPort) };
    const db = spawn(process.execPath, [TSX, "--tsconfig", join(ROOT, "online/tsconfig.json"), join(ROOT, "online/dev/local-db.ts")], { cwd: ROOT, env: dbEnv, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let dbOut = "";
    db.stdout.on("data", (d) => (dbOut += d));
    db.stderr.on("data", (d) => (dbOut += d));
    let server: RunningServer | undefined;
    try {
      const t0 = Date.now();
      while (!/local Postgres \(PGlite\)/.test(dbOut) && Date.now() - t0 < 60_000) await sleep(200);
      expect(dbOut).toMatch(/local Postgres \(PGlite\)/);

      const url = `postgres://postgres@127.0.0.1:${dbPort}/wentz_test`;
      // a production-style URL exported at the same time is refused; the explicit choice is what the server gets
      expect(resolveLauncherConfig(["--test-database", url], { ...base, DATABASE_URL: PROD }).ok).toBe(false);
      const c = config(["--test-database", url, "--port", String(await freePort())]);
      const t1 = Date.now();
      server = await startLocalServer({ config: c });
      const startupMs = Date.now() - t1;

      // ready means migrated: the very first request that needs the schema works
      const reg = await fetch(`${server.url}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: c.clientOrigin },
        body: JSON.stringify({ name: `launcher-test-${Date.now()}`, password: "a-long-test-password-1" }),
      });
      expect(reg.status, await reg.clone().text()).toBeLessThan(300);
      expect(server.tail().join("\n")).toMatch(/schema ready/);
      expect(server.tail().join("\n")).not.toContain(url);
      console.log(`launcher: ready ${startupMs} ms after start (database already running)`);

      const pid = server.pid;
      await server.stop();
      expect(await portInUse(c.port)).toBe(false);
      expect(alive(pid)).toBe(false);
      server = undefined;
    } finally {
      if (server) await server.stop();
      killTree(db.pid);
      await sleep(500);
    }
  });
});
