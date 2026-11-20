/**
 * The simulation service behind a message boundary (issue #74 Phase 4): what a
 * browser Web Worker runs, kept free of `Worker` and `self` so Node can drive
 * it directly in tests. The page sends `init` once (the artifact files and the
 * reference pool, with the pool version it expects) and then `call` for any
 * route in `createRoutes` — the same handlers the local adapter serves over
 * HTTP, so the two answer identically.
 *
 * Results travel as a JSON string, exactly what the adapter's HTTP body is,
 * so a value that JSON would change (an `undefined` field, a NaN) is changed
 * the same way on both paths.
 */
import { createMemoryArtifactSource, REQUIRED_ARTIFACTS, setArtifactSource } from "../engine/artifact-source.js";
import { poolVersion, setReferencePool } from "../engine/roster.js";
import type { Player } from "../schema/player.js";
import { simulateOne } from "./game.js";
import { createRoutes } from "./routes.js";

export type HostRequest =
  | {
      id: number;
      kind: "init";
      /**
       * every file in `REQUIRED_ARTIFACTS`, keyed by its path under `artifacts/`: parsed (`artifacts`), or as the
       * JSON bytes the page downloaded (`artifactsBuffer`), which the worker parses so the page's thread doesn't
       */
      artifacts?: Record<string, unknown>;
      artifactsBuffer?: ArrayBuffer;
      /** the reference pool, parsed (`pool`) or as JSON bytes (`poolBuffer`) */
      pool?: Player[];
      poolBuffer?: ArrayBuffer;
      /** if given, a pool whose content hash differs is refused and nothing is installed */
      expectPoolVersion?: string;
    }
  | { id: number; kind: "call"; route: string; body: unknown };

export type HostResponse =
  | { id: number; ok: true; json: string }
  | { id: number; ok: false; error: string };

export interface InitResult {
  poolVersion: string;
  players: number;
  artifacts: number;
}

function parseBuffer<T>(buf: ArrayBuffer | undefined, what: string): T {
  if (!buf) throw new Error(`init needs the ${what} (parsed, or as a buffer)`);
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

export function createSimHost() {
  const routes = createRoutes((input) => simulateOne(input));
  let installed: Player[] | null = null;
  let info: InitResult | null = null;

  const ok = (id: number, value: unknown): HostResponse => ({ id, ok: true, json: JSON.stringify(value) });
  const fail = (id: number, e: unknown): HostResponse => ({ id, ok: false, error: e instanceof Error ? e.message : String(e) });

  async function handle(req: HostRequest): Promise<HostResponse> {
    try {
      if (req.kind === "init") {
        const artifacts = req.artifacts ?? parseBuffer<Record<string, unknown>>(req.artifactsBuffer, "artifacts");
        const pool = req.pool ?? parseBuffer<Player[]>(req.poolBuffer, "pool");
        const version = poolVersion(pool);
        if (req.expectPoolVersion !== undefined && req.expectPoolVersion !== version) {
          throw new Error(`pool version mismatch: expected ${req.expectPoolVersion}, got ${version}`);
        }
        // atomic: a source missing a file throws here and leaves the host as it was
        setArtifactSource(createMemoryArtifactSource(artifacts, "worker"));
        setReferencePool(pool);
        installed = pool;
        info = { poolVersion: version, players: pool.length, artifacts: REQUIRED_ARTIFACTS.length };
        return ok(req.id, info);
      }
      if (!info || !installed) throw new Error("simulation worker is not initialised: send init first");
      if (req.route === "/pool") return ok(req.id, installed);
      const handler = routes[req.route];
      if (!handler) throw new Error(`no route for ${req.route}`);
      return ok(req.id, await handler(req.body ?? {}));
    } catch (e) {
      return fail(req.id, e);
    }
  }

  return { handle, get info() { return info; } };
}
