import type { LeagueState } from "@/domain";

import { simulateBlock, simulatePlayoffBlock } from "./blocks.js";

/**
 * A block of games to simulate: a stretch of weeks, or the whole postseason.
 *
 * Simulating a block is the one thing the server does that takes seconds
 * rather than milliseconds (weeks 1-9 are ~3.5s on a laptop, more on a small
 * host), and it used to run on the event loop — every other league's
 * requests, streams and heartbeats stood still while one league played its
 * season. Stage entry is synchronous and runs inside a transaction, so it
 * can't await anything; instead it describes the block here, and
 * `withLeague`, which can await, hands the description to a worker thread
 * before the transaction writes.
 *
 * Outside the server (tests, scripts, `onStageEntered` called directly) the
 * block runs on the spot, exactly as before.
 */
export type BlockJob =
  | { kind: "block"; phase: "PRE" | "REG"; from: number; to: number }
  | { kind: "playoffs" }
  /** one postseason round: the next checkpoint is when every GM is set for the one after */
  | { kind: "playoffRound" };

let deferring = false;
const pending = new WeakMap<LeagueState, BlockJob[]>();

/** The server turns this on at startup; nothing else should. */
export function deferBlockJobs(on: boolean): void {
  deferring = on;
}

export function runOrDefer(state: LeagueState, job: BlockJob): void {
  if (!deferring) {
    runBlockJob(state, job);
    return;
  }
  const list = pending.get(state);
  if (list) list.push(job);
  else pending.set(state, [job]);
}

export function takeBlockJobs(state: LeagueState): BlockJob[] {
  const list = pending.get(state) ?? [];
  pending.delete(state);
  return list;
}

export function runBlockJob(state: LeagueState, job: BlockJob): void {
  if (job.kind === "playoffs") simulatePlayoffBlock(state);
  else if (job.kind === "playoffRound") {
    simulatePlayoffBlock(state, 1);
    readyEliminated(state);
  }
  else simulateBlock(state, job.phase, job.from, job.to);
}

/**
 * A GM whose team is out has no next game to plan for, so they never hold
 * the league up: they stand ready for every round after their exit (the
 * final checkpoint, once there is a champion, waits for everybody again).
 */
export function readyEliminated(state: LeagueState): void {
  const b = state.bracket;
  if (!b || b.champion) return;
  const alive = new Set(
    b.matchups
      .filter((m) => m.round === b.currentRound && m.winner == null)
      .flatMap((m) => [m.highSeed?.code, m.lowSeed?.code])
      .filter((c): c is string => !!c),
  );
  for (const g of state.gms) {
    if (g.isHuman && g.teamCode && !alive.has(g.teamCode)) state.readiness[g.id] = true;
  }
}
