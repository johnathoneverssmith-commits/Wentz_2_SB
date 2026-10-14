import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { baseEnvironment } from "../../.claude/skills/wentz-verify/db-safety.mjs";
import { killTree } from "../../.claude/skills/wentz-verify/run-checks.mjs";
import { harnessFetch, RedirectRefused } from "../dev/harness-fetch.ts";

/**
 * The HTTP harness only ever talks to the loopback address it was given. A server at that address that answers
 * with a redirect must not be able to move its traffic elsewhere: not the request, not its body (a password, on
 * a 307 or 308), and not the session cookie. Every redirect status is tried, on registration, login and an
 * ordinary API call, against the real harness and not only the wrapper it uses.
 */
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TSX = createRequire(import.meta.url).resolve("tsx/cli");
const STATUSES = [301, 302, 303, 307, 308] as const;
const SECRET_COOKIE = "sid=session-cookie-must-not-travel";

interface Seen {
  method: string;
  url: string;
  cookie: string | undefined;
  body: string;
}
const listen = (server: Server): Promise<number> => new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
const bodyOf = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => resolve(b));
  });

const open: Server[] = [];
afterEach(async () => {
  while (open.length) await new Promise((r) => open.pop()!.close(r));
});

/** A second local server that records everything it is sent: where a followed redirect would arrive. */
async function decoy(): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", cookie: req.headers.cookie, body: await bodyOf(req) });
    res.statusCode = 200;
    res.end("{}");
  });
  open.push(server);
  return { origin: `http://127.0.0.1:${await listen(server)}`, seen };
}

/** The server the harness is pointed at: it answers `ok` for the paths in `allow` and redirects everything else. */
async function redirector(status: number, target: string, allow: string[] = []): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", cookie: req.headers.cookie, body: await bodyOf(req) });
    if (allow.includes(req.url ?? "")) {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": `${SECRET_COOKIE}; Path=/` });
      res.end("{}");
      return;
    }
    res.writeHead(status, { location: `${target}${req.url}?token=in-the-query` });
    res.end();
  });
  open.push(server);
  return { origin: `http://127.0.0.1:${await listen(server)}`, seen };
}

