import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSimWorker } from "../scripts/build-sim-worker.js";
import { allStaffs } from "../src/engine/staff-data.js";
import { cleanPlan } from "../src/engine/gameplan.js";
import { loadPool, poolVersion, teamList } from "../src/engine/roster.js";
import { REQUIRED_ARTIFACTS } from "../src/engine/artifact-source.js";
import { createRoutes, simulateOne } from "../src/sim-service/index.js";
import type { HostRequest, HostResponse } from "../src/sim-service/index.js";
import type { Player } from "../src/schema/player.js";

/**
 * Issue #74 Phase 4: the browser simulation worker. The bundle is run in a
 * `vm` context that has no `process`, `require`, `Buffer` or `fs`, the way a
 * Web Worker's global scope has none, with the artifacts and the player pool
 * handed to it in a message. Every route must answer byte-for-byte what the
 * Node configuration (artifacts read from disk, default pool) answers: it is
 * the same code, so a difference means the bundle or the host changed
 * something. This runs on V8 only; other JS engines' `Math` is not covered.
 */
const pool = [...loadPool().values()].flat() as Player[];
const playersOf = (t: string): Player[] => [...(loadPool().get(t) ?? [])];

let outDir = "";
let built: Awaited<ReturnType<typeof buildSimWorker>>;
beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "sim-worker-"));
  built = await buildSimWorker(outDir);
});
afterAll(() => outDir && rmSync(outDir, { recursive: true, force: true }));

/** A worker scope: only what a Web Worker provides. */
function startWorker() {
  const inbox: HostResponse[] = [];
  const waiting: ((r: HostResponse) => void)[] = [];
  const scope: Record<string, unknown> = {
    postMessage: (m: HostResponse) => (waiting.shift() ?? ((r: HostResponse) => inbox.push(r)))(m),
    TextEncoder,
    TextDecoder,
    structuredClone,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };
  vm.createContext(scope);
  vm.runInContext(built.js, scope);
  let nextId = 1;
  const send = (req: DistributiveOmit<HostRequest, "id">): Promise<HostResponse> =>
    new Promise((resolve) => {
      waiting.push(resolve);
      (scope.onmessage as (e: { data: HostRequest }) => void)({ data: { ...req, id: nextId++ } as HostRequest });
    });
  return { scope, send };
}
type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

const init = (extra: Partial<Extract<HostRequest, { kind: "init" }>> = {}) =>
  ({ kind: "init", artifacts: built.artifacts, pool, ...extra }) as DistributiveOmit<HostRequest, "id">;

/** What the Node configuration answers, as the adapter would put it on the wire. */
const nodeAnswer = async (route: string, body: unknown): Promise<string> =>
  JSON.stringify(await createRoutes((i) => simulateOne(i))[route]!(body));

