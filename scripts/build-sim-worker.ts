// Builds the browser simulation engine (issue #74 Phase 4): the worker script, the model artifacts and the
// reference player pool, as three separate, content-addressed files plus a small manifest that names them.
//
//   npx tsx scripts/build-sim-worker.ts [outDir] [--pool <players.json>]     # npm run sim-worker:build
//
// Default outDir is dist/sim-engine; the UI build writes it to ui-source/public/sim-engine so Vite copies it
// beside index.html (scripts/prepare-sim-engine.mjs). Files written:
//
//   manifest.json                       never cached: names the current files and the engine version
//   sim-worker.<sha12>.js               the engine + sim-service host as a classic-worker script (no Node built-ins)
//   engine-artifacts.<sha12>.json       every file in REQUIRED_ARTIFACTS, keyed by path under artifacts/
//   pool.<sha12>.json                   the reference player pool (default ui-source/src/data/pool-2026.json)
//
// The names carry the content hash, so a file never changes under its URL and can be cached for good; a new
// engine is a new manifest pointing at new names. `engineVersion` covers all three, because the pool and the
// artifacts decide what a game plays out as just as much as the code does.
//
// The engine's Node-only modules are swapped for browser stand-ins (src/sim-service/browser/), so the bundle has
// nothing to resolve from node:*.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import type { Plugin } from "esbuild";

import { REQUIRED_ARTIFACTS } from "../src/engine/artifact-source.js";
import { poolVersion } from "../src/engine/roster.js";
import type { Player } from "../src/schema/player.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_POOL = join(root, "ui-source/src/data/pool-2026.json");

/** `esbuild` is a root devDependency and also arrives with tsx (a production dependency), so it is there on Render too. */
async function loadEsbuild(): Promise<typeof import("esbuild")> {
  try {
    return await import("esbuild");
  } catch {
    // last resort: the UI's own install (vite brings it) when the root has none
    return createRequire(join(root, "ui-source/package.json"))("esbuild");
  }
}

const swap = (filter: RegExp, to: string): Plugin => ({
  name: `swap-${to}`,
  setup(b) {
    b.onResolve({ filter }, () => ({ path: resolve(root, to) }));
  },
});

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const short = (hex: string) => hex.slice(0, 12);

export interface AssetEntry {
  /** relative to the manifest, so the engine can be served from any base path */
  url: string;
  bytes: number;
  sha256: string;
}
export interface SimEngineManifest {
  format: 1;
  engineVersion: string;
  worker: AssetEntry;
  artifacts: AssetEntry & { count: number };
  pool: AssetEntry & { poolVersion: string; players: number };
}
export interface SimEngineBuild {
  outDir: string;
  manifest: SimEngineManifest;
  /** gzip sizes, for the report (a static host compresses these on the wire) */
  gzip: { worker: number; artifacts: number; pool: number };
  js: string;
  artifacts: Record<string, unknown>;
  pool: Player[];
}

const OWN_FILES = /^(sim-worker\.[0-9a-f]{12}\.js|engine-artifacts\.[0-9a-f]{12}\.json|pool\.[0-9a-f]{12}\.json|manifest\.json)$/;

export async function buildSimWorker(outDir: string = join(root, "dist/sim-engine"), poolPath: string = DEFAULT_POOL): Promise<SimEngineBuild> {
  mkdirSync(outDir, { recursive: true });
  const { build } = await loadEsbuild();
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

  const pool = JSON.parse(readFileSync(poolPath, "utf8")) as Player[];
  const poolJson = JSON.stringify(pool);
  const version = poolVersion(pool);

  const entry = (name: string, ext: string, body: string): AssetEntry => {
    const hash = sha(body);
    return { url: `${name}.${short(hash)}.${ext}`, bytes: Buffer.byteLength(body), sha256: hash };
  };
  const worker = entry("sim-worker", "js", js);
  const art = { ...entry("engine-artifacts", "json", artifactsJson), count: Object.keys(artifacts).length };
  const poolEntry = { ...entry("pool", "json", poolJson), poolVersion: version, players: pool.length };
  const manifest: SimEngineManifest = {
    format: 1,
    engineVersion: sha(`${worker.sha256}|${art.sha256}|${version}`),
    worker,
    artifacts: art,
    pool: poolEntry,
  };

  // only our own files are replaced; anything else in the directory is left alone
  for (const f of readdirSync(outDir)) if (OWN_FILES.test(f)) rmSync(join(outDir, f));
  writeFileSync(join(outDir, worker.url), js);
  writeFileSync(join(outDir, art.url), artifactsJson);
  writeFileSync(join(outDir, poolEntry.url), poolJson);
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    outDir,
    manifest,
    gzip: { worker: gzipSync(js).length, artifacts: gzipSync(artifactsJson).length, pool: gzipSync(poolJson).length },
    js,
    artifacts,
    pool,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const poolAt = args.indexOf("--pool");
  const poolPath = poolAt >= 0 ? resolve(args.splice(poolAt, 2)[1]!) : DEFAULT_POOL;
  const out = await buildSimWorker(args[0] ? resolve(args[0]) : undefined, poolPath);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const m = out.manifest;
  console.log(
    [
      `sim engine ${m.engineVersion.slice(0, 12)} -> ${out.outDir}`,
      `  ${m.worker.url}  ${kb(m.worker.bytes)} (gzip ${kb(out.gzip.worker)})`,
      `  ${m.artifacts.url}  ${kb(m.artifacts.bytes)} (gzip ${kb(out.gzip.artifacts)})  ${m.artifacts.count} files`,
      `  ${m.pool.url}  ${kb(m.pool.bytes)} (gzip ${kb(out.gzip.pool)})  ${m.pool.players} players`,
    ].join("\n"),
  );
}
