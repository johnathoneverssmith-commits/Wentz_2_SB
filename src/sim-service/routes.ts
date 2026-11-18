/**
 * Every engine route the franchise UI calls, as plain functions of a request
 * body (issue #74 Phase 4). The local adapter (`server/index.ts`) serves them
 * over HTTP and the browser worker (`worker-host.ts`) over messages, so the two
 * cannot answer differently. Only `/pool` is the host's own: which players the
 * engine is running on is exactly what the host decides.
 *
 * `run` plays one game: a worker thread in the adapter, `simulateOne` inline
 * in a browser worker.
 */
import { cleanPlan } from "../engine/gameplan.js";
import type { GamePlan } from "../engine/gameplan.js";
import { previewPlan } from "../engine/plan-preview.js";
import { Roster, type DepthOrder } from "../engine/roster.js";
import { nflSchedule } from "../engine/schedule.js";
import { allStaffs } from "../engine/staff-data.js";
import { defSchemeFitShift, offSchemeFitShift, schemeFitBaseline } from "../engine/staff-fit.js";
import { generateCoachMarket } from "../engine/staff-market.js";
import type { Staff } from "../engine/staff.js";
import { computeStandings, type FinishedGame } from "../engine/standings.js";
import { weatherFor } from "../engine/weather.js";
import type { Player } from "../schema/player.js";
import { handlePlayoffGame, handlePlayoffRound } from "./playoffs.js";
import { hashStr, simulateWeek, type GameRunner } from "./week.js";

export type RouteHandler = (body: any) => unknown;

export function createRoutes(run: GameRunner): Record<string, RouteHandler> {
  return {
    "/schedule": (body: { year?: number }) =>
      nflSchedule(body.year !== undefined ? { year: body.year } : {}).map((g) => ({
        week: g.week,
        phase: "REG" as const,
        homeTeam: g.home,
        awayTeam: g.away,
      })),
    "/simulate-week": (body: Parameters<typeof simulateWeek>[0]) => simulateWeek(body, run),
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
}
