/**
 * The browser engine as a transport for `HttpSimulationService` (issue #74 Phase 5): the same routes the local
 * adapter serves, answered by the Web Worker from `client.ts`. One client is shared by every service in the page,
 * so the engine is downloaded, cached and started once.
 */
import type { Transport } from "../transportType.ts";
import { adapterTransport } from "../adapterTransport.ts";
import { EngineWorkerClient, type Progress } from "./client.ts";
import { isEngineLoadError } from "./errors.ts";

let shared: EngineWorkerClient | null = null;

const progressWatchers = new Set<(p: Progress | null) => void>();
let lastProgress: Progress | null = null;
/**
 * Progress of the engine's first download and start, for the screens that wait on it. `null` once it is ready (or
 * before anything has been asked of it). The callback is told the current state straight away.
 */
export function onEngineProgress(fn: (p: Progress | null) => void): () => void {
  progressWatchers.add(fn);
  fn(lastProgress);
  return () => progressWatchers.delete(fn);
}
function publish(p: Progress): void {
  lastProgress = p.stage === "ready" ? null : p;
  for (const fn of progressWatchers) fn(lastProgress);
}

/** The page's one engine. Nothing is fetched until it is first asked for something. */
export function sharedEngineClient(): EngineWorkerClient {
  return (shared ??= new EngineWorkerClient({ baseUrl: new URL("sim-engine/", document.baseURI).href, onProgress: publish }));
}

export const workerTransport =
  (client: EngineWorkerClient = sharedEngineClient()): Transport =>
  (path, body, signal) =>
    client.call(path, body, signal);

/** localStorage key for this browser's choice of engine: "1" the browser engine, "0" the local adapter. */
export const BROWSER_ENGINE_KEY = "nfl-sim.browser-engine";

/**
 * Whether play uses the browser engine rather than the local adapter (`npm run server`).
 *
 * The browser engine is the default wherever there is a page to run it in. `?engine=adapter` (or
 * `localStorage["nfl-sim.browser-engine"] = "0"`) chooses the adapter, which is how the engine is developed against;
 * `?engine=browser` / `"1"` choose the browser engine explicitly. With no `window` (the unit tests, the headless
 * tools) nothing runs in a browser, so the adapter path stands.
 */
export function browserEngineEnabled(): boolean {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? "").get("engine");
    if (q === "browser") return true;
    if (q === "adapter") return false;
    const stored = globalThis.localStorage?.getItem(BROWSER_ENGINE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // storage blocked: the default below
  }
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** The adapter is a developer's tool on their own computer: only a page served from there ever looks for it. */
export function adapterFallbackAllowed(): boolean {
  const h = globalThis.location?.hostname ?? "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

/**
 * The transport new play uses: the browser engine, and, on a developer's own machine only, the local adapter when
 * the browser engine cannot start (no `sim-engine/` files in a dev server, say). Anywhere else a failure to start is
 * the error the player sees, with its advice; the adapter is never probed from a deployed page.
 */
export function engineTransport(client?: EngineWorkerClient, adapter: Transport = adapterTransport): Transport {
  return async (path, body, signal) => {
    try {
      return await workerTransport(client ?? sharedEngineClient())(path, body, signal);
    } catch (e) {
      if (!isEngineLoadError(e) || !adapterFallbackAllowed()) throw e;
      try {
        return await adapter(path, body, signal);
      } catch {
        throw e; // say what went wrong with the engine the player was meant to be using
      }
    }
  };
}

/**
 * Which engine is answering, as a version to record in a save: the browser engine's, or `undefined` when only the
 * local adapter is (a developer's machine), whose engine this page cannot name, and only when `allowUnnamed`.
 */
export async function currentEngineVersion(client: EngineWorkerClient = sharedEngineClient(), allowUnnamed = true): Promise<string | undefined> {
  try {
    return (await client.ensureReady()).engineVersion;
  } catch (e) {
    // `allowUnnamed` is false for a save that recorded a browser-engine build: an adapter whose build can't be named
    // must not quietly carry on playing it, so the browser engine's failure stands
    if (allowUnnamed && isEngineLoadError(e) && adapterFallbackAllowed()) {
      try {
        await adapterTransport("/scheme-fit-baseline", {});
        return undefined;
      } catch {
        /* neither works: the browser engine's error is the one to show */
      }
    }
    throw e;
  }
}
