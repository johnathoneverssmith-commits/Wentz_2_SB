/**
 * Why the browser simulation engine could not be started, in words a player can act on.
 *
 * `stage` says where it stopped; `retryable` says whether pressing Retry can help (a dropped connection can, a
 * browser with no Web Workers cannot); `message` is what to show; `detail` is the technical cause for a bug report.
 */
export type EngineLoadStage = "unsupported" | "manifest" | "download" | "integrity" | "worker" | "init" | "call";

export class EngineLoadError extends Error {
  readonly code = "ENGINE_LOAD_FAILED";
  constructor(
    readonly stage: EngineLoadStage,
    message: string,
    readonly retryable: boolean,
    readonly detail?: string,
    cause?: unknown,
    /** the files themselves look wrong (they disagree with the manifest), as opposed to merely not having started */
    readonly suspectsFiles = false,
  ) {
    super(message);
    this.name = "EngineLoadError";
    if (cause !== undefined) this.cause = cause;
  }
}

export const isEngineLoadError = (e: unknown): e is EngineLoadError =>
  e instanceof EngineLoadError || (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENGINE_LOAD_FAILED");

/** The engine ran and a request failed (the worker's answer to one call), as opposed to the engine not starting. */
export class EngineRouteError extends Error {
  readonly code = "ENGINE_ROUTE_FAILED";
  constructor(readonly route: string, message: string) {
    super(`the engine could not answer ${route}: ${message}`);
    this.name = "EngineRouteError";
  }
}

export const messages = {
  unsupported: (what: string) =>
    new EngineLoadError(
      "unsupported",
      `This browser can't run the simulation engine on its own (${what}). Use a current version of Chrome, Edge, Firefox or Safari, or run the engine on your computer (npm run server).`,
      false,
      what,
    ),
  manifest: (why: string, cause?: unknown) =>
    new EngineLoadError(
      "manifest",
      `The simulation engine couldn't be found (${why}). Check your connection and press Retry. If it keeps failing the site may be updating; reload in a minute.`,
      true,
      why,
      cause,
    ),
  manifestFormat: (why: string) =>
    new EngineLoadError(
      "manifest",
      "The page and the simulation engine are out of step (the engine's description isn't one this page understands). Reload the page to get a matching pair.",
      false,
      why,
    ),
  download: (asset: string, why: string, cause?: unknown) =>
    new EngineLoadError(
      "download",
      `The simulation engine couldn't be downloaded (${asset}: ${why}). Nothing was played or changed. Check your connection and press Retry; what was already downloaded is kept.`,
      true,
      `${asset}: ${why}`,
      cause,
    ),
  integrity: (asset: string, why: string) =>
    new EngineLoadError(
      "integrity",
      `The downloaded simulation engine was damaged in transit (${asset}: ${why}). The bad copy was discarded. Press Retry to download it again.`,
      true,
      `${asset}: ${why}`,
    ),
  worker: (why: string, cause?: unknown) =>
    new EngineLoadError(
      "worker",
      `The simulation engine stopped unexpectedly (${why}). Nothing was changed. Press Retry to start it again; if it keeps happening, reload the page.`,
      true,
      why,
      cause,
    ),
  init: (why: string, suspectsFiles: boolean, cause?: unknown) =>
    new EngineLoadError(
      "init",
      suspectsFiles
        ? `The simulation engine downloaded but wouldn't start (${why}). The saved copy was discarded; press Retry to fetch a fresh one.`
        : `The simulation engine downloaded but wouldn't start (${why}). Press Retry; if it still fails, reload the page and report this message.`,
      true,
      why,
      cause,
      suspectsFiles,
    ),
  cancelled: () =>
    new EngineLoadError("worker", "The simulation engine was shut down while it was starting. Ask for it again to start it.", true, "disposed during start"),
  timeout: (what: string, ms: number) =>
    new EngineLoadError(
      "init",
      `The simulation engine took longer than ${Math.round(ms / 1000)} seconds to ${what}. Press Retry; on a slow connection or a busy phone it can take a second try.`,
      true,
      `${what} timed out after ${ms} ms`,
    ),
};
