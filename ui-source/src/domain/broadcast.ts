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
}