describe("the wrapper", () => {
  it("control: a plain fetch follows the redirect and delivers the body and the cookie to another address", async () => {
    const d = await decoy();
    for (const status of [307, 308]) {
      const r = await redirector(status, d.origin);
      const res = await fetch(`${r.origin}/auth/register`, { method: "POST", headers: { cookie: SECRET_COOKIE, "content-type": "application/json" }, body: JSON.stringify({ password: "hunter2" }) });
      await res.text();
    }
    // this is what the harness did before: a 307 or 308 re-sends the body to wherever it is sent
    expect(d.seen.map((s) => s.body)).toEqual([JSON.stringify({ password: "hunter2" }), JSON.stringify({ password: "hunter2" })]);
  });

  it.each(STATUSES)("refuses a %i redirect and sends nothing on", async (status) => {
    const d = await decoy();
    const r = await redirector(status, d.origin);
    const err = await harnessFetch(`${r.origin}/auth/register`, { method: "POST", headers: { cookie: SECRET_COOKIE }, body: JSON.stringify({ password: "hunter2" }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedirectRefused);
    expect((err as RedirectRefused).status).toBe(status);
    expect(d.seen).toEqual([]);
    expect(r.seen).toHaveLength(1); // the one request to the validated address, and no second
  });

  it("refuses any 3xx, with or without a Location, and does not print the redirect's path or query", async () => {
    const d = await decoy();
    for (const status of [300, 304, 305, 306]) {
      const server = createServer((_req, res) => res.writeHead(status).end());
      open.push(server);
      const port = await listen(server);
      await expect(harnessFetch(`http://127.0.0.1:${port}/x`)).rejects.toThrow(/no Location header/);
    }
    const r = await redirector(302, d.origin);
    const err = (await harnessFetch(`${r.origin}/auth/login`, { method: "POST" }).catch((e: unknown) => e)) as RedirectRefused;
    expect(err.message).toContain(d.origin);
    expect(err.message).not.toContain("in-the-query");
    expect(err.message).not.toContain("/auth/login?");
  });

  it("passes an ordinary answer straight through, including errors and cookies", async () => {
    const server = createServer((_req, res) => res.writeHead(404, { "set-cookie": "a=b" }).end("nope"));
    open.push(server);
    const res = await harnessFetch(`http://127.0.0.1:${await listen(server)}/x`);
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBe("a=b");
    expect(await res.text()).toBe("nope");
  });
});

describe("the real harness (online/dev/e2e-http.ts)", { timeout: 180_000 }, () => {
  const run = (args: string[], api: string): Promise<{ code: number | null; out: string }> =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [TSX, "--tsconfig", join(ROOT, "online/tsconfig.json"), join(ROOT, "online/dev/e2e-http.ts"), ...args], {
        cwd: ROOT,
        env: { ...baseEnvironment(process.env), LEAGUE_API: api },
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      const timer = setTimeout(() => killTree(child.pid), 90_000);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });

  it.each(STATUSES)("stops at a %i redirect on registration, and nothing reaches the other address", async (status) => {
    const d = await decoy();
    const r = await redirector(status, d.origin);
    const { code, out } = await run([], r.origin);
    expect(code).toBe(2);
    expect(out).toMatch(new RegExp(`refusing to continue: refused a ${status} redirect from POST /auth/register to ${d.origin.replace(/\./g, "\\.")}`));
    expect(out).not.toContain("in-the-query");
    expect(r.seen.map((s) => `${s.method} ${s.url}`)).toEqual(["POST /auth/register"]);
    expect(d.seen, "a redirected request arrived at the other address").toEqual([]);
  });

  it.each([302, 307])("stops at a %i redirect on login (--resume)", async (status) => {
    const d = await decoy();
    const r = await redirector(status, d.origin);
    const { code, out } = await run(["--resume", "00000000-0000-0000-0000-000000000000", "--users", "someone"], r.origin);
    expect(code).toBe(2);
    expect(out).toMatch(new RegExp(`refused a ${status} redirect from POST /auth/login`));
    expect(r.seen.map((s) => `${s.method} ${s.url}`)).toEqual(["POST /auth/login"]);
    expect(d.seen).toEqual([]);
  });

  it.each([301, 303, 307, 308])("stops at a %i redirect on an ordinary API call after signing in, and the session cookie never leaves", async (status) => {
    const d = await decoy();
    const r = await redirector(status, d.origin, ["/auth/register"]); // registration succeeds and sets a cookie; the next call is redirected
    const { code, out } = await run([], r.origin);
    expect(code).toBe(2);
    expect(out).toMatch(new RegExp(`refused a ${status} redirect from POST /leagues`));
    // the cookie was sent to the validated address on the request that was redirected, and went no further
    const redirected = r.seen.find((s) => s.url === "/leagues");
    expect(redirected?.cookie).toBe(SECRET_COOKIE);
    expect(r.seen).toHaveLength(3); // two registrations, then the redirected call
    expect(d.seen, "the cookie or the league's data arrived at the other address").toEqual([]);
  });

  it("still runs against a server that does not redirect: it registers and goes on to create a league", async () => {
    const d = await decoy();
    // answers the first two calls itself; the third is redirected, which is when the run stops
    const r = await redirector(302, d.origin, ["/auth/register", "/auth/register", "/leagues"]);
    const { out } = await run([], r.origin);
    const sequence = r.seen.map((s) => `${s.method} ${s.url}`);
    expect(sequence.slice(0, 3)).toEqual(["POST /auth/register", "POST /auth/register", "POST /leagues"]);
    expect(out).not.toMatch(/from POST \/auth\/register/); // registration and league creation were not refused
    expect(d.seen).toEqual([]);
  });
});
