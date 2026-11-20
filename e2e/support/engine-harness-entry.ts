/** Test page for the browser simulation engine: the real client, on a page that does nothing else. Bundled by sim-engine-worker.spec.ts. */
import { EngineWorkerClient, isEngineLoadError, type Progress } from "../../ui-source/src/sim/engineWorker/index.ts";

interface Harness {
  __progress: Progress[];
  __engine: EngineWorkerClient;
  __describe: (e: unknown) => { stage?: string; retryable?: boolean; message: string; detail?: string };
  __ready: () => Promise<{ ok: true; info: unknown } | { ok: false; error: ReturnType<Harness["__describe"]> }>;
  __call: (route: string, body: unknown) => Promise<{ ok: true; json: string } | { ok: false; error: ReturnType<Harness["__describe"]> }>;
  __cacheKeys: () => Promise<string[]>;
}
const w = window as unknown as Harness;
w.__progress = [];
w.__engine = new EngineWorkerClient({ baseUrl: `${location.origin}/sim-engine/`, onProgress: (p) => w.__progress.push(p) });
w.__describe = (e) =>
  isEngineLoadError(e) ? { stage: e.stage, retryable: e.retryable, message: e.message, ...(e.detail ? { detail: e.detail } : {}) } : { message: e instanceof Error ? e.message : String(e) };
w.__ready = async () => {
  try {
    return { ok: true, info: await w.__engine.ensureReady() };
  } catch (e) {
    return { ok: false, error: w.__describe(e) };
  }
};
w.__call = async (route, body) => {
  try {
    return { ok: true, json: JSON.stringify(await w.__engine.call(route, body)) };
  } catch (e) {
    return { ok: false, error: w.__describe(e) };
  }
};
w.__cacheKeys = async () => (await (await caches.open("sim-engine-v1")).keys()).map((r) => r.url).sort();
document.title = "sim engine harness";
document.body.textContent = "sim engine harness";
