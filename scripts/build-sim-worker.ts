// Builds the browser simulation worker (issue #74 Phase 4).
//
//   npx tsx scripts/build-sim-worker.ts [outDir]      # default dist/sim-worker (npm run sim-worker:build)
//
// Writes:
//   sim-worker.js         the engine + sim-service host as one classic-worker script (no Node built-ins)
//   engine-artifacts.json every file in REQUIRED_ARTIFACTS, keyed by path under artifacts/
//   manifest.json         sizes, gzip sizes and an engine version (sha-256 over the two files above)
//
// The engine's Node-only modules are swapped for browser stand-ins (src/sim-service/browser/) so the bundle has
// nothing to resolve from node:*; the page supplies the artifacts and the player pool in the worker's init message.
//
// `esbuild` is resolved from the repo's installed dependencies (it arrives with vite/vitest). It is not yet a
// declared devDependency of the root package: adding it is a dependency change that needs its own approval.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build, type Plugin } from "esbuild";

import { REQUIRED_ARTIFACTS } from "../src/engine/artifact-source.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const swap = (filter: RegExp, to: string): Plugin => ({
  name: `swap-${to}`,
  setup(b) {
    b.onResolve({ filter }, () => ({ path: resolve(root, to) }));
  },
});

export interface SimWorkerManifest {
  engineVersion: string;
  artifacts: number;
  worker: { bytes: number; gzip: number };
  engineArtifacts: { bytes: number; gzip: number };
}

export async function buildSimWorker(outDir: string = join(root, "dist/sim-worker")) {
  mkdirSync(outDir, { recursive: true });
  const res = await build({
    entryPoints: [join(root, "src/sim-service/worker-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    logLevel: "silent",
    plugins: [
      swap(/artifact-source-node\.js$/, "src/sim-service/browser/artifact-source-node.ts"),
      swap(/(^|\/)data\/players\.js$/, "src/sim-service/browser/players.ts"),
    ],
  });
  const js = res.outputFiles[0]!.text;

  const artifacts: Record<string, unknown> = {};
  for (const path of REQUIRED_ARTIFACTS) artifacts[path] = JSON.parse(readFileSync(join(root, "artifacts", path), "utf8"));
  const artifactsJson = JSON.stringify(artifacts);

  writeFileSync(join(outDir, "sim-worker.js"), js);
  writeFileSync(join(outDir, "engine-artifacts.json"), artifactsJson);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const manifest: SimWorkerManifest = {
    engineVersion: sha(sha(js) + sha(artifactsJson)),
    artifacts: Object.keys(artifacts).length,
    worker: { bytes: Buffer.byteLength(js), gzip: gzipSync(js).length },
    engineArtifacts: { bytes: Buffer.byteLength(artifactsJson), gzip: gzipSync(artifactsJson).length },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { outDir, manifest, js, artifacts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outDir, manifest } = await buildSimWorker(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`built ${outDir}\n${JSON.stringify(manifest, null, 2)}`);
}
