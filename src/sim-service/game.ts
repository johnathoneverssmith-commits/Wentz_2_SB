/**
 * One franchise game, start to finish: simulate, then map it onto the shapes
 * the UI reads. Pure — a function of its input — so it runs identically on
 * the main thread, in a Node worker (`server/simPool.ts`) or, later, a browser
 * worker. Shared by the local adapter and the online server (issue #74 Phase 3);
 * `server/simGame.ts` re-exports it for the paths that predate the move.
 */
import { extractBoxScore } from "../engine/boxscore.js";
import { broadcastGame } from "../engine/broadcast.js";
import { Roster, type DepthOrder } from "../engine/roster.js";
import type { GamePlan } from "../engine/gameplan.js";
import { type Game, simulateGame } from "../engine/sim.js";
import { describeWeather, type Weather, weatherFor } from "../engine/weather.js";
import type { Staff } from "../engine/staff.js";
import type { Player } from "../schema/player.js";
import { playerLinesFrom, quarterScores, scoringPlaysFrom, toTeamTotals } from "./boxscore-map.js";

export interface GameInput {
  gameSeed: number;
  season?: number | undefined;
  week: number;
  phase: string;
  homeTeam: string;
  awayTeam: string;
  isViewer: boolean;
  homePlayers?: Player[] | undefined;
  awayPlayers?: Player[] | undefined;
  homeDepth?: DepthOrder | undefined;
  awayDepth?: DepthOrder | undefined;
  talentScale?: number | undefined;
  offenseAdjust?: number | undefined;
  homeStaff?: Staff | undefined;
  awayStaff?: Staff | undefined;
  /** the two teams' game plans (`src/engine/gameplan.ts`); omitted plays the default */
  homePlan?: GamePlan | undefined;
  awayPlan?: GamePlan | undefined;
}

/** A `Roster` from a franchise's current players for one team, if given. */
export const rosterFrom = (team: string, players: Player[] | undefined, order?: DepthOrder): Roster | undefined =>
  players && players.length ? new Roster(team, players, order) : undefined;

/**
 * The box-score part of a finished game: team totals, scoring plays and
 * player lines. The one place a game becomes these, for the local adapter
 * (`presentGame`), playoff games, and the online server (`online/src/boxscore.ts`)
 * alike, so a single-player and an online game can't be presented differently.
 */
export function boxScoreParts(
  g: Game,
  home: string,
  away: string,
  week: number,
  players?: Record<string, Player[]> | undefined,
) {
  const trace = g.playTrace ?? [];
  const box = extractBoxScore(g, home, away, week);
  const finalScore: [number, number] = [g.score[0], g.score[1]];
  const byQuarter = quarterScores(trace, finalScore, g.drivesLog, g.eventLog ?? undefined);
  return {
    totals: {
      home: toTeamTotals(box.home, byQuarter[0]!, g.drivesLog.filter((d) => d.team === 0)),
      away: toTeamTotals(box.away, byQuarter[1]!, g.drivesLog.filter((d) => d.team === 1)),
    },
    scoringPlays: scoringPlaysFrom(trace, home, away, finalScore, g.drivesLog, g.eventLog ?? undefined),
    playerLines: playerLinesFrom(trace, home, away, players),
  };
}

/**
 * A finished game as the UI keeps it: team totals, scoring plays, player
 * lines, injuries and the weather. A regular-season week and a playoff game
 * (`playoffs.ts`) both come through here.
 */
export function presentGame(
  g: Game,
  o: {
    homeTeam: string;
    awayTeam: string;
    week: number;
    weather: Weather | null | undefined;
    players?: Record<string, Player[]> | undefined;
  },
) {
  return {
    ...boxScoreParts(g, o.homeTeam, o.awayTeam, o.week, o.players),
    injuries: g.injuryLog ?? [],
    weather: describeWeather(o.weather),
  };
}

export function simulateOne(i: GameInput) {
  const { gameSeed, season, week, phase, homeTeam, awayTeam, talentScale } = i;
  const homeRoster = rosterFrom(homeTeam, i.homePlayers, i.homeDepth);
  const awayRoster = rosterFrom(awayTeam, i.awayPlayers, i.awayDepth);
  // Every game is traced, so the UI gets a real box score and real season
  // stats for the whole league rather than a bare score. `injuries` is on
  // for all of them too, and deliberately so: the injury hazard draws from
  // the same RNG stream, so a game simulated with it off is a *different*
  // game. The engine takes a staff pair or none — a game with only one side's
  // coaches would hand that side the whole coaching layer.
  const staffPair = i.homeStaff && i.awayStaff ? { homeStaff: i.homeStaff, awayStaff: i.awayStaff } : {};
  const weather = weatherFor(homeTeam, phase, week, gameSeed);
  const plans = { homePlan: i.homePlan, awayPlan: i.awayPlan };
  const opts = { homeRoster, awayRoster, trace: true, injuries: true, talentScale, offenseAdjust: i.offenseAdjust, overtime: "nfl", weather, ...plans, ...staffPair } as const;
  const g = simulateGame(gameSeed, homeTeam, awayTeam, opts);
  const base = {
    id: `${season ?? "s"}-${phase}-${week}-${homeTeam}-${awayTeam}`,
    week,
    phase,
    homeTeam,
    awayTeam,
    played: true,
    homeScore: g.score[0],
    awayScore: g.score[1],
    ...presentGame(g, {
      homeTeam,
      awayTeam,
      week,
      weather,
      players:
        i.homePlayers || i.awayPlayers
          ? { [homeTeam]: i.homePlayers ?? [], [awayTeam]: i.awayPlayers ?? [] }
          : undefined,
    }),
  };
  // the viewer's game also gets the play-by-play view; same seed and same
  // options, so it is the same simulated game as the box score above
  return i.isViewer
    ? {
        ...base,
        broadcast: broadcastGame(gameSeed, homeTeam, awayTeam, {
          homeRoster,
          awayRoster,
          talentScale,
          offenseAdjust: i.offenseAdjust,
          overtime: "nfl",
          weather,
          ...plans,
          ...staffPair,
        }),
      }
    : base;
}
