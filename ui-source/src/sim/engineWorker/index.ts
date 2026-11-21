export { EngineWorkerClient, type EngineInfo, type EngineWorkerOptions, type Progress, type WorkerLike } from "./client.ts";
export { EngineLoadError, EngineRouteError, isEngineLoadError, type EngineLoadStage } from "./errors.ts";
export { parseManifest, type SimEngineManifest } from "./manifest.ts";
export { BROWSER_ENGINE_KEY, adapterFallbackAllowed, browserEngineEnabled, currentEngineVersion, engineTransport, onEngineProgress, sharedEngineClient, workerTransport } from "./transport.ts";
export { browserName, browserSupport, isVerifiedBrowser } from "./support.ts";

/** Where the engine files are served from for this page: `sim-engine/` beside `index.html`, whichever base path the app is under. */
export const simEngineBaseUrl = (): string => new URL("sim-engine/", document.baseURI).href;
