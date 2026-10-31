import type { LeagueConfig, LeagueState } from "@/domain";
import { ERAS } from "@/sim/leagueDna";

/**
 * The three ways a new league's players can come into being. A universe is
 * chosen when the league is created and never changes afterwards.
 *
 * - `legacy`: the shipped real-player pool.
 * - `fictional`: original players from the seed alone (League DNA).
 * - `era`: the same fictional generator, with its position-group strengths
 *   leaned toward a documented NFL era's emphasis. It is an analogy: nobody
 *   here is a historical player and no historical rating is reproduced.
 */
export type UniverseKind = "legacy" | "fictional" | "era";

export interface UniverseChoice {
  kind: UniverseKind;
  /** an `ERAS` id; read only for `kind: "era"` */
  eraId?: string;
}

export const MAX_SEED = 4294967295;

export const UNIVERSE_LABEL: Record<UniverseKind, string> = {
  legacy: "Legacy real-player universe",
  fictional: "Fully fictional universe",
  era: "Fictional universe, era-conditioned",
};

export const UNIVERSE_HINT: Record<UniverseKind, string> = {
  legacy: "The original shipped pool of real players on their real teams. Fixed: the seed only shuffles the draft and schedule luck.",
  fictional: "Every player is invented from the league seed. The same seed always makes the same league.",
  era: "Invented players, with position groups leaned toward a historical NFL era's emphasis (for example a passing boom). An analogy for flavor, not a reproduction of that season's players or ratings.",
};

export const DEFAULT_ERA_ID = "2011";

/** The config fields a universe sets. Always sets both, so switching away from an era clears it. */
export function universePatch(choice: UniverseChoice): Pick<LeagueConfig, "playerPool" | "leagueEra"> {
  if (choice.kind === "legacy") return { playerPool: "legacy", leagueEra: undefined };
  if (choice.kind === "fictional") return { playerPool: "fictional", leagueEra: undefined };
  const id = ERAS.some((e) => e.id === choice.eraId) ? choice.eraId : DEFAULT_ERA_ID;
  return { playerPool: "fictional", leagueEra: id };
}

export function universeOf(config: Pick<LeagueConfig, "playerPool" | "leagueEra">): UniverseChoice {
  if (config.playerPool === "legacy") return { kind: "legacy" };
  if (config.leagueEra && ERAS.some((e) => e.id === config.leagueEra)) return { kind: "era", eraId: config.leagueEra };
  return { kind: "fictional" };
}

/** A short plain-language description of a running league's universe, for the setup summary. */
export function describeUniverse(state: Pick<LeagueState, "config" | "dna">): string {
  const u = universeOf(state.config);
  if (u.kind === "legacy") return UNIVERSE_LABEL.legacy;
  if (u.kind === "era") {
    const era = ERAS.find((e) => e.id === u.eraId);
    return `Fictional, ${era?.title ?? "era"}-conditioned`;
  }
  return UNIVERSE_LABEL.fictional;
}

/** A fresh seed for "random seed". Injectable so tests are deterministic. */
export function randomSeed(rand: () => number = Math.random): number {
  return Math.floor(rand() * 1_000_000_000);
}
