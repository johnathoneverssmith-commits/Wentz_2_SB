import type { LeagueState } from "@/domain";

import { FIRST_BLOCK_LAST_WEEK, PRESEASON_WEEKS, REGULAR_SEASON_WEEKS } from "./stageMachine";

/**
 * The precomputed blocks, and what sits at the end of each one.
 *
 * A block runs from a checkpoint to the next thing that can change its
 * inputs. That is the whole rule, and it is why the regular season is two
 * blocks rather than one: the trade deadline moves players, and a block
 * simulated past it would have been played with rosters that no longer exist
 * by the time anybody watched it.
 *
 * Every screen that asks "how far can I watch" and "what happens when I get
 * there" asks here, so the answer cannot differ between the button, the
 * progress line and the checkpoint.
 */
export interface Block {
  phase: "PRE" | "REG";
  firstWeek: number;
  lastWeek: number;
  /** What the "watch everything left" button says. */
  watchAllLabel: string;
  /** The individual, irreversible control at the end of the block. */
  advanceLabel: string;
  /** Checkpoint copy, once they press it. */
  checkpoint: { from: string; to: string };
}

const PRESEASON: Block = {
  phase: "PRE",
  firstWeek: 1,
  lastWeek: PRESEASON_WEEKS,
  watchAllLabel: "Simulate the preseason",
  advanceLabel: "Advance to Regular Season",
  checkpoint: { from: "Preseason", to: "Regular Season" },
};

const FIRST_HALF: Block = {
  phase: "REG",
  firstWeek: 1,
  lastWeek: FIRST_BLOCK_LAST_WEEK,
  watchAllLabel: `Simulate to Week ${FIRST_BLOCK_LAST_WEEK + 1}`,
  advanceLabel: "Advance to Trade Deadline",
  checkpoint: { from: `Regular Season Weeks 1–${FIRST_BLOCK_LAST_WEEK}`, to: "Trade Deadline" },
};

const SECOND_HALF: Block = {
  phase: "REG",
  firstWeek: FIRST_BLOCK_LAST_WEEK + 1,
  lastWeek: REGULAR_SEASON_WEEKS,
  watchAllLabel: "Simulate to the playoffs",
  advanceLabel: "Advance to Playoffs",
  checkpoint: { from: "Regular Season", to: "Playoffs" },
};

/**
 * Which block this league is in.
 *
 * The regular season splits on whether week ten has been played rather than
 * on a stage field, because the stage is `regularSeason` on both sides of the
 * deadline — the deadline is a stage of its own that the league passes
 * through, and it leaves the week behind it as the only durable marker.
 */
export function currentBlock(s: LeagueState): Block | null {
  if (s.stage === "preseason") return PRESEASON;
  if (s.stage !== "regularSeason") return null;
  const pastDeadline = s.games.some(
    (g) => g.phase === "REG" && g.played && g.week > FIRST_BLOCK_LAST_WEEK,
  );
  return pastDeadline ? SECOND_HALF : FIRST_HALF;
}
