import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSimWorker, type SimEngineBuild, DEFAULT_POOL } from "../../../../scripts/build-sim-worker.ts";
import { createRoutes } from "../../../../src/sim-service/routes.ts";
import { simulateOne } from "../../../../src/sim-service/game.ts";
import { createSimHost, type HostRequest } from "../../../../src/sim-service/worker-host.ts";
import { isEngineLoadError, EngineLoadError, EngineRouteError } from "./errors.ts";
import { EngineWorkerClient, type EngineWorkerOptions, type Progress, type WorkerLike } from "./client.ts";
import { parseManifest } from "./manifest.ts";

/**
 * The page's side of the browser simulation engine (issue #74 Phase 4b), against the real build and the real
 * worker host. The "worker" is the host run in-process behind the same message boundary (structured clone with
 * transfer, so a buffer handed over is gone from the sender, as in a browser); Cache Storage and the network are
 * in-memory fakes. A real browser is covered by `e2e/specs/sim-engine-worker.spec.ts`.
 */
const ORIGIN = "https://game.example/";
const BASE = `${ORIGIN}sim-engine/`;

let tmp = "";
let v1: SimEngineBuild;
let v2: SimEngineBuild;
let dir1 = "";
let dir2 = "";

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "engine-client-"));
  dir1 = join(tmp, "v1");
  dir2 = join(tmp, "v2");
  v1 = await buildSimWorker(dir1);
  // an "engine upgrade": the same code and artifacts, one player rated differently, so a new pool and a new version
  const pool = JSON.parse(readFileSync(DEFAULT_POOL, "utf8")) as { overall?: number }[];
  pool[0] = { ...pool[0], overall: ((pool[0]!.overall ?? 60) % 90) + 3 };
  writeFileSync(join(tmp, "pool-v2.json"), JSON.stringify(pool));
  v2 = await buildSimWorker(dir2, join(tmp, "pool-v2.json"));
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// ---- fakes -------------------------------------------------------------------------------------------------------

class FakeCacheStorage {
  readonly caches = new Map<string, Map<string, { bytes: ArrayBuffer; type: string }>>();
  async open(name: string) {
    const entries = this.caches.get(name) ?? new Map();
    this.caches.set(name, entries);
    return {
      match: async (url: string) => {
        const e = entries.get(url);
        return e ? new Response(e.bytes.slice(0), { headers: { "content-type": e.type } }) : undefined;
      },
      put: async (url: string, res: Response) => {
        if (this.failPutFor && url.includes(this.failPutFor)) throw new DOMException("quota", "QuotaExceededError");
        entries.set(url, { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "" });
      },
      delete: async (req: string | Request) => entries.delete(typeof req === "string" ? req : req.url),
      keys: async () => [...entries.keys()].map((u) => new Request(u)),
    };
  }
  /** a write to any entry whose URL contains this fails, as a full disk's would */
  failPutFor: string | null = null;
  get entries(): string[] {
    return [...(this.caches.get("sim-engine-v1")?.keys() ?? [])].sort();
  }
  corrupt(urlPart: string) {
    for (const [u, e] of this.caches.get("sim-engine-v1") ?? []) if (u.includes(urlPart)) new Uint8Array(e.bytes)[10] ^= 0xff;
  }
}

