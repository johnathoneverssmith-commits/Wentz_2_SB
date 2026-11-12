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

/**
 * Every artifact file the engine can load, relative to `artifacts/`. A source
 * is checked against this list when it is installed, so an incomplete source is
 * refused up front instead of failing in the middle of a game.
 * `test/engine-artifact-source.test.ts` fails if this list and the directories
 * drift apart.
 */
export const REQUIRED_ARTIFACTS: readonly string[] = [
  ...["M01", "M02", "M03", "M04", "M05", "M08", "M09", "M10", "M11", "M13", "M14", "M15", "M20", "M21", "M25a", "M25b"].map(
    (id) => `models/portable/${id}.json`,
  ),
  ...["air_yards", "clock_runoff", "m10_exact", "m11_exact", "m14_exact", "penalty", "punt", "rz_yac"].map(
    (name) => `distributions/portable/${name}.json`,
  ),
  "ratings/rating_effect_coefficients.json",
  "ratings/attribute_reference_stats.json",
  "models/derived_fit_baseline.json",
];

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

/**
 * Supply the artifact source; `null` restores the Node `fs` default.
 *
 * A supplied source must be able to read every file in `REQUIRED_ARTIFACTS`.
 * If it cannot, this throws naming the source and the file **before anything
 * changes**: the active source, and every value the engine has derived from
 * it, stay exactly as they were. Switching does not touch the reference pool
 * or the rosters built from it.
 */
export function setArtifactSource(source: ArtifactSource | null = null): void {
  if (source) {
    for (const path of REQUIRED_ARTIFACTS) {
      try {
        source.readJson(path);
      } catch (e) {
        throw new Error(`artifact source "${source.id}" rejected: ${path}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
  }
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
