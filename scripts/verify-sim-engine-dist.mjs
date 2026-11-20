/**
 * Checks that a BUILT UI directory serves a working browser simulation engine (issue #74 Phase 4b):
 *
 *   node scripts/verify-sim-engine-dist.mjs <ui-source/dist> [--chromium <path>]
 *   node scripts/verify-sim-engine-dist.mjs --url <http://host:port> [--chromium <path>]     # an already-running server
 *
 * It serves the directory the way a static host would (or uses the server at --url), opens it in Chromium, and — with plain browser code, not
 * the app's client, so it checks only what a deploy must get right — fetches `sim-engine/manifest.json`, downloads
 * the three files it names, checks each one's size and SHA-256, starts the worker from the downloaded script,
 * initialises it with the artifacts and the pool and asks it for the schedule and one game. Exits non-zero, saying
 * which step failed, if anything is missing, mistyped, truncated or does not start.
 */
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const chromiumAt = args.indexOf("--chromium");
const executablePath = chromiumAt >= 0 ? args.splice(chromiumAt, 2)[1] : process.env.E2E_CHROMIUM_PATH || undefined;
const urlAt = args.indexOf("--url");
const remote = urlAt >= 0 ? args.splice(urlAt, 2)[1] : undefined;
const dist = resolve(args[0] ?? "ui-source/dist");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json" };
const served = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = resolve(join(dist, normalize(path === "/" ? "/index.html" : path)));
  if (file !== dist && !file.startsWith(dist + sep)) return void res.writeHead(403).end();
  try {
    if (!statSync(file).isFile()) throw new Error("not a file");
    served.push(path);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
if (!remote) await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = remote ? remote.replace(/\/$/, "") : `http://127.0.0.1:${server.address().port}`;

let failed = "";
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/index.html`);
  const result = await page.evaluate(async () => {
    const steps = [];
    const step = async (name, fn) => {
      try {
        const v = await fn();
        steps.push({ name, ok: true });
        return v;
      } catch (e) {
        steps.push({ name, ok: false, why: String(e && e.message ? e.message : e) });
        throw e;
      }
    };
    const hex = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      const base = new URL("sim-engine/", location.href);
      const manifest = await step("manifest.json is served as JSON", async () => {
        const r = await fetch(new URL("manifest.json", base), { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (!/json/.test(r.headers.get("content-type") ?? "")) throw new Error(`content-type ${r.headers.get("content-type")}`);
        return await r.json();
      });
      const get = (name, type) =>
        step(`${name} downloads, with the size and checksum the manifest promises`, async () => {
          const e = manifest[name];
          const r = await fetch(new URL(e.url, base));
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${e.url}`);
          if (!new RegExp(type).test(r.headers.get("content-type") ?? "")) throw new Error(`content-type ${r.headers.get("content-type")} for ${e.url}`);
          const buf = await r.arrayBuffer();
          if (buf.byteLength !== e.bytes) throw new Error(`${buf.byteLength} bytes, expected ${e.bytes}`);
          if ((await hex(buf)) !== e.sha256) throw new Error("checksum differs");
          return buf;
        });
      const [script, artifacts, pool] = await Promise.all([get("worker", "javascript"), get("artifacts", "json"), get("pool", "json")]);
      const worker = new Worker(URL.createObjectURL(new Blob([script], { type: "text/javascript" })));
      const ask = (msg, transfer = []) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("the worker did not answer in 60 s")), 60_000);
          worker.onmessage = (e) => (clearTimeout(t), resolve(e.data));
          worker.onerror = (e) => (clearTimeout(t), reject(new Error(e.message || "worker error")));
          worker.postMessage(msg, transfer);
        });
      await step("the worker starts and accepts the artifacts and the pool", async () => {
        const r = await ask({ id: 1, kind: "init", artifactsBuffer: artifacts, poolBuffer: pool, expectPoolVersion: manifest.pool.poolVersion }, [artifacts, pool]);
        if (!r.ok) throw new Error(r.error);
        const info = JSON.parse(r.json);
        if (info.poolVersion !== manifest.pool.poolVersion) throw new Error("pool version differs");
      });
      await step("the worker answers /schedule", async () => {
        const r = await ask({ id: 2, kind: "call", route: "/schedule", body: { year: 2026 } });
        if (!r.ok || JSON.parse(r.json).length !== 272) throw new Error(r.ok ? "not 272 games" : r.error);
      });
      await step("the worker plays a game", async () => {
        const r = await ask({ id: 3, kind: "call", route: "/simulate-week", body: { seed: 1, week: 1, phase: "REG", games: [{ homeTeam: "KC", awayTeam: "BUF" }] } });
        if (!r.ok) throw new Error(r.error);
        const g = JSON.parse(r.json)[0];
        if (typeof g.homeScore !== "number" || typeof g.awayScore !== "number") throw new Error("no score");
      });
      worker.terminate();
    } catch {
      /* the failing step is already recorded */
    }
    return steps;
  });
  for (const s of result) console.log(`${s.ok ? "ok  " : "FAIL"} ${s.name}${s.why ? `: ${s.why}` : ""}`);
  failed = result.find((s) => !s.ok)?.name ?? (result.length === 0 ? "nothing ran" : "");
  if (!remote) console.log(`served by the static host: ${served.filter((p) => p.startsWith("/sim-engine/")).join(", ")}`);
} finally {
  await browser.close();
  if (!remote) server.close();
}
if (failed) {
  console.error(`sim engine check FAILED at: ${failed}`);
  process.exit(1);
}
console.log("sim engine check passed");
