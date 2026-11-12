/**
 * Where the engine reads its committed model artifacts from (issue #74, Phase 2).
 *
 * Every artifact the engine loads (`artifacts/models/portable/*.json`,
 * `artifacts/distributions/portable/*.json`, `artifacts/ratings/*.json`,
 * `artifacts/models/derived_fit_baseline.json`) goes through one synchronous
 * seam: `readArtifactJson("<path under artifacts/>")`. The default source reads
 * the repository's `artifacts/` directory with `fs`, exactly as before
 * (`artifact-source-node.ts`). A caller that cannot use `fs` (a browser build,
 * a test) supplies its own with `setArtifactSource`; `createMemoryArtifactSource`
 * serves a preloaded map.
 *
 * Scope: like `setReferencePool`, the source is **process-wide** state, set
 * before the engine runs, not per league or per async context. Reads stay
 * synchronous because the engine is; a lazy/async browser source has to preload
 * its files before the first simulation. Switching the source drops everything
 * the engine derived from artifacts. Nothing here changes what the engine
 * computes from the same artifact content.
 */

import { nodeArtifactSource } from "./artifact-source-node.js";

export interface ArtifactSource {
  /** Identifies the source in logs and recorded versions (`node-fs`, `memory`, ...). */
  readonly id: string;
  /** Parsed JSON for `path`, relative to `artifacts/`, forward slashes (`models/portable/M04.json`). Throws if absent. */
  readJson<T>(path: string): T;
}

let _source: ArtifactSource | null = null;
const _listeners: (() => void)[] = [];

/**
 * Modules that keep anything derived from artifact content register here, so a
 * change of source can never be served from values computed on the old one.
 */
export function onArtifactSourceChange(fn: () => void): void {
  _listeners.push(fn);
}

/** The source in force: the one supplied, else the Node `fs` default. */
export function artifactSource(): ArtifactSource {
  return _source ?? nodeArtifactSource;
}

/** Supply the artifact source; `null` restores the Node `fs` default. */
export function setArtifactSource(source: ArtifactSource | null = null): void {
  _source = source;
  for (const f of _listeners) f();
}

export function readArtifactJson<T>(path: string): T {
  return artifactSource().readJson<T>(path);
}

/** A source over files already in memory, keyed by path under `artifacts/`. */
export function createMemoryArtifactSource(files: Readonly<Record<string, unknown>>, id = "memory"): ArtifactSource {
  return {
    id,
    readJson<T>(path: string): T {
      if (!Object.prototype.hasOwnProperty.call(files, path)) throw new Error(`artifact not found: ${path}`);
      return files[path] as T;
    },
  };
}