/** The "server": serves a built engine directory; every request is recorded; `fail` can break any of them. */
class FakeSite {
  readonly requests: string[] = [];
  fail: ((path: string, attempt: number) => Response | Error | undefined) | null = null;
  /** when set, every response waits for it */
  hold: Promise<void> | null = null;
  private attempts = new Map<string, number>();
  constructor(public dir: string) {}
  fetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace("/sim-engine/", "");
    this.requests.push(path);
    if (this.hold) await this.hold;
    const n = (this.attempts.get(path) ?? 0) + 1;
    this.attempts.set(path, n);
    const broken = this.fail?.(path, n);
    if (broken instanceof Error) throw broken;
    if (broken) return broken;
    try {
      const body = readFileSync(join(this.dir, path));
      return new Response(body, { headers: { "content-type": path.endsWith(".js") ? "text/javascript" : "application/json" } });
    } catch {
      return new Response("nope", { status: 404 });
    }
  };
  assetRequests() {
    return this.requests.filter((r) => r !== "manifest.json");
  }
}

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  private host = createSimHost();
  constructor(private mode: "normal" | "silent" = "normal") {}
  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (this.terminated) return;
    // the message boundary: a copy, and transferred buffers are detached in the sender
    const data = structuredClone(message, { transfer }) as HostRequest;
    if (this.mode === "silent") return;
    void this.host.handle(data).then((res) => {
      if (!this.terminated) this.onmessage?.({ data: res });
    });
  }
  crash(message = "boom") {
    this.onerror?.({ message });
  }
  terminate() {
    this.terminated = true;
  }
}

function setup(site: FakeSite, extra: Partial<EngineWorkerOptions> = {}, cache = new FakeCacheStorage()) {
  const workers: FakeWorker[] = [];
  const progress: Progress[] = [];
  const client = new EngineWorkerClient({
    baseUrl: BASE,
    fetch: site.fetch,
    caches: cache as unknown as CacheStorage,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    onProgress: (p) => progress.push(p),
    ...extra,
  });
  return { client, workers, progress, cache };
}

const nodeAnswer = (route: string, body: unknown) => JSON.stringify(createRoutes((i) => simulateOne(i))[route]!(body));

// ---- tests -------------------------------------------------------------------------------------------------------

describe("lazy loading and first use", () => {
  it("downloads nothing until the engine is asked for", () => {
    const site = new FakeSite(dir1);
    const { client } = setup(site);
    expect(site.requests).toEqual([]);
    expect(client.status).toBe("idle");
  });

  it("fetches the manifest and the three files, reports progress to the total, and answers like the adapter", async () => {
    const site = new FakeSite(dir1);
    const { client, progress, cache } = setup(site);
    const info = await client.ensureReady();
    expect(site.requests.sort()).toEqual(["manifest.json", v1.manifest.artifacts.url, v1.manifest.pool.url, v1.manifest.worker.url].sort());
    expect(info).toMatchObject({ engineVersion: v1.manifest.engineVersion, poolVersion: v1.manifest.pool.poolVersion, fromCache: false, offline: false });
    expect(info.players).toBe(v1.manifest.pool.players);

    const total = v1.manifest.worker.bytes + v1.manifest.artifacts.bytes + v1.manifest.pool.bytes;
    const dl = progress.filter((p) => p.stage === "download");
    expect(dl.at(-1)).toMatchObject({ loaded: total, total });
    expect(dl.every((p, i) => i === 0 || p.loaded >= 0)).toBe(true);
    expect(progress.at(-1)?.stage).toBe("ready");
    expect(cache.entries).toHaveLength(4); // three files and the manifest

    const body = { year: 2026 };
    expect(JSON.stringify(await client.call("/schedule", body))).toBe(nodeAnswer("/schedule", body));
  });

  it("shares one start between simultaneous calls", async () => {
    const site = new FakeSite(dir1);
    const { client, workers } = setup(site);
    await Promise.all([client.call("/schedule", {}), client.call("/schedule", {}), client.ensureReady()]);
    expect(workers).toHaveLength(1);
    expect(site.assetRequests()).toHaveLength(3);
  });

  it("a route the engine can't answer is an EngineRouteError, not a failed engine", async () => {
    const site = new FakeSite(dir1);
    const { client } = setup(site);
    await expect(client.call("/nope", {})).rejects.toBeInstanceOf(EngineRouteError);
    expect(client.status).toBe("ready");
    await expect(client.call("/schedule", {})).resolves.toBeTruthy();
  });
});

