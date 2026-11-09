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
/** What a step asks for: the dynasty's fixed simulator, or `"ask"` for an old save that has not got one yet. */
export type EngineRequest = EngineMode | "ask";

export class EngineUnavailableError extends Error {
  readonly code = "ENGINE_UNAVAILABLE";
  /** an old save with no recorded simulator: the player must pick Retry or the Mock explicitly */
  readonly undecided: boolean;
  constructor(readonly what: string, cause?: unknown, undecided = false) {
    super(
      `The simulation engine isn't reachable (${what}). Nothing was played or changed; your dynasty is saved as it was. ` +
        `Start the engine (npm run server), then press Retry.`,
    );
    this.name = "EngineUnavailableError";
    this.undecided = undecided;
    if (cause !== undefined) this.cause = cause;
  }
}

export const isEngineUnavailable = (e: unknown): e is EngineUnavailableError =>
  e instanceof EngineUnavailableError || (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENGINE_UNAVAILABLE");

/**
 * The simulator a save belongs to, or `undefined` when it has not decided yet.
 *
 * Saves from before this field existed are inferred from what they already played: the engine stamps every
 * game with its weather and the Mock never does. A save that has played nothing yet is undecided: it uses the
 * engine if it answers (and records that), but if it does not, play stops and the player chooses — it is never
 * quietly given to the Mock.
 */
export function engineOf(s: Pick<LeagueState, "simEngine" | "games"> & { gameArchive?: LeagueState["gameArchive"] }): EngineMode | undefined {
  if (s.simEngine) return s.simEngine;
  // preseason games count: the engine stamps them with weather too, the Mock never does
  const played = [...(s.games ?? []), ...(s.gameArchive ?? [])].filter((g) => g.played);
  if (played.length === 0) return undefined;
  return played.some((g) => g.weather) ? "engine" : "mock";
}

export const engineLabel = (m: EngineMode | undefined): string =>
  m === "engine" ? "Real engine" : m === "mock" ? "Mock simulation (not the real engine)" : "Simulator not chosen yet";
