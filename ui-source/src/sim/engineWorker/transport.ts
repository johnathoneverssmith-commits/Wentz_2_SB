/**
 * The browser engine as a transport for `HttpSimulationService` (issue #74 Phase 5): the same routes the local
 * adapter serves, answered by the Web Worker from `client.ts`. One client is shared by every service in the page,
 * so the engine is downloaded, cached and started once.
 */
import type { Transport } from "../transportType.ts";
import { EngineWorkerClient } from "./client.ts";

let shared: EngineWorkerClient | null = null;

/** The page's one engine. Nothing is fetched until it is first asked for something. */
export function sharedEngineClient(): EngineWorkerClient {
  return (shared ??= new EngineWorkerClient({ baseUrl: new URL("sim-engine/", document.baseURI).href }));
}

export const workerTransport =
  (client: EngineWorkerClient = sharedEngineClient()): Transport =>
  (path, body, signal) =>
    client.call(path, body, signal);

/** localStorage key that turns the browser engine on for this browser. */
export const BROWSER_ENGINE_KEY = "nfl-sim.browser-engine";

/**
 * Whether new play should use the browser engine instead of the local adapter. Off unless asked for, with
 * `?engine=browser` in the address or `localStorage["nfl-sim.browser-engine"] = "1"`; the default does not change
 * until the owner decides it should.
 */
export function browserEngineEnabled(): boolean {
  try {
    if (new URLSearchParams(globalThis.location?.search ?? "").get("engine") === "browser") return true;
    return globalThis.localStorage?.getItem(BROWSER_ENGINE_KEY) === "1";
  } catch {
    return false; // storage blocked: the default
  }
}