describe("caching and reloads", () => {
  it("a later visit reads the files from the cache and only revalidates the manifest", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady();

    const site = new FakeSite(dir1);
    const again = setup(site, {}, cache);
    const info = await again.client.ensureReady();
    expect(site.requests).toEqual(["manifest.json"]);
    expect(info.fromCache).toBe(true);
    await expect(again.client.call("/schedule", {})).resolves.toBeTruthy();
  });

  it("with no connection, the last engine this browser ran still starts", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady();

    const offline = new FakeSite(dir1);
    offline.fail = () => new TypeError("Failed to fetch");
    const { client } = setup(offline, {}, cache);
    const info = await client.ensureReady();
    expect(info).toMatchObject({ offline: true, fromCache: true, engineVersion: v1.manifest.engineVersion });
    expect(offline.assetRequests()).toEqual([]);
  });

  it("with no connection and nothing saved, it says so and can be retried", async () => {
    const site = new FakeSite(dir1);
    site.fail = (p, n) => (p === "manifest.json" && n <= 1 ? new TypeError("Failed to fetch") : undefined);
    const { client } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EngineLoadError);
    expect(e).toMatchObject({ stage: "manifest", retryable: true });
    expect((e as Error).message).toMatch(/Retry/);
    expect(client.status).toBe("failed");
    expect(client.error).toBe(e);
    await expect(client.ensureReady()).resolves.toBeTruthy(); // the next call starts over
    expect(client.status).toBe("ready");
    expect(client.error).toBeNull();
  });

  it("an engine upgrade is picked up on the next load, downloads only what changed, and drops the old files", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady();
    const before = cache.entries;

    const site = new FakeSite(dir2);
    const { client } = setup(site, {}, cache);
    const info = await client.ensureReady();
    expect(info.engineVersion).toBe(v2.manifest.engineVersion);
    expect(info.engineVersion).not.toBe(v1.manifest.engineVersion);
    expect(info.poolVersion).toBe(v2.manifest.pool.poolVersion);
    // the worker and the artifacts are byte-identical across the two builds, only the pool is new
    expect(v2.manifest.worker.url).toBe(v1.manifest.worker.url);
    expect(v2.manifest.artifacts.url).toBe(v1.manifest.artifacts.url);
    expect(site.assetRequests()).toEqual([v2.manifest.pool.url]);

    await client.call("/schedule", {});
    await new Promise((r) => setTimeout(r, 10)); // the cleanup runs after the engine is up
    const after = cache.entries;
    expect(after.some((u) => u.endsWith(v1.manifest.pool.url))).toBe(false);
    expect(after.some((u) => u.endsWith(v2.manifest.pool.url))).toBe(true);
    expect(before.length).toBe(after.length);
    // and the pool the worker runs on is the new one
    const pool = await client.call<{ id: string; overall?: number }[]>("/pool", {});
    expect(pool[0]!.overall).toBe(v2.pool[0]!.overall);
  });

  it("an upgrade whose download fails does not replace the engine this browser can still start offline", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady(); // engine A is running and saved

    // engine B's manifest arrives, but its pool never does
    const upgrading = new FakeSite(dir2);
    upgrading.fail = (p) => (p === v2.manifest.pool.url ? new Response("unavailable", { status: 503 }) : undefined);
    const failed = await setup(upgrading, {}, cache).client.ensureReady().catch((x: unknown) => x);
    expect(failed).toMatchObject({ stage: "download" });

    // now the connection is gone: A, whose files are all still saved, starts
    const offline = new FakeSite(dir2);
    offline.fail = () => new TypeError("Failed to fetch");
    const { client } = setup(offline, {}, cache);
    const info = await client.ensureReady();
    expect(info).toMatchObject({ offline: true, fromCache: true, engineVersion: v1.manifest.engineVersion });
    expect(offline.assetRequests()).toEqual([]);
  });

  it("an upgrade that fails to start leaves the working engine's files alone, so it still starts offline", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady(); // engine A: running, saved
    const aFiles = cache.entries.filter((u) => !u.endsWith("manifest.json"));
    expect(aFiles).toHaveLength(3);

    // engine B shares A's worker and artifacts and has a new pool; its worker never answers init
    const made: FakeWorker[] = [];
    const upgrading = setup(new FakeSite(dir2), { createWorker: () => (made.push(new FakeWorker("silent")), made.at(-1)!), timeoutMs: { init: 40 } }, cache);
    const e = await upgrading.client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "init", retryable: true });
    expect(made).toHaveLength(1); // a slow worker is not evidence of bad files: no second attempt from the network
    // A's three files are all still saved, and so is A's manifest
    expect(cache.entries.filter((u) => aFiles.includes(u))).toEqual(aFiles.slice().sort());

    const offline = new FakeSite(dir2);
    offline.fail = () => new TypeError("Failed to fetch");
    const info = await setup(offline, {}, cache).client.ensureReady();
    expect(info).toMatchObject({ offline: true, fromCache: true, engineVersion: v1.manifest.engineVersion });
    expect(offline.assetRequests()).toEqual([]);
  });

  it("files that disagree with the manifest are dropped, but never ones the working engine also needs", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady(); // engine A saved
    // B: same worker and artifacts, but its manifest promises a pool version its pool file does not have
    const site = new FakeSite(dir2);
    const original = site.fetch;
    const wrong = { ...v2.manifest, pool: { ...v2.manifest.pool, poolVersion: "0".repeat(64) } };
    site.fetch = async (input, init) => (String(input).endsWith("manifest.json") ? new Response(JSON.stringify(wrong)) : original(input, init));
    const e = await setup(site, {}, cache).client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "init", retryable: true });
    const left = cache.entries;
    expect(left.some((u) => u.endsWith(v1.manifest.worker.url))).toBe(true); // shared with A: kept
    expect(left.some((u) => u.endsWith(v1.manifest.artifacts.url))).toBe(true); // shared with A: kept
    expect(left.some((u) => u.endsWith(v1.manifest.pool.url))).toBe(true); // A's own pool: kept
    expect(left.some((u) => u.endsWith(v2.manifest.pool.url))).toBe(false); // B's mismatching pool: dropped
  });

  it("an upgrade whose files could not be saved runs, but does not replace or prune the engine that is saved", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady(); // engine A saved
    const aEntries = cache.entries;

    // engine B downloads and starts, but the browser refuses to store its new pool (storage full)
    cache.failPutFor = v2.manifest.pool.url;
    const { client } = setup(new FakeSite(dir2), {}, cache);
    const info = await client.ensureReady();
    expect(info.engineVersion).toBe(v2.manifest.engineVersion); // this session plays on B
    expect(cache.entries).toEqual(aEntries); // A's files and manifest are untouched, nothing pruned

    // next time, with no connection, A (whose files are all still there) starts
    cache.failPutFor = null;
    const offline = new FakeSite(dir2);
    offline.fail = () => new TypeError("Failed to fetch");
    const again = await setup(offline, {}, cache).client.ensureReady();
    expect(again).toMatchObject({ offline: true, fromCache: true, engineVersion: v1.manifest.engineVersion });
  });

  it("a 200 that isn't the manifest (a captive portal's login page) falls back to the saved engine, and says so if there is none", async () => {
    const portal = async (input: Parameters<typeof fetch>[0], init?: RequestInit, real?: typeof fetch) =>
      String(input).endsWith("manifest.json") ? new Response("<html>Sign in to the Wi-Fi</html>", { status: 200 }) : real!(input, init);

    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady();
    const site = new FakeSite(dir1);
    site.fetch = ((i, n) => portal(i, n, new FakeSite(dir1).fetch)) as typeof fetch;
    const info = await setup(site, {}, cache).client.ensureReady();
    expect(info).toMatchObject({ offline: true, fromCache: true, engineVersion: v1.manifest.engineVersion });

    // nothing saved: an error that says what happened
    const bare = new FakeSite(dir1);
    bare.fetch = ((i, n) => portal(i, n, new FakeSite(dir1).fetch)) as typeof fetch;
    const e = await setup(bare).client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "manifest" });
    expect((e as EngineLoadError).detail).toMatch(/not JSON/);
  });

  it("a stale cached manifest never wins over a reachable server", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady();
    const info = await setup(new FakeSite(dir2), {}, cache).client.ensureReady();
    expect(info.offline).toBe(false);
    expect(info.engineVersion).toBe(v2.manifest.engineVersion);
  });
});

