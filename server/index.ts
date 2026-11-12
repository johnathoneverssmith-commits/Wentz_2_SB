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
import { nflSchedule } from "../src/engine/schedule.js";
import { Roster, type DepthOrder } from "../src/engine/roster.js";
import type { GamePlan } from "../src/engine/gameplan.js";
import type { Staff } from "../src/engine/staff.js";
import { allStaffs } from "../src/engine/staff-data.js";
import {
  defSchemeFitShift,
  offSchemeFitShift,
  schemeFitBaseline,
} from "../src/engine/staff-fit.js";
import { generateCoachMarket } from "../src/engine/staff-market.js";
import { computeStandings, type FinishedGame } from "../src/engine/standings.js";
import type { Player } from "../src/schema/player.js";
import { handlePlayoffGame, handlePlayoffRound, hashStr, simulateWeek } from "../src/sim-service/index.js";
import { runGame, warmPool } from "./simPool.js";
import { previewPlan } from "../src/engine/plan-preview.js";
import { cleanPlan } from "../src/engine/gameplan.js";
import { weatherFor } from "../src/engine/weather.js";

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
  "/schedule": (body: { year?: number }) =>
    nflSchedule(body.year !== undefined ? { year: body.year } : {}).map((g) => ({
      week: g.week,
      phase: "REG" as const,
      homeTeam: g.home,
      awayTeam: g.away,
    })),
  "/simulate-week": (body: Parameters<typeof simulateWeek>[0]) => simulateWeek(body, runGame),
  // the preseason lab (`src/engine/plan-preview.ts`): one game, played both ways
  "/plan-preview": (b: {
    seed: number;
    phase: "PRE" | "REG";
    week: number;
    homeTeam: string;
    awayTeam: string;
    side: "home" | "away";
    plan: Partial<GamePlan>;
    homePlayers?: Player[];
    awayPlayers?: Player[];
    homeDepth?: DepthOrder;
    awayDepth?: DepthOrder;
    talentScale?: number;
    offenseAdjust?: number;
    homeStaff?: Staff;
    awayStaff?: Staff;
    homePlan?: GamePlan;
    awayPlan?: GamePlan;
  }) => {
    const seed = hashStr(`${b.seed}|${b.phase}|${b.week}|${b.homeTeam}|${b.awayTeam}|preview`);
    const roster = (team: string, players?: Player[], order?: DepthOrder) =>
      players && players.length ? new Roster(team, players, order) : undefined;
    return previewPlan(
      seed,
      b.homeTeam,
      b.awayTeam,
      {
        homeRoster: roster(b.homeTeam, b.homePlayers, b.homeDepth),
        awayRoster: roster(b.awayTeam, b.awayPlayers, b.awayDepth),
        talentScale: b.talentScale,
        offenseAdjust: b.offenseAdjust,
        overtime: "nfl",
        weather: weatherFor(b.homeTeam, b.phase, b.week, seed),
        homePlan: b.homePlan,
        awayPlan: b.awayPlan,
        ...(b.homeStaff && b.awayStaff ? { homeStaff: b.homeStaff, awayStaff: b.awayStaff } : {}),
      },
      b.side,
      cleanPlan(b.plan),
    );
  },
  "/coach-market": (body: { seed: number }) => {
    // the real 32 current staffs (96 coaches) — all free agents in this
    // game's design (every league starts with 0 coaches employed) but
    // tagged with `previousTeam` as a real-world hint — plus a
    // distribution-matched pool of generated candidates for real depth.
    const real = Object.entries(allStaffs()).flatMap(([team, staff]) => [
      { role: "HC" as const, previousTeam: team, ...staff.headCoach },
      { role: "OC" as const, previousTeam: team, ...staff.oc },
      { role: "DC" as const, previousTeam: team, ...staff.dc },
    ]);
    const generated = generateCoachMarket(body.seed, { hc: 8, oc: 10, dc: 10 });
    return { real, generated };
  },
  "/scheme-fit-baseline": () => {
    const baseline = schemeFitBaseline();
    return {
      baseline,
      // pure per-unit shift functions are re-derived client-side from this
      // baseline — see HybridSimulationService.computeSchemeFit.
      sample: {
        offWestCoast: offSchemeFitShift("west_coast", []),
        defFourThree: defSchemeFitShift("four_three", []),
      },
    };
  },
  "/playoffs/seed": (body: { games: FinishedGame[] }) => {
    const standings = computeStandings(body.games);
    return { AFC: standings.seeding.AFC, NFC: standings.seeding.NFC };
  },
  "/playoffs/round": handlePlayoffRound,
  "/playoffs/game": handlePlayoffGame,
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
