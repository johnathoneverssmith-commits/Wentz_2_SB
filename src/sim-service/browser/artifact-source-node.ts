/** Browser build stand-in for `engine/artifact-source-node.ts`: there is no filesystem, so the host must install a source. */
import type { ArtifactSource } from "../../engine/artifact-source.js";

export const nodeArtifactSource: ArtifactSource = {
  id: "none",
  readJson<T>(path: string): T {
    throw new Error(`no artifact source installed (needed ${path}): send init to the simulation worker first`);
  },
};
