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
      /** every file in `REQUIRED_ARTIFACTS`, parsed, keyed by its path under `artifacts/` */
      artifacts: Record<string, unknown>;
      pool: Player[];
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

export function createSimHost() {
  const routes = createRoutes((input) => simulateOne(input));
  let pool: Player[] | null = null;
  let info: InitResult | null = null;

  const ok = (id: number, value: unknown): HostResponse => ({ id, ok: true, json: JSON.stringify(value) });
  const fail = (id: number, e: unknown): HostResponse => ({ id, ok: false, error: e instanceof Error ? e.message : String(e) });

  async function handle(req: HostRequest): Promise<HostResponse> {
    try {
      if (req.kind === "init") {
        const version = poolVersion(req.pool);
        if (req.expectPoolVersion !== undefined && req.expectPoolVersion !== version) {
          throw new Error(`pool version mismatch: expected ${req.expectPoolVersion}, got ${version}`);
        }
        // atomic: a source missing a file throws here and leaves the host as it was
        setArtifactSource(createMemoryArtifactSource(req.artifacts, "worker"));
        setReferencePool(req.pool);
        pool = req.pool;
        info = { poolVersion: version, players: req.pool.length, artifacts: REQUIRED_ARTIFACTS.length };
        return ok(req.id, info);
      }
      if (!info || !pool) throw new Error("simulation worker is not initialised: send init first");
      if (req.route === "/pool") return ok(req.id, pool);
      const handler = routes[req.route];
      if (!handler) throw new Error(`no route for ${req.route}`);
      return ok(req.id, await handler(req.body ?? {}));
    } catch (e) {
      return fail(req.id, e);
    }
  }

  return { handle, get info() { return info; } };
}
