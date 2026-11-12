/**
 * One week of franchise games, as the request body describes it: the seed
 * derivation, and the mapping from a franchise's rosters, depth charts,
 * staffs and plans onto each game's input. Shared by the local adapter and
 * any other host (issue #74 Phase 3); the host supplies only how a game is run.
 */
import type { DepthOrder } from "../engine/roster.js";
import type { GamePlan } from "../engine/gameplan.js";
import type { Staff } from "../engine/staff.js";
import type { Player } from "../schema/player.js";
import type { GameInput, simulateOne } from "./game.js";

export type GameResult = ReturnType<typeof simulateOne>;
/** Plays one game: inline (`simulateOne`) or on a worker. */
export type GameRunner = (input: GameInput) => Promise<GameResult> | GameResult;

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface SimulateWeekBody {
  seed: number;
  season?: number;
  week: number;
  phase: "PRE" | "REG";
  games: { homeTeam: string; awayTeam: string }[];
  /** the slate's viewer game, if any — gets the full broadcast/gamecast trace. */
  viewer?: { homeTeam: string; awayTeam: string } | null;
  /** team code -> that team's depth chart (position -> player ids, starter first). */
  depthCharts?: Record<string, DepthOrder>;
  /** team code -> that franchise's current players, for roster injection. */
  rosters?: Record<string, Player[]>;
  /** the league's talent-impact scale (`Game.talent`); omitted = 1, the validated engine */
  talentScale?: number;
  offenseAdjust?: number;
  /**
   * team code -> the HC/OC/DC that franchise employs. Without them the
   * engine's coaching layer never ran in a franchise game at all.
   */
  staffs?: Record<string, Staff>;
  /** team code -> its game plan (`src/engine/gameplan.ts`) */
  plans?: Record<string, GamePlan>;
}

export function simulateWeek(body: SimulateWeekBody, run: GameRunner): Promise<GameResult[]> {
  const { seed, season, week, phase, games, viewer, rosters, depthCharts, talentScale, staffs, offenseAdjust, plans } = body;
  // `run` plays one game: the adapter hands each to a worker thread (`server/simPool.ts`),
  // anything else can run `simulateOne` inline. Same seeds, same games, either way.
  return Promise.all(
    games.map(({ homeTeam, awayTeam }) =>
      run({
        gameSeed: hashStr(`${seed}|${week}|${phase}|${homeTeam}|${awayTeam}`),
        season,
        week,
        phase,
        homeTeam,
        awayTeam,
        isViewer: !!viewer && viewer.homeTeam === homeTeam && viewer.awayTeam === awayTeam,
        homePlayers: rosters?.[homeTeam],
        awayPlayers: rosters?.[awayTeam],
        homeDepth: depthCharts?.[homeTeam],
        awayDepth: depthCharts?.[awayTeam],
        talentScale,
        offenseAdjust,
        homeStaff: staffs?.[homeTeam],
        awayStaff: staffs?.[awayTeam],
        homePlan: plans?.[homeTeam],
        awayPlan: plans?.[awayTeam],
      }),
    ),
  );
}