describe("failures a player can recover from", () => {
  it("a file that 404s names the file and the way out, and the retry reuses what already downloaded", async () => {
    const site = new FakeSite(dir1);
    site.fail = (p) => (p === v1.manifest.artifacts.url ? new Response("gone", { status: 404 }) : undefined);
    const { client } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "download", retryable: true });
    expect((e as EngineLoadError).message).toContain("artifacts");
    expect((e as EngineLoadError).message).toMatch(/Retry/);

    site.fail = null;
    const before = site.assetRequests().length;
    await client.ensureReady();
    // only the file that failed is fetched again (the others were stored)
    expect(site.assetRequests().length - before).toBe(1);
    expect(client.status).toBe("ready");
  });

  it("a truncated download is caught by size, fetched once more, and only then reported", async () => {
    const site = new FakeSite(dir1);
    const cut = (p: string) => (p === v1.manifest.pool.url ? new Response(readFileSync(join(dir1, p)).subarray(0, 100)) : undefined);
    site.fail = (p, n) => (n <= 2 ? cut(p) : undefined);
    const { client, cache } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "integrity", retryable: true });
    expect((e as Error).message).toMatch(/damaged/);
    expect(cache.entries.some((u) => u.endsWith(v1.manifest.pool.url))).toBe(false); // the bad copy was not kept
    await expect(client.ensureReady()).resolves.toBeTruthy(); // third request is good
  });

  it("a download of the right size but the wrong bytes is caught by the checksum", async () => {
    const site = new FakeSite(dir1);
    site.fail = (p, n) => {
      if (p !== v1.manifest.worker.url || n > 2) return undefined;
      const bad = Buffer.from(readFileSync(join(dir1, p)));
      bad[5] ^= 0x01;
      return new Response(bad);
    };
    const { client } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "integrity" });
    expect((e as EngineLoadError).detail).toContain("checksum");
  });

  it("a damaged cached copy is thrown away and fetched again without troubling the player", async () => {
    const cache = new FakeCacheStorage();
    await setup(new FakeSite(dir1), {}, cache).client.ensureReady();
    cache.corrupt(v1.manifest.artifacts.url);
    const site = new FakeSite(dir1);
    const { client } = setup(site, {}, cache);
    const info = await client.ensureReady();
    expect(info.fromCache).toBe(false);
    expect(site.assetRequests()).toEqual([v1.manifest.artifacts.url]);
    await expect(client.call("/schedule", {})).resolves.toBeTruthy();
  });

  it("a server that answers too slowly is an error with a retry, not a hang", async () => {
    const site = new FakeSite(dir1);
    site.fail = (p) => (p === v1.manifest.worker.url ? Object.assign(new Error("slow"), { name: "TimeoutError" }) : undefined);
    const { client } = setup(site, { timeoutMs: { asset: 50 } });
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "download", retryable: true });
    expect((e as EngineLoadError).detail).toContain("too slow");
  });

  it("a manifest that isn't ours, or points outside its directory, is refused before anything is fetched", async () => {
    for (const bad of [
      { format: 2 },
      { ...v1.manifest, worker: { ...v1.manifest.worker, url: "../../evil.js" } },
      { ...v1.manifest, pool: { ...v1.manifest.pool, url: "https://evil.example/pool.json" } },
      { ...v1.manifest, artifacts: { ...v1.manifest.artifacts, sha256: "xyz" } },
    ]) {
      expect(() => parseManifest(bad)).toThrow(EngineLoadError);
    }
    const site = new FakeSite(dir1);
    const original = site.fetch;
    site.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify({ format: 2 }));
      return original(input, init);
    };
    const { client } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "manifest", retryable: false });
    expect((e as Error).message).toMatch(/Reload the page/);
  });

  it("a 404 manifest says the engine isn't there and can be retried", async () => {
    const site = new FakeSite(dir1);
    site.fail = (p) => (p === "manifest.json" ? new Response("", { status: 404 }) : undefined);
    const { client } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "manifest", retryable: true });
    expect((e as EngineLoadError).detail).toBe("HTTP 404");
  });
});

