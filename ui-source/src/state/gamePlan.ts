import { cleanPlan, DEFAULT_PLAN, type GamePlan } from "../../../src/engine/gameplan.js";
import type { LeagueState } from "@/domain";

import { type AiSeasonStrategy, strategyFor } from "./aiStrategy.ts";

export { cleanPlan, DEFAULT_PLAN, isDefaultPlan, type GamePlan } from "../../../src/engine/gameplan.js";

/**
 * The plan a CPU team plays with: its GM's philosophy, as football.
 *
 * The strategies already say what kind of roster each AI GM wants; this is the
 * same personality on the field. Small and deterministic (a team's strategy is
 * a hash of team and season), so no state and no reroll on reload.
 */
const AI_PLANS: Record<AiSeasonStrategy, Partial<GamePlan>> = {
  balanced: {},
  offense_heavy: { passRate: 3, fourthOpp: 20, fourthRedZone: 15 },
  defense_heavy: { blitz: 30, fourthOwn: -25 },
  pass_heavy: { passRate: 8, p11: 72, p12: 22, p13: 6, rbCommittee: 40 },
  run_heavy: { passRate: -8, p11: 46, p12: 38, p13: 16, rbCommittee: 20 },
  high_floor: { fourthRedZone: -25, fourthOpp: -25, fourthOwn: -40, blitz: -10 },
  high_ceiling: { fourthRedZone: 30, fourthOpp: 30, fourthOwn: 10, blitz: 20 },
  trenches_first: { passRate: -4, p11: 50, p12: 36, p13: 14, blitz: 10 },
};

export function aiGamePlan(teamCode: string, season: number): GamePlan {
  return cleanPlan(AI_PLANS[strategyFor(teamCode, season)]);
}

/** A human GM's saved plan, or a CPU team's. */
export function gamePlanFor(s: Pick<LeagueState, "teams" | "gamePlans" | "season">, teamCode: string): GamePlan {
  const human = s.teams[teamCode]?.controlledBy.kind === "human";
  return human ? cleanPlan(s.gamePlans?.[teamCode] ?? DEFAULT_PLAN) : aiGamePlan(teamCode, s.season);
}

/** Every team's plan, for a simulation call. */
export function gamePlansFor(s: Pick<LeagueState, "teams" | "gamePlans" | "season">): Record<string, GamePlan> {
  return Object.fromEntries(Object.keys(s.teams).map((c) => [c, gamePlanFor(s, c)]));
}
