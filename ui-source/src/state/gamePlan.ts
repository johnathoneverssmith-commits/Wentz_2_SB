import { cleanPlan, DEFAULT_PLAN, type GamePlan, STRATEGY_PLANS } from "../../../src/engine/gameplan.js";
import type { LeagueState } from "@/domain";

import { type AiSeasonStrategy, strategyFor } from "./aiStrategy.ts";

export { cleanPlan, DEFAULT_PLAN, isDefaultPlan, rookieDevelopment, type GamePlan } from "../../../src/engine/gameplan.js";

/**
 * The plan a CPU team plays with: its GM's philosophy, as football.
 *
 * The strategies already say what kind of roster each AI GM wants; this is the
 * same personality on the field. Small and deterministic (a team's strategy is
 * a hash of team and season), so no state and no reroll on reload.
 */
export const AI_PLANS = STRATEGY_PLANS as Record<AiSeasonStrategy, Partial<GamePlan>>;

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
