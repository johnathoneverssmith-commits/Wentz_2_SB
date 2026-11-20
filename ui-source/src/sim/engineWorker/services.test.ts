import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSimWorker, DEFAULT_POOL } from "../../../../scripts/build-sim-worker.ts";
import { setReferencePool } from "../../../../src/engine/roster.ts";
import { simulateOne } from "../../../../src/sim-service/game.ts";
import { createRoutes } from "../../../../src/sim-service/routes.ts";
import { HttpSimulationService, type Transport } from "../HttpSimulationService.ts";
import { HybridSimulationService } from "../HybridSimulationService.ts";
import { EngineUnavailableError } from "../engineMode.ts";
import { EngineWorkerClient } from "./client.ts";
import { workerTransport } from "./transport.ts";
import { BASE, FakeCacheStorage, FakeSite, FakeWorker } from "./testkit.ts";

/**
 * Issue #74 Phase 5: the UI's simulation services answer the same whether the engine is the local adapter or the
 * browser's Web Worker. The "adapter" here is the same routes run in this process on the same pool; the worker is
 * the real host behind a message boundary, started from the real build. Same code, so any difference is a bug in the
 * transport or in what the services do with an answer.
 */
let tmp = "";
let dir = "";
const pool = JSON.parse(readFileSync(DEFAULT_POOL, "utf8")) as { id: string; nfl_team: string }[];

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "engine-services-"));
  dir = join(tmp, "engine");
  await buildSimWorker(dir);
  setReferencePool(pool as never);
}, 60_000);
afterAll(() => {
  setReferencePool(null);
  rmSync(tmp, { recursive: true, force: true });
});

const routes = () => createRoutes((i) => simulateOne(i));
/** The adapter's answers, as they would be after a trip over HTTP. */
const inProcess: Transport = async (path, body) =>
  JSON.parse(JSON.stringify(path === "/pool" ? pool : await routes()[path]!(body))); // `/pool` is the host's own route

function browserEngine(site = new FakeSite(dir)) {
  const workers: FakeWorker[] = [];
  const client = new EngineWorkerClient({
    baseUrl: BASE,
    fetch: site.fetch,
    caches: new FakeCacheStorage() as unknown as CacheStorage,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  return { client, workers, site };
}

const playersOf = (t: string) => pool.filter((p) => p.nfl_team === t);

describe("HttpSimulationService over the browser engine", () => {
  it("answers every method it was given exactly as it does over the adapter's routes", async () => {
    const { client } = browserEngine();
    const viaWorker = new HttpSimulationService(workerTransport(client));
    const viaAdapter = new HttpSimulationService(inProcess);

    expect(await viaWorker.generateInitialPool()).toEqual(await viaAdapter.generateInitialPool());
    expect(await viaWorker.schemeFitBaseline()).toEqual(await viaAdapter.schemeFitBaseline());
    expect(await viaWorker.generateCoachMarket(7)).toEqual(await viaAdapter.generateCoachMarket(7));
    expect(await viaWorker.generateSchedule(2026)).toEqual(await viaAdapter.generateSchedule(2026));

    const teams = ["KC", "BUF", "SF", "DAL"];
    const week = (svc: HttpSimulationService) =>
      svc.simulateWeek(
        11, 2026, 3, "REG",
        [{ homeTeam: "KC", awayTeam: "BUF" }, { homeTeam: "SF", awayTeam: "DAL" }],
        Object.fromEntries(teams.map((t) => [t, playersOf(t) as never])),
        { homeTeam: "SF", awayTeam: "DAL" },
        {}, 1.5, {}, 0.5, {},
      );
    const w = await week(viaWorker);
    expect(w).toEqual(await week(viaAdapter));
    expect(w).toHaveLength(2);
    expect(w[1]!.broadcast).toBeTruthy(); // the viewer's game carries its play-by-play
    expect(w[0]!.broadcast).toBeFalsy();
    expect(w.every((g) => g.weather)).toBe(true); // the engine stamps every game with weather
  }, 120_000);
});

describe("HybridSimulationService on the browser engine", () => {
  it("builds a new dynasty from the worker: its answers are recorded as the real engine's", async () => {
    const { client, workers } = browserEngine();
    const hybrid = new HybridSimulationService({ http: new HttpSimulationService(workerTransport(client)) });
    const players = await hybrid.generateInitialPool(1, "realRosters");
    expect(players.length).toBe(pool.length);
    expect(hybrid.sourceOf("pool")).toBe("engine");
    await hybrid.generateCoachMarket(1);
    expect(hybrid.sourceOf("coach market")).toBe("engine");
    expect(workers).toHaveLength(1); // one engine for everything
  });

  it("a dynasty locked to the real engine never falls back to the Mock when the worker can't load, and says what to do", async () => {
    const site = new FakeSite(dir);
    site.fail = (p) => (p === "manifest.json" ? new Response("", { status: 503 }) : undefined);
    const { client } = browserEngine(site);
    const hybrid = new HybridSimulationService({ http: new HttpSimulationService(workerTransport(client)) });

    const e = await hybrid.generateSchedule(1, ["KC", "BUF"], "engine").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EngineUnavailableError);
    expect((e as Error).message).toMatch(/Retry/);
    expect((e as Error).message).not.toMatch(/npm run server/); // the adapter's advice would mislead here
    expect((e as Error).message).toMatch(/dynasty is saved as it was/);

    expect(await hybrid.engineReachable()).toBe(false);
    site.fail = null; // the network is back: Retry works without a reload
    expect(await hybrid.engineReachable()).toBe(true);
    await expect(hybrid.generateSchedule(1, ["KC", "BUF"], "engine")).resolves.toBeTruthy();
  });

  it("a brand-new dynasty with no engine available still starts, on the Mock, exactly as before", async () => {
    const site = new FakeSite(dir);
    site.fail = () => new TypeError("Failed to fetch");
    const { client } = browserEngine(site);
    const hybrid = new HybridSimulationService({ http: new HttpSimulationService(workerTransport(client)) });
    const players = await hybrid.generateInitialPool(1, "realRosters");
    expect(players.length).toBeGreaterThan(0);
    expect(hybrid.sourceOf("pool")).toBe("mock");
  });
});
