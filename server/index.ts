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
 * request), the real-roster pool, and scheme-fit. Draft classes, the coach
 * market, trade valuation, retirement, and the playoff bracket stay on the
 * UI's MockSimulationService for now (no calibrated engine model yet for the
 * first four; the bracket's seeding/shape doesn't map onto this engine's
 * standings structure without more plumbing than this pass covers) — see
 * `ui-source/NOTES.md` and `HybridSimulationService.ts` for the boundary.
 *
 *   npm run server            # http://localhost:8787
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { loadPlayerPool } from "../src/data/players.js";
import { broadcastGame } from "../src/engine/broadcast.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { Roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import {
  defSchemeFitShift,
  offSchemeFitShift,
  schemeFitBaseline,
} from "../src/engine/staff-fit.js";
import type { Player } from "../src/schema/player.js";

const PORT = 8787;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

/** Build a `Roster` from a franchise's current players for one team, if given. */
function rosterFrom(team: string, players: Player[] | undefined): Roster | undefined {
  return players && players.length ? new Roster(team, players) : undefined;
}

interface SimulateWeekBody {
  seed: number;
  season?: number;
  week: number;
  phase: "PRE" | "REG";
  games: { homeTeam: string; awayTeam: string }[];
  /** the slate's viewer game, if any — gets the full broadcast/gamecast trace. */
  viewer?: { homeTeam: string; awayTeam: string } | null;
  /** team code -> that franchise's current players, for roster injection. */
  rosters?: Record<string, Player[]>;
}

function handleSimulateWeek(body: SimulateWeekBody) {
  const { seed, season, week, phase, games, viewer, rosters } = body;
  return games.map(({ homeTeam, awayTeam }) => {
    const gameSeed = hashStr(`${seed}|${week}|${phase}|${homeTeam}|${awayTeam}`);
    const homeRoster = rosterFrom(homeTeam, rosters?.[homeTeam]);
    const awayRoster = rosterFrom(awayTeam, rosters?.[awayTeam]);
    const isViewer =
      viewer && viewer.homeTeam === homeTeam && viewer.awayTeam === awayTeam;

    const id = `${season ?? "s"}-${phase}-${week}-${homeTeam}-${awayTeam}`;
    if (isViewer) {
      const b = broadcastGame(gameSeed, homeTeam, awayTeam, { homeRoster, awayRoster });
      return {
        id,
        week,
        phase,
        homeTeam,
        awayTeam,
        played: true,
        homeScore: b.finalScore[0],
        awayScore: b.finalScore[1],
        broadcast: b,
      };
    }
    const g = simulateGame(gameSeed, homeTeam, awayTeam, { homeRoster, awayRoster });
    return {
      id,
      week,
      phase,
      homeTeam,
      awayTeam,
      played: true,
      homeScore: g.score[0],
      awayScore: g.score[1],
    };
  });
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
  "/simulate-week": handleSimulateWeek,
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
    .then((body) => {
      const result = handler(body);
      send(res, 200, result);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`adapter: ${path} failed:`, err);
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`nfl-franchise-sim adapter listening on http://localhost:${PORT}`);
});
