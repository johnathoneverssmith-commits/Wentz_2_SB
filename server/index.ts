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
import { broadcastGame } from "../src/engine/broadcast.js";
import type { Conference } from "../src/engine/nfl-structure.js";
import {
  playPlayoffRound,
  startPlayoffs,
  type PlayoffProgress,
} from "../src/engine/playoffs.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { Roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { allStaffs } from "../src/engine/staff-data.js";
import {
  defSchemeFitShift,
  offSchemeFitShift,
  schemeFitBaseline,
} from "../src/engine/staff-fit.js";
import { generateCoachMarket } from "../src/engine/staff-market.js";
import {
  computeStandings,
  type ConferenceSeeding,
  type FinishedGame,
} from "../src/engine/standings.js";
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

interface PlayoffRoundBody {
  seed: number;
  seeding: { AFC: ConferenceSeeding; NFC: ConferenceSeeding };
  /** how many rounds have already been played, before this call plays the next one. */
  roundsPlayed: number;
}

/**
 * Stateless round stepper: `playPlayoffRound` is pure and each round's RNG
 * seed is a fixed offset of the base `seed` (see playoffs.ts), so replaying
 * from `startPlayoffs` up through `roundsPlayed` reproduces the exact same
 * earlier rounds every time — no server-side bracket state to keep or lose.
 * Also previews the *next* round's pairing (home/away/seeds only, no score)
 * by playing one round further and discarding the result, so the UI can show
 * "who's up next" before that round is actually played — same two-step
 * seed-then-play flow the UI's bracket screen already expects.
 */
function handlePlayoffRound(body: PlayoffRoundBody) {
  const seeding = body.seeding as Record<Conference, ConferenceSeeding>;
  let p: PlayoffProgress = startPlayoffs(body.seed, seeding);
  for (let i = 0; i < body.roundsPlayed; i++) p = playPlayoffRound(p).progress;
  const { progress, games } = playPlayoffRound(p);

  let nextRoundPreview: { conference: string; home: string; away: string; homeSeed: number; awaySeed: number }[] | null = null;
  if (progress.nextRound !== "done") {
    const preview = playPlayoffRound(progress).games;
    nextRoundPreview = preview.map((g) => ({
      conference: g.conference,
      home: g.home,
      away: g.away,
      homeSeed: g.homeSeed,
      awaySeed: g.awaySeed,
    }));
  }
  const done = progress.nextRound === "done";
  return { games, nextRoundPreview, done, champion: done ? games[games.length - 1]!.winner : null };
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
