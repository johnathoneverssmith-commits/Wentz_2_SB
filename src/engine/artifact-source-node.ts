/** The default artifact source: the repository's `artifacts/` directory, read with `fs`. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ArtifactSource } from "./artifact-source.js";

const ARTIFACT_ROOT = new URL("../../artifacts/", import.meta.url);

export const nodeArtifactSource: ArtifactSource = {
  id: "node-fs",
  readJson<T>(path: string): T {
    return JSON.parse(readFileSync(fileURLToPath(new URL(path, ARTIFACT_ROOT)), "utf8")) as T;
  },
};
