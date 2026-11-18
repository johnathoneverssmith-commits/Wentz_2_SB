/**
 * The page's side of the browser simulation engine (issue #74 Phase 4b).
 *
 * Nothing is fetched until something asks for the engine (`ensureReady` / `call`): a page that never simulates
 * a game downloads nothing. The first use downloads three files named in `sim-engine/manifest.json` — the worker
 * script, the model artifacts and the player pool — each addressed by its content hash, checks them against the
 * manifest, keeps them in Cache Storage, starts a Web Worker from the checked script and initialises it with the
 * other two. The next visit finds them in the cache and only revalidates the manifest, so a new engine (a new
 * manifest) is picked up on the next load and the old files are dropped; with no connection the last engine this
 * browser had still starts.
 *
 * Every way this can fail is an {@link EngineLoadError} with a message that says what to do. A failed load is not
 * remembered: the next call starts over, and what was already downloaded and checked is kept. Calls are the same
 * routes the local adapter serves (`post(path, body)` in `HttpSimulationService`), so wiring this in as a
 * transport (Phase 5) changes where the request goes, not what it means.
 */
import { type AssetStore, cacheStorageStore } from "./assetStore.ts";
import { EngineLoadError, EngineRouteError, isEngineLoadError, messages } from "./errors.ts";
import { type AssetEntry, parseManifest, type SimEngineManifest } from "./manifest.ts";

/** The part of a Worker the client uses; the tests supply their own. */
export interface WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type EngineAsset = "worker" | "artifacts" | "pool";
export interface Progress {
  stage: "manifest" | "download" | "start" | "ready";
  asset?: EngineAsset;
  /** bytes of the engine fetched or read from the cache so far, and the total the manifest promises */
  loaded: number;
  total: number;
}

export interface EngineInfo {
  engineVersion: string;
  poolVersion: string;
  players: number;
  /** every file came from this browser's cache (no download) */
  fromCache: boolean;
  /** the manifest could not be fetched and the last one this browser saw was used */
  offline: boolean;
}

export interface EngineWorkerOptions {
  /** the directory holding `manifest.json`, as an absolute URL ending in "/" */
  baseUrl: string;
  fetch?: typeof fetch;
  caches?: CacheStorage | null;
  createWorker?: (script: ArrayBuffer) => WorkerLike;
  /** hex SHA-256 of some bytes, or undefined where the browser can't (an insecure origin); then size alone is checked */
  digest?: (bytes: ArrayBuffer) => Promise<string | undefined>;
  timeoutMs?: { manifest?: number; asset?: number; init?: number };
  onProgress?: (p: Progress) => void;
}

type Status = "idle" | "loading" | "ready" | "failed";

interface Pending {
  resolve: (json: string) => void;
  reject: (e: unknown) => void;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function defaultDigest(bytes: ArrayBuffer): Promise<string | undefined> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) return undefined;
  const d = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function blobWorker(script: ArrayBuffer): WorkerLike {
  const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
  const w = new Worker(url);
  const terminate = w.terminate.bind(w);
  w.terminate = () => {
    terminate();
    URL.revokeObjectURL(url);
  };
  return w as unknown as WorkerLike;
}

export class EngineWorkerClient {
  private readonly fetchFn: typeof fetch;
  private readonly store: AssetStore;
  private readonly digest: (b: ArrayBuffer) => Promise<string | undefined>;
  private readonly makeWorker: (script: ArrayBuffer) => WorkerLike;
  private readonly t: { manifest: number; asset: number; init: number };
  private readonly manifestUrl: string;