describe("initialisation failures", () => {
  it("files that don't agree with the manifest's pool are refused, the saved copy is dropped, and the message says what to do", async () => {
    const site = new FakeSite(dir1);
    const original = site.fetch;
    // a manifest that promises a pool version the pool file doesn't have (a deploy caught half way)
    const wrongVersion = { ...v1.manifest, pool: { ...v1.manifest.pool, poolVersion: "0".repeat(64) } };
    site.fetch = async (input, init) =>
      String(input).endsWith("manifest.json") ? new Response(JSON.stringify(wrongVersion)) : original(input, init);
    const { client, cache, workers } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EngineLoadError);
    expect(e).toMatchObject({ stage: "init", retryable: true });
    expect((e as Error).message).toMatch(/wouldn't start/);
    expect((e as Error).message).toMatch(/Retry/);
    expect((e as EngineLoadError).detail).toMatch(/pool version mismatch/);
    expect(workers.every((w) => w.terminated)).toBe(true);
    // it tried once more from the network before giving up, and kept no files from the broken pair
    expect(workers.length).toBe(2);
    expect(cache.entries.filter((u) => !u.endsWith("manifest.json"))).toEqual([]);
    expect(client.status).toBe("failed");
  });

  it("an artifact set missing a file is refused naming the file", async () => {
    const site = new FakeSite(dir1);
    const w = { ...v1.artifacts };
    delete (w as Record<string, unknown>)["models/portable/M04.json"];
    const broken = JSON.stringify(w);
    const sha = (await import("node:crypto")).createHash("sha256").update(broken).digest("hex");
    const original = site.fetch;
    const manifest = { ...v1.manifest, artifacts: { ...v1.manifest.artifacts, bytes: Buffer.byteLength(broken), sha256: sha } };
    site.fetch = async (input, init) => {
      const u = String(input);
      if (u.endsWith("manifest.json")) return new Response(JSON.stringify(manifest));
      if (u.endsWith(v1.manifest.artifacts.url)) return new Response(broken);
      return original(input, init);
    };
    const { client } = setup(site);
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "init" });
    expect((e as EngineLoadError).detail).toContain("models/portable/M04.json");
  });

  it("a worker that never answers init times out with a retry", async () => {
    const site = new FakeSite(dir1);
    const { client } = setup(site, { createWorker: () => new FakeWorker("silent"), timeoutMs: { init: 40 } });
    const e = await client.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "init", retryable: true });
    expect((e as Error).message).toMatch(/longer than/);
  });

  it("no Web Workers at all is not retryable and says which browsers work", async () => {
    const site = new FakeSite(dir1);
    const c = new EngineWorkerClient({ baseUrl: BASE, fetch: site.fetch, caches: null });
    const e = await c.ensureReady().catch((x: unknown) => x);
    expect(e).toMatchObject({ stage: "unsupported", retryable: false });
    expect((e as Error).message).toMatch(/Chrome/);
    expect(site.requests).toEqual([]);
  });
});

