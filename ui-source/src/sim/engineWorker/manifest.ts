import { EngineLoadError, messages } from "./errors.ts";

/** What `scripts/build-sim-worker.ts` writes to `sim-engine/manifest.json`. Pinned by `client.test.ts` against the real build. */
export interface AssetEntry {
  /** relative to the manifest */
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

const SAFE_URL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX64 = /^[0-9a-f]{64}$/;

function asset(v: unknown, what: string): AssetEntry {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw messages.manifestFormat(`${what} is missing`);
  if (typeof o.url !== "string" || !SAFE_URL.test(o.url)) throw messages.manifestFormat(`${what}.url is not a plain file name`);
  if (typeof o.bytes !== "number" || !Number.isInteger(o.bytes) || o.bytes <= 0) throw messages.manifestFormat(`${what}.bytes is not a size`);
  if (typeof o.sha256 !== "string" || !HEX64.test(o.sha256)) throw messages.manifestFormat(`${what}.sha256 is not a sha-256`);
  return { url: o.url, bytes: o.bytes, sha256: o.sha256 };
}

/** Validates the manifest's shape before anything is fetched from it: a file name can only be a plain name beside it. */
export function parseManifest(raw: unknown): SimEngineManifest {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") throw messages.manifestFormat("not an object");
  if (o.format !== 1) throw messages.manifestFormat(`format ${String(o.format)}`);
  if (typeof o.engineVersion !== "string" || !HEX64.test(o.engineVersion)) throw messages.manifestFormat("engineVersion");
  const art = o.artifacts as Record<string, unknown> | undefined;
  const pool = o.pool as Record<string, unknown> | undefined;
  if (!art || typeof art.count !== "number") throw messages.manifestFormat("artifacts.count");
  if (!pool || typeof pool.poolVersion !== "string" || !HEX64.test(pool.poolVersion) || typeof pool.players !== "number") {
    throw messages.manifestFormat("pool.poolVersion");
  }
  return {
    format: 1,
    engineVersion: o.engineVersion,
    worker: asset(o.worker, "worker"),
    artifacts: { ...asset(art, "artifacts"), count: art.count },
    pool: { ...asset(pool, "pool"), poolVersion: pool.poolVersion, players: pool.players },
  };
}

export type { EngineLoadError };