  /** bumped by dispose(): a start that began under an older value must not create a worker or publish readiness */
  private epoch = 0;
  private state: Status = "idle";
  private loading: Promise<EngineInfo> | null = null;
  private info: EngineInfo | null = null;
  private lastError: EngineLoadError | null = null;
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly opts: EngineWorkerOptions) {
    this.fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.store = cacheStorageStore(opts.caches === undefined ? (globalThis as { caches?: CacheStorage }).caches : opts.caches);
    this.digest = opts.digest ?? defaultDigest;
    this.makeWorker = opts.createWorker ?? blobWorker;
    this.t = { manifest: opts.timeoutMs?.manifest ?? 20_000, asset: opts.timeoutMs?.asset ?? 120_000, init: opts.timeoutMs?.init ?? 60_000 };
    this.manifestUrl = new URL("manifest.json", opts.baseUrl).href;
  }

  get status(): Status {
    return this.state;
  }
  get engine(): EngineInfo | null {
    return this.info;
  }
  /** why the last start failed, until the next start succeeds */
  get error(): EngineLoadError | null {
    return this.lastError;
  }

  /** Starts the engine if it isn't running. Calls share one start; a failed start is retried by the next call. */
  ensureReady(): Promise<EngineInfo> {
    if (this.state === "ready" && this.info) return Promise.resolve(this.info);
    if (this.loading) return this.loading;
    this.state = "loading";
    this.lastError = null;
    const epoch = this.epoch;
    const attempt: Promise<EngineInfo> = this.load(epoch).then(
      (info) => {
        if (epoch === this.epoch) {
          this.state = "ready";
          this.info = info;
          this.loading = null;
        }
        return info;
      },
      (e: unknown) => {
        const err = isEngineLoadError(e) ? e : messages.worker(e instanceof Error ? e.message : String(e), e);
        // a start that dispose() cancelled reports to its own caller and touches nothing a newer start owns
        if (epoch === this.epoch) {
          this.state = "failed";
          this.loading = null;
          this.lastError = err;
        }
        throw err;
      },
    );
    this.loading = attempt;
    return attempt;
  }

  /** One route of the simulation service (`/simulate-week`, …) with its request body; resolves to the parsed answer. */
  async call<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
    await this.ensureReady();
    const worker = this.worker;
    if (!worker) throw messages.worker("the engine is not running");
    signal?.throwIfAborted();
    const id = this.nextId++;
    this.routeOf.set(id, route);
    const answer = new Promise<string>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    const onAbort = () => {
      this.pending.get(id)?.reject(signal!.reason);
      this.pending.delete(id);
      this.routeOf.delete(id);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      worker.postMessage({ id, kind: "call", route, body });
      return JSON.parse(await answer) as T;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.routeOf.delete(id);
    }
  }

  /** Stops the worker. A later call starts the engine again. */
  dispose(): void {
    this.epoch++; // a start in flight is cancelled: it stops at its next step and creates no worker
    this.failWorker(messages.worker("the engine was shut down"), false);
    this.loading = null;
    this.state = "idle";
    this.info = null;
    this.lastError = null;
  }

  private assertCurrent(epoch: number): void {
    if (epoch !== this.epoch) throw messages.cancelled();
  }

  // ---- loading -----------------------------------------------------------------------------------------------

  private async load(epoch: number): Promise<EngineInfo> {
    if (typeof Worker === "undefined" && !this.opts.createWorker) throw messages.unsupported("no Web Workers");
    try {
      return await this.loadOnce(false, epoch);
    } catch (e) {
      // files that don't agree with each other (a saved copy from another engine, a deploy caught half way): the saved
      // copies were just dropped, so go to the network once. A damaged saved copy never gets here; it is replaced inline.
      if (isEngineLoadError(e) && e.retryable && e.stage === "init") return await this.loadOnce(true, epoch);
      throw e;
    }
  }

  private progress(p: Progress): void {
    this.opts.onProgress?.(p);
  }

  private async loadOnce(fresh: boolean, epoch: number): Promise<EngineInfo> {
    const { manifest, offline, text } = await this.getManifest();
    this.assertCurrent(epoch);
    const entries: [EngineAsset, AssetEntry][] = [
      ["worker", manifest.worker],
      ["artifacts", manifest.artifacts],
      ["pool", manifest.pool],
    ];
    const total = sum(entries.map(([, e]) => e.bytes));
    const done: Record<EngineAsset, number> = { worker: 0, artifacts: 0, pool: 0 };
    const report = (asset: EngineAsset, loaded: number) => {
      done[asset] = loaded;
      this.progress({ stage: "download", asset, loaded: sum(Object.values(done)), total });
    };
    // every download is allowed to finish before an error is reported, so a retry reuses the files that did arrive
    const settled = await Promise.allSettled(entries.map(([name, e]) => this.getAsset(name, e, fresh, (n) => report(name, n))));
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    const got = settled.map((r) => (r as PromiseFulfilledResult<{ bytes: ArrayBuffer; cached: boolean }>).value);
    const bytes = Object.fromEntries(entries.map(([name], i) => [name, got[i]!.bytes])) as Record<EngineAsset, ArrayBuffer>;
    const fromCache = got.every((g) => g.cached);

    this.assertCurrent(epoch); // dispose() during the downloads: no worker is created
    this.progress({ stage: "start", loaded: total, total });
    const worker = this.makeWorker(bytes.worker);
    this.worker = worker;
    this.attach(worker);
    let info: { poolVersion: string; players: number; artifacts: number };
    try {
      info = await this.init(worker, manifest, bytes);
    } catch (e) {
      // only this start's own worker: after dispose() a newer start may own `this.worker` by now
      if (this.worker === worker) this.failWorker(isEngineLoadError(e) ? e : messages.worker(String(e)), false);
      else worker.terminate();
      if (isEngineLoadError(e) && e.stage === "init" && e.retryable && epoch === this.epoch) await this.purge(manifest);
      throw e;
    }
    if (epoch !== this.epoch) {
      // disposed while the worker was starting: dispose() already stopped it; nothing is published
      worker.terminate();
      throw messages.cancelled();
    }
    this.progress({ stage: "ready", loaded: total, total });
    // the engine is running: it is now the one to fall back to with no connection (a manifest saved earlier, when it
    // was only downloaded, could name files that never arrived), and files from an older engine are not needed
    if (!offline) await this.store.put(this.manifestUrl, new TextEncoder().encode(text).buffer as ArrayBuffer, "application/json");
    const keep = new Set<string>([this.manifestUrl, ...entries.map(([, e]) => new URL(e.url, this.manifestUrl).href)]);
    void this.store.keepOnly(keep);
    return { engineVersion: manifest.engineVersion, poolVersion: info.poolVersion, players: info.players, fromCache, offline };
  }

  private async purge(manifest: SimEngineManifest): Promise<void> {
    for (const e of [manifest.worker, manifest.artifacts, manifest.pool]) await this.store.delete(new URL(e.url, this.manifestUrl).href);
  }

  private async timed(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
    return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(ms) });
  }

  private async getManifest(): Promise<{ manifest: SimEngineManifest; offline: boolean; text: string }> {
    this.progress({ stage: "manifest", loaded: 0, total: 0 });
    let text: string | undefined;
    let why = "";
    try {
      const res = await this.timed(this.manifestUrl, this.t.manifest, { cache: "no-store" });
      if (res.ok) {
        text = await res.text();
      } else {
        why = `HTTP ${res.status}`;
      }
    } catch (e) {
      why = e instanceof Error && e.name === "TimeoutError" ? "no answer in time" : "no connection";
      if (!(e instanceof Error)) why = String(e);
    }
    let offline = false;
    if (text === undefined) {
      // no manifest from the server: the last engine this browser ran, if there is one, still starts
      const kept = await this.store.get(this.manifestUrl);
      if (!kept) throw messages.manifest(why);
      text = new TextDecoder().decode(kept);
      offline = true;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw messages.manifestFormat(`not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { manifest: parseManifest(raw), offline, text };
  }

  /** Checks bytes against the manifest: the size always, and the hash wherever the browser can compute one. */
  private async verify(bytes: ArrayBuffer, e: AssetEntry): Promise<string | undefined> {
    if (bytes.byteLength !== e.bytes) return `${bytes.byteLength} bytes, expected ${e.bytes}`;
    const h = await this.digest(bytes);
    if (h !== undefined && h !== e.sha256) return `checksum ${h.slice(0, 12)}…, expected ${e.sha256.slice(0, 12)}…`;
    return undefined;
  }

  private async getAsset(
    name: EngineAsset,
    e: AssetEntry,
    fresh: boolean,
    report: (loaded: number) => void,
  ): Promise<{ bytes: ArrayBuffer; cached: boolean }> {
    const url = new URL(e.url, this.manifestUrl).href;
    if (!fresh) {
      const kept = await this.store.get(url);
      if (kept) {
        if (!(await this.verify(kept, e))) {
          report(e.bytes);
          return { bytes: kept, cached: true };
        }
        await this.store.delete(url); // damaged on disk: fetch it again
      }
    }
    let lastProblem = "";
    for (const mode of ["default", "reload"] as const) {
      let res: Response;
      try {
        res = await this.timed(url, this.t.asset, mode === "reload" ? { cache: "reload" } : {});
      } catch (err) {
        throw messages.download(name, err instanceof Error && err.name === "TimeoutError" ? "too slow" : "no connection", err);
      }
      if (!res.ok) throw messages.download(name, `HTTP ${res.status}`);
      const bytes = await this.readBody(res, report);
      const problem = await this.verify(bytes, e);
      if (!problem) {
        await this.store.put(url, bytes, res.headers.get("content-type") ?? "application/octet-stream");
        return { bytes, cached: false };
      }
      lastProblem = problem; // once more past any intermediary's cache before giving up
    }
    await this.store.delete(url);
    throw messages.integrity(name, lastProblem);
  }

  private async readBody(res: Response, report: (loaded: number) => void): Promise<ArrayBuffer> {
    if (!res.body) {
      const buf = await res.arrayBuffer();
      report(buf.byteLength);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      report(got);
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out.buffer;
  }

  // ---- the worker --------------------------------------------------------------------------------------------

  private attach(worker: WorkerLike): void {
    worker.onmessage = (e) => {
      const m = e.data as { id?: number; ok?: boolean; json?: string; error?: string } | null;
      if (!m || typeof m.id !== "number") return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.json ?? "null");
      else p.reject(new EngineRouteError(this.routeOf.get(m.id) ?? "a request", m.error ?? "unknown error"));
    };
    worker.onerror = (e) => this.failWorker(messages.worker(e.message || "the worker script failed"), true);
    worker.onmessageerror = () => this.failWorker(messages.worker("the worker sent a message the page couldn't read"), true);
  }
  private readonly routeOf = new Map<number, string>();

  /** The worker died or was stopped: everything waiting on it is told, and the next call starts a new one. */
  private failWorker(err: EngineLoadError, markFailed: boolean): void {
    const w = this.worker;
    this.worker = null;
    try {
      w?.terminate();
    } catch {
      /* already gone */
    }
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    if (markFailed) {
      this.state = "failed";
      this.lastError = err;
      this.info = null;
    }
  }

  private init(
    worker: WorkerLike,
    manifest: SimEngineManifest,
    bytes: Record<EngineAsset, ArrayBuffer>,
  ): Promise<{ poolVersion: string; players: number; artifacts: number }> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(messages.timeout("start", this.t.init));
      }, this.t.init);
      this.pending.set(id, {
        resolve: (json) => {
          clearTimeout(timer);
          const info = JSON.parse(json) as { poolVersion: string; players: number; artifacts: number };
          if (info.poolVersion !== manifest.pool.poolVersion || info.artifacts !== manifest.artifacts.count) {
            reject(messages.init("the engine started on a different player pool than the one it was sent", true));
          } else resolve(info);
        },
        reject: (e) => {
          clearTimeout(timer);
          if (isEngineLoadError(e)) return reject(e);
          const why = e instanceof Error ? e.message.replace(/^the engine could not answer a request: /, "") : String(e);
          // a pool or artifact set that doesn't match what the manifest promised is a bad saved copy: worth one fresh download
          reject(messages.init(why, /pool version mismatch|artifact source .* rejected|not initialised/.test(why) ? true : false, e));
        },
      });
      worker.postMessage(
        { id, kind: "init", artifactsBuffer: bytes.artifacts, poolBuffer: bytes.pool, expectPoolVersion: manifest.pool.poolVersion },
        [bytes.artifacts, bytes.pool],
      );
    });
  }
}
