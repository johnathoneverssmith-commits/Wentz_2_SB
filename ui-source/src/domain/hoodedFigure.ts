/**
 * The Hooded Figure catch-up mechanic (11_HOODED_FIGURE_FINAL_IMPLEMENTATION_SPEC.md).
 *
 * A rare, dark-comedy catch-up offer for a human-controlled team stuck losing
 * two seasons running: pay a hooded stranger from the cap, and — usually —
 * something happens to a rival CPU team; sometimes it's you who improves;
 * sometimes you were swindled. Fully deterministic once committed: the same
 * league state always resolves the same way, so a reload can never reroll it.
 */
import type { Position } from "./player.ts";

export type HoodedFigureTier = 1 | 2 | 3 | 4;
export type HoodedFigureBranch = "positive" | "negative" | "swindle";

export interface HoodedFigureThresholds {
  t1: number;
  t2: number;
  t3: number;
}

/** One player's before/after, for a positive outcome. */
export interface HoodedFigurePlayerChange {
  playerId: string;
  name: string;
  position: string;
  before: number;
  after: number;
}

/** One player named in a negative outcome (never a human team's player). */
export interface HoodedFigureNegativePlayer {
  playerId: string;
  name: string;
  position: string;
  overall: number;
}

export type HoodedFigurePositiveFamily =
  | "position_group_boost"
  | "rookie_rapid_development"
  | "veteran_renaissance"
  | "whole_roster_breakthrough";

export interface HoodedFigureOutcome {
  eventId: string;
  publicText: string;
  /** positive: which family produced this outcome. */
  family?: HoodedFigurePositiveFamily;
  positionGroup?: Position | string;
  playerChanges?: HoodedFigurePlayerChange[];
  /** negative: who it happened to. */
  targetTeam?: string;
  negativePlayers?: HoodedFigureNegativePlayer[];
  /** null = out for the rest of the season. */
  absenceWeeks?: number | null;
  coachFired?: boolean;
  wholeRosterOut?: boolean;
}

export interface HoodedFigureEncounter {
  teamCode: string;
  season: number;
  thresholds: HoodedFigureThresholds;
  /** 0 = never resolved / not yet acted on. */
  payment: number;
  resolved: boolean;
  swindle: boolean;
  branch: HoodedFigureBranch | null;
  tier: HoodedFigureTier | null;
  outcome: HoodedFigureOutcome | null;
}

/** A temporary, non-injury unavailability caused by a bargain's negative branch. */
export interface HoodedFigureUnavailability {
  playerId: string;
  /** null = out for the remainder of the season. */
  untilWeek: number | null;
}

export interface HoodedFigureLeagueState {
  /** Consecutive losing-season count per human-controlled team code. */
  losingStreaks: Record<string, number>;
  /** League-wide: whether the first successful (non-swindle) bargain has been forced negative yet. */
  firstNegativeConsumed: boolean;
  /** season -> teamCode -> encounter. */
  encountersBySeason: Record<number, Record<string, HoodedFigureEncounter>>;
  /** Players currently sidelined by a resolved bargain's negative branch. */
  unavailable: HoodedFigureUnavailability[];
}
