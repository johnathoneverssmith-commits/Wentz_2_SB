import { createMatch, step, STEP_SECONDS, type Inputs, type MatchSnapshot } from "./simulation";

export interface Clock {
  readonly match: MatchSnapshot;
  readonly accumulator: number;
  readonly paused: boolean;
}
export function createClock(): Clock { return { match: createMatch(), accumulator: 0, paused: false }; }

/** At most 100ms of catch-up; a suspended tab never fast-forwards the drill. */
export function advance(clock: Clock, elapsed: number, inputs: Inputs): Clock {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("Elapsed time must be finite and nonnegative");
  if (clock.paused) return { ...clock, accumulator: 0 };
  let accumulator = clock.accumulator + Math.min(elapsed, 0.1);
  let match = clock.match;
  while (accumulator + 1e-10 >= STEP_SECONDS) {
    match = step(match, inputs);
    accumulator = Math.max(0, accumulator - STEP_SECONDS);
  }
  return { ...clock, match, accumulator };
}