describe("the browser simulation worker bundle", () => {
  it("has nothing from Node in it and runs in a scope with no Node globals", () => {
    expect(built.js).not.toMatch(/node:(fs|path|url|crypto|module)/);
    const { scope } = startWorker();
    for (const g of ["process", "require", "Buffer", "module", "__dirname"]) expect(scope[g], g).toBeUndefined();
    expect(typeof scope.onmessage).toBe("function");
    expect(built.manifest.artifacts).toBe(REQUIRED_ARTIFACTS.length);
  });

  it("refuses work before init, and a pool of the wrong version, without installing anything", async () => {
    const { send } = startWorker();
    const early = await send({ kind: "call", route: "/schedule", body: {} });
    expect(early).toMatchObject({ ok: false, error: expect.stringMatching(/not initialised/) });

    const wrong = await send(init({ expectPoolVersion: "0".repeat(64) }));
    expect(wrong).toMatchObject({ ok: false, error: expect.stringMatching(/pool version mismatch/) });
    expect(await send({ kind: "call", route: "/schedule", body: {} })).toMatchObject({ ok: false });

    const right = await send(init({ expectPoolVersion: poolVersion(pool) }));
    expect(right.ok).toBe(true);
    expect(JSON.parse((right as { json: string }).json)).toMatchObject({ poolVersion: poolVersion(pool), players: pool.length });
  });

  it("an incomplete artifact set is refused naming the file, and the worker stays uninitialised", async () => {
    const { send } = startWorker();
    const { ["models/portable/M04.json"]: _gone, ...partial } = built.artifacts as Record<string, unknown>;
    const r = await send(init({ artifacts: partial }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/models\/portable\/M04\.json/) });
    expect(await send({ kind: "call", route: "/schedule", body: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/not initialised/) });
    expect((await send(init())).ok).toBe(true); // and a good init afterwards works
  });

  it("answers every route exactly as the Node configuration does", async () => {
    const { send } = startWorker();
    expect((await send(init())).ok).toBe(true);

    const teams = teamList();
    const games = [
      { homeTeam: teams[0]!, awayTeam: teams[1]! },
      { homeTeam: teams[2]!, awayTeam: teams[3]! },
    ];
    const four = games.flatMap((g) => [g.homeTeam, g.awayTeam]);
    const staffs = allStaffs();
    const plan = cleanPlan({ passRate: 8, fourthRedZone: 40, fourthOpp: 10, fourthOwn: -20, blitz: 30, p11: 60, p12: 30, p13: 10 });
    const mk = (seeds: string[]) => ({ seeds, divisionWinners: seeds.slice(0, 4), wildCards: seeds.slice(4), order: seeds });
    const t14 = teams.slice(0, 14);
    const seeding = { AFC: mk(t14.slice(0, 7)), NFC: mk(t14.slice(7)) };

    const calls: [string, unknown][] = [
      ["/schedule", { year: 2026 }],
      ["/simulate-week", { seed: 11, season: 2026, week: 3, phase: "REG", games, viewer: games[0] }],
      [
        "/simulate-week",
        {
          seed: 12, season: 2026, week: 5, phase: "REG", games, viewer: games[1], talentScale: 1.5, offenseAdjust: 0.5,
          rosters: Object.fromEntries(four.map((t) => [t, playersOf(t)])),
          depthCharts: { [four[0]!]: { QB: [playersOf(four[0]!).find((p) => p.position === "QB")!.id] } },
          staffs: Object.fromEntries(four.map((t) => [t, staffs[t]!])),
          plans: { [four[0]!]: plan, [four[3]!]: plan },
        },
      ],
      ["/simulate-week", { seed: 13, week: 2, phase: "PRE", games: [games[0]] }],
      ["/plan-preview", { seed: 41, phase: "REG", week: 4, homeTeam: four[0], awayTeam: four[1], side: "home", plan }],
      ["/coach-market", { seed: 7 }],
      ["/scheme-fit-baseline", {}],
      ["/playoffs/seed", { games: [{ week: 1, home: four[0], away: four[1], homeScore: 21, awayScore: 17 }, { week: 2, home: four[2], away: four[3], homeScore: 10, awayScore: 20 }] }],
      ["/playoffs/round", { seed: 21, seeding, roundsPlayed: 0, rosters: Object.fromEntries(t14.map((t) => [t, playersOf(t)])), viewerTeam: t14[0] }],
      ["/playoffs/game", { seed: 31, homeTeam: t14[0], awayTeam: t14[7], neutralSite: true, rosters: { [t14[0]!]: playersOf(t14[0]!), [t14[7]!]: playersOf(t14[7]!) }, viewerTeam: t14[0] }],
    ];
    for (const [route, body] of calls) {
      const got = await send({ kind: "call", route, body });
      expect(got.ok, `${route}: ${(got as { error?: string }).error}`).toBe(true);
      expect((got as { json: string }).json, route).toBe(await nodeAnswer(route, body));
    }

    // /pool is the host's own: it returns exactly the pool it was given
    const p = await send({ kind: "call", route: "/pool", body: {} });
    expect((p as { json: string }).json).toBe(JSON.stringify(pool));
    expect(await send({ kind: "call", route: "/nope", body: {} })).toMatchObject({ ok: false, error: "no route for /nope" });
  }, 120_000);
});
