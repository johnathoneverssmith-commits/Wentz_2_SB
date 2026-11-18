import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Issue #74 Phase 4b: the league web service serves the browser simulation engine beside the page. Only the
 * exact content-hashed names and the manifest are served, hashed files are cached for good, the manifest never.
 */
let dir = "";
let server: Server;
let base = "";
const HASH = "0123456789ab";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sim-engine-http-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>x</title>");
  mkdirSync(join(dir, "sim-engine"));
  writeFileSync(join(dir, "sim-engine", "manifest.json"), '{"format":1}');
  writeFileSync(join(dir, "sim-engine", `sim-worker.${HASH}.js`), "self.onmessage=()=>{};");
  writeFileSync(join(dir, "sim-engine", `pool.${HASH}.json`), JSON.stringify([{ id: "a" }]));
  writeFileSync(join(dir, "secret.txt"), "not for the web");
  writeFileSync(join(dir, "sim-engine", "unlisted.js"), "nope");

  vi.resetModules();
  process.env.SERVE_UI = join(dir, "index.html");
  const { handle } = await import("../src/http.js");
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SERVE_UI;
});

describe("the browser simulation engine, served beside the page", () => {
  it("serves the manifest uncached and a hashed file cached for good, with the right types", async () => {
    const m = await fetch(`${base}/sim-engine/manifest.json`);
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(m.headers.get("cache-control")).toBe("no-cache");
    expect(await m.json()).toEqual({ format: 1 });

    const w = await fetch(`${base}/sim-engine/sim-worker.${HASH}.js`);
    expect(w.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(w.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await w.text()).toBe("self.onmessage=()=>{};");

    const p = await fetch(`${base}/sim-engine/pool.${HASH}.json`);
    expect(await p.json()).toEqual([{ id: "a" }]);
  });

  it("compresses for a client that accepts gzip, and says it varies", async () => {
    const res = await fetch(`${base}/sim-engine/pool.${HASH}.json`, { headers: { "accept-encoding": "gzip" } });
    // node's fetch decodes transparently; ask for the raw bytes with a plain request instead
    const raw = await new Promise<{ headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      import("node:http").then(({ get }) =>
        get(`${base}/sim-engine/pool.${HASH}.json`, { headers: { "accept-encoding": "gzip" } }, (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => resolve({ headers: r.headers, body: Buffer.concat(chunks) }));
        }).on("error", reject),
      );
    });
    expect(res.status).toBe(200);
    expect(raw.headers["content-encoding"]).toBe("gzip");
    expect(raw.headers.vary).toBe("accept-encoding");
    expect(JSON.parse(gunzipSync(raw.body).toString())).toEqual([{ id: "a" }]);
  });

  it("answers HEAD without a body, and a missing hashed file with 404", async () => {
    const head = await fetch(`${base}/sim-engine/manifest.json`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const gone = await fetch(`${base}/sim-engine/pool.ffffffffffff.json`);
    expect(gone.status).toBe(404);
  });

  it("serves nothing but the exact names: no other file, no traversal, no wrong hash length", async () => {
    for (const path of [
      "/sim-engine/unlisted.js",
      "/sim-engine/",
      "/sim-engine/../secret.txt",
      "/sim-engine/%2e%2e/secret.txt",
      "/sim-engine/sim-worker.123.js",
      `/sim-engine/sim-worker.${HASH}.js.map`,
      "/secret.txt",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).not.toBe(200);
      expect(await res.text(), path).not.toContain("not for the web");
    }
  });
});
