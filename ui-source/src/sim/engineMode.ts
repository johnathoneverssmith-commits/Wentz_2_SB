import type { LeagueState } from "@/domain";

/**
 * Which simulator a dynasty is played on. It is decided once, when the dynasty is created (or, for an old
 * save, inferred from its own games) and is then fixed for the life of the save:
 *
 * - `engine` — the real engine, through the adapter (`npm run server`). If the adapter is unreachable the game
 *   stops with an {@link EngineUnavailableError}; it never quietly plays on with the Mock.
 * - `mock`   — the built-in Mock simulator (the standalone build, or a dynasty begun with no adapter running).
 *   It never calls the adapter, so a dynasty cannot start on the Mock and later change to the engine either.
 */
export type EngineMode = "engine" | "mock";

export class EngineUnavailableError extends Error {
  readonly code = "ENGINE_UNAVAILABLE";
  constructor(readonly what: string, cause?: unknown) {
    super(
      `The simulation engine isn't reachable (${what}). Nothing was played or changed; your dynasty is saved as it was. ` +
        `Start the engine (npm run server), then press Retry.`,
    );
    this.name = "EngineUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

export const isEngineUnavailable = (e: unknown): e is EngineUnavailableError =>
  e instanceof EngineUnavailableError || (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENGINE_UNAVAILABLE");

/**
 * The simulator a save belongs to, or `undefined` when it has not decided yet.
 *
 * Saves from before this field existed are inferred from what they already played: the engine stamps every
 * game with its weather and the Mock never does. A save that has played nothing yet is undecided, and takes
 * whichever simulator answers first (then keeps it).
 */
export function engineOf(s: Pick<LeagueState, "simEngine" | "games"> & { gameArchive?: LeagueState["gameArchive"] }): EngineMode | undefined {
  if (s.simEngine) return s.simEngine;
  const played = [...(s.games ?? []), ...(s.gameArchive ?? [])].filter((g) => g.played && g.phase !== "PRE");
  if (played.length === 0) return undefined;
  return played.some((g) => g.weather) ? "engine" : "mock";
}

export const engineLabel = (m: EngineMode | undefined): string =>
  m === "engine" ? "Real engine" : m === "mock" ? "Mock simulation (not the real engine)" : "Simulator not chosen yet";
