/**
 * Entry point of the browser simulation worker (bundled by
 * `scripts/build-sim-worker.mjs`). Nothing here but the wiring from
 * `postMessage` to the host.
 */
import { createSimHost, type HostRequest } from "./worker-host.js";

interface WorkerScope {
  onmessage: ((e: { data: HostRequest }) => void) | null;
  postMessage(message: unknown): void;
}
const scope = globalThis as unknown as WorkerScope;
const host = createSimHost();
scope.onmessage = (e) => {
  void host.handle(e.data).then((res) => scope.postMessage(res));
};
