/**
 * Broadcast/gamecast view of a single game — a field-for-field mirror of
 * `nfl-franchise-sim/src/engine/broadcast.ts`'s `GameBroadcast` (and
 * `injury.ts`'s `InjuryEvent`), same pattern as `domain/player.ts` mirroring
 * the engine's `Player` schema. Populated by the adapter for one game per
 * `/simulate-week` request (the slate's viewer game) — see
 * `src/sim/HttpSimulationService.ts`.
 */

export type InjurySeverity = "minor" | "moderate" | "significant" | "severe" | "season";

export interface InjuryEvent {
  team: string;
  playerId: string;
  player: string;
  position: string;
  slot: string;
  quarter: number;
  clock: string;
  bodyPart: string;
  suspectedType: string;
  severity: InjurySeverity;
  /** [min, max] weeks. */
  projectedWeeks: [number, number];
  mechanism: string;
  onPlay: string;
  narrative: string;
  /** index into the originating play trace — used to attach to its exact play. */
  playIndex?: number;
}

/** Mirrors the engine's `ScoreEvent` (`src/engine/sim.ts`). */
export interface ScoreEvent {
  type: "score";
  side: 0 | 1;
  points: number;
  kind:
    | "touchdown"
    | "field_goal"
    | "extra_point"
    | "two_point"
    | "safety"
    | "interception_return_td"
    | "fumble_return_td"
    | "punt_return_td"
    | "kick_return_td";
  quarter: number;
  clock: string;
  playIndex: number | null;
  scorer?: string;
  scoreAfter: [number, number];
}

export interface BallState {
  down: number;
  ydstogo: number;
  yardline100: number;
}

/** Mirrors the engine's `PenaltyEvent`: an accepted foul, whose nullified play is not in the trace. */
export interface PenaltyEvent {
  type: "penalty";
  team: 0 | 1;
  onOffense: boolean;
  deadBall: boolean;
  bucket: string;
  yards: number;
  quarter: number;
  clock: string;
  beforePlayIndex: number;
  before: BallState;
  after: BallState;
  automaticFirstDown: boolean;
}

/** Mirrors the engine's `ClockPlayEvent`: a spike or kneel-down. */
export interface ClockPlayEvent {
  type: "spike" | "kneel";
  team: 0 | 1;
  quarter: number;
  clock: string;
  beforePlayIndex: number;
  down: number;
}

export interface BroadcastPlay {
  down: number;
  ydstogo: number;
  /** yards to the possessing team's target end zone, pre-snap. */
  ballOn: number;
  quarter: number;
  clock: string;
  call: "pass" | "run" | "sack" | "scramble" | "punt" | "field_goal";
  depth: string;
  gained: number;
  outcome: string;
  desc: string;
  firstDown: boolean;
  touchdown: boolean;
  turnover: boolean;
  passer?: string;
  targetOrRusher?: string;
  defender?: string;
  kicker?: string;
  returner?: string;
  distance?: number;
  injuries: InjuryEvent[];
  /** scores this play caused, from the engine's log (a return touchdown included). */
  scores?: ScoreEvent[];
  /** accepted penalties, spikes and kneels between the previous snap and this one. */
  eventsBefore?: (PenaltyEvent | ClockPlayEvent)[];
  /**
   * [home, away] once this play and anything it set off is over — the score
   * a replay should be showing while this play is on screen.
   */
  scoreAfter: [number, number];
}

export interface BroadcastDrive {
  team: string;
  side: "home" | "away";
  quarter: number;
  startClock: string;
  startBallOn: number;
  plays: BroadcastPlay[];
  ended:
    | "touchdown"
    | "turnover"
    | "field_goal"
    | "missed_field_goal"
    | "punt"
    | "punt_return_td"
    | "stalled";
  /** points this team scored on the drive, extra point included. */
  points: number;
  /** points the *other* team scored during it: a pick-six, a punt taken back. */
  pointsAgainst: number;
}

export interface GameBroadcast {
  home: string;
  away: string;
  finalScore: [number, number];
  drives: BroadcastDrive[];
  /** indices into `drives` that put points on the board. */
  scoringDrives: number[];
  /** every injury in the game, in play order (also attached to its own play). */
  injuries: InjuryEvent[];
  /** scores no traced play caused: a kickoff returned for a touchdown, and the kick after it. */
  returnScores?: ScoreEvent[];
}