describe("the worker dying", () => {
  it("fails what is waiting on it with a clear error, and the next call starts a fresh worker", async () => {
    const site = new FakeSite(dir1);
    const { client, workers } = setup(site);
    await client.ensureReady();
    const slow = client.call("/simulate-week", { seed: 1, week: 1, phase: "REG", games: [{ homeTeam: "KC", awayTeam: "BUF" }] });
    workers[0]!.crash("out of memory");
    const e = await slow.catch((x: unknown) => x);
    expect(isEngineLoadError(e)).toBe(true);
    expect(e).toMatchObject({ stage: "worker", retryable: true });
    expect(workers[0]!.terminated).toBe(true);
    expect(client.status).toBe("failed");

    await expect(client.call("/schedule", {})).resolves.toBeTruthy();
    expect(workers).toHaveLength(2);
    expect(client.status).toBe("ready");
  });

  it("dispose stops the worker and a later call restarts the engine", async () => {
    const site = new FakeSite(dir1);
    const { client, workers } = setup(site);
    await client.ensureReady();
    client.dispose();
    expect(workers[0]!.terminated).toBe(true);
    expect(client.status).toBe("idle");
    await client.call("/schedule", {});
    expect(workers).toHaveLength(2);
  });

  it("dispose during a start cancels it: no worker is created, nothing is published, and the engine can be started again", async () => {
    const site = new FakeSite(dir1);
    let release!: () => void;
    site.hold = new Promise<void>((r) => (release = r));
    const { client, workers } = setup(site);
    const starting = client.ensureReady().catch((x: unknown) => x);
    await new Promise((r) => setTimeout(r, 5)); // the manifest request is in flight
    client.dispose();
    expect(client.status).toBe("idle");
    release();
    const e = await starting;
    expect(e).toBeInstanceOf(EngineLoadError);
    expect(e).toMatchObject({ stage: "worker", retryable: true });
    expect((e as Error).message).toMatch(/shut down/);
    await new Promise((r) => setTimeout(r, 20));
    expect(workers).toHaveLength(0); // the downloads finished after dispose, and no worker came of them
    expect(client.status).toBe("idle");
    expect(client.engine).toBeNull();
    expect(client.error).toBeNull();

    site.hold = null;
    await expect(client.call("/schedule", {})).resolves.toBeTruthy();
    expect(workers).toHaveLength(1);
    expect(client.status).toBe("ready");
  });

  it("dispose while the worker is initialising terminates it, and a newer start is not disturbed by the old one's cleanup", async () => {
    const site = new FakeSite(dir1);
    const made: FakeWorker[] = [];
    const { client } = setup(site, {
      createWorker: () => {
        const w = new FakeWorker(made.length === 0 ? "silent" : "normal"); // the first never answers init
        made.push(w);
        return w;
      },
    });
    const first = client.ensureReady().catch((x: unknown) => x);
    for (let i = 0; i < 100 && made.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(made).toHaveLength(1);
    client.dispose();
    expect(made[0]!.terminated).toBe(true);
    const second = client.ensureReady(); // starts again at once
    expect(await first).toMatchObject({ stage: "worker" });
    await expect(second).resolves.toBeTruthy();
    expect(made).toHaveLength(2);
    expect(made[1]!.terminated).toBe(false); // the cancelled start's cleanup left the new worker alone
    await expect(client.call("/schedule", {})).resolves.toBeTruthy();
  });

  it("an aborted call rejects with the abort reason and leaves the engine usable", async () => {
    const site = new FakeSite(dir1);
    const { client } = setup(site);
    await client.ensureReady();
    const ctl = new AbortController();
    const p = client.call("/schedule", {}, ctl.signal);
    ctl.abort(new DOMException("stop", "AbortError"));
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await expect(client.call("/schedule", {})).resolves.toBeTruthy();
  });
});

describe("the build and the client agree", () => {
  it("the real manifest passes the client's validation, and its names are content hashes", () => {
    const m = parseManifest(JSON.parse(readFileSync(join(dir1, "manifest.json"), "utf8")));
    expect(m.engineVersion).toBe(v1.manifest.engineVersion);
    for (const e of [m.worker, m.artifacts, m.pool]) expect(e.url).toMatch(/\.[0-9a-f]{12}\.(js|json)$/);
    expect(readdirSync(dir1).sort()).toEqual([m.artifacts.url, "manifest.json", m.pool.url, m.worker.url].sort());
  });
});
