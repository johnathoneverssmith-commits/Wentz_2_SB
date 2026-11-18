/**
 * Thin HTTP adapter over the engine, for the franchise UI (`ui-source/`,
 * `nfl-sim-ui`) — the engine reads model artifacts via `node:fs` and can't run
 * in the browser directly, so this is the "swap the mock for the real thing"
 * seam described in `ui-source/src/sim/SimulationService.ts`.
 *
 * Deliberately dependency-free (`node:http`, no Express/Fastify) — the engine
 * itself only has `zod` as a runtime dependency; this keeps that footprint.
 * Local dev tool only: permissive CORS, no auth.
 *
 * Covers what the engine can genuinely back today: the real 2026 schedule,
 * real game simulation (+ the broadcast/gamecast view for one game per
 * request), the real-roster pool, scheme-fit, the coach market (the real
 * 32 current staffs + a distribution-matched free-agent pool), and the real
 * standings/playoff bracket. Draft-class prospect generation, trade
 * valuation, and retirement stay on the UI's MockSimulationService for now
 * (no calibrated engine model yet) — see `ui-source/NOTES.md` and
 * `HybridSimulationService.ts` for the boundary.
 *
 *   npm run server            # http://localhost:8787
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { loadPlayerPool } from "../src/data/players.js";
import { createRoutes } from "../src/sim-service/index.js";
import { runGame, warmPool } from "./simPool.js";

const PORT = 8787;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(json);
}

const routes: Record<string, (body: any) => unknown> = {
  "/pool": () => loadPlayerPool(),
  ...createRoutes(runGame),
};

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  const path = (req.url ?? "/").split("?")[0]!;
  const handler = routes[path];
  if (!handler || req.method !== "POST") {
    send(res, 404, { error: `no route for ${req.method} ${path}` });
    return;
  }
  readJson(req)
    .then(async (body) => {
      const result = await handler(body);
      send(res, 200, result);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`adapter: ${path} failed:`, err);
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
});

server.listen(PORT, () => {
  warmPool();
  // eslint-disable-next-line no-console
  console.log(`nfl-franchise-sim adapter listening on http://localhost:${PORT}`);
});
