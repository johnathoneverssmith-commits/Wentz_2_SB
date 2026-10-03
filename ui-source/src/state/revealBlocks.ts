import type { LeagueState } from "@/domain";

import { seasonShape, type SeasonShape } from "./leagueFormat";

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
  /**
   * Which tab a multi-week results screen opens on.
   *
   * The first two blocks open on the newest week, because a GM who pressed
   * "watch the rest" wants the result they were waiting for. The run to the
   * playoffs opens on the oldest: nine weeks decide who is in, and reading
   * them out of order spoils the only part of the season with a shape.
   */
  resultsOpenOn: "first" | "last";
}

// Built from the league's own season shape: a humans-only round robin has a
// different length and a different deadline week from the NFL's 3/18/9.
const preseasonBlock = (shape: SeasonShape): Block => ({
  phase: "PRE",
  firstWeek: 1,
  lastWeek: shape.preseasonWeeks,
  watchAllLabel: "Simulate the preseason",
  advanceLabel: "Advance to Regular Season",
  checkpoint: { from: "Preseason", to: "Regular Season" },
  resultsOpenOn: "first",
});

const firstHalf = (shape: SeasonShape): Block => ({
  phase: "REG",
  firstWeek: 1,
  lastWeek: shape.deadlineWeek,
  // through the deadline week, which is the last one this block plays —
  // "to Week 10" read as though week 10 would be played too
  watchAllLabel: "Simulate to the trade deadline",
  advanceLabel: "Advance to Trade Deadline",
  checkpoint: { from: `Regular Season Weeks 1–${shape.deadlineWeek}`, to: "Trade Deadline" },
  // a half-season is read from the start, week by week, like the second half
  resultsOpenOn: "first",
});

const secondHalf = (shape: SeasonShape): Block => ({
  phase: "REG",
  firstWeek: shape.deadlineWeek + 1,
  lastWeek: shape.regularSeasonWeeks,
  watchAllLabel: "Simulate to the playoffs",
  advanceLabel: "Advance to Playoffs",
  checkpoint: { from: "Regular Season", to: "Playoffs" },
  resultsOpenOn: "first",
});

/**
 * Which block this league is in.
 *
 * The regular season splits on whether week ten has been played rather than
 * on a stage field, because the stage is `regularSeason` on both sides of the
 * deadline — the deadline is a stage of its own that the league passes
 * through, and it leaves the week behind it as the only durable marker.
 */
export function currentBlock(s: LeagueState): Block | null {
  const shape = seasonShape(s);
  if (s.stage === "preseason") return stable("pre", shape, preseasonBlock);
  if (s.stage !== "regularSeason") return null;
  // Past the deadline once this season's deadline has opened (it is set
  // there and cleared at the rollover). Inferring it from played games broke
  // online: a GM's copy has every unwatched game redacted to unplayed, so
  // the second half read as the first and the hub offered "Advance to Trade
  // Deadline" again after the deadline was over.
  const pastDeadline =
    !!s.tradeDeadline ||
    s.games.some((g) => g.phase === "REG" && g.played && g.week > shape.deadlineWeek);
  return pastDeadline ? stable("second", shape, secondHalf) : stable("first", shape, firstHalf);
}

/**
 * The same object for the same block, every call.
 *
 * `App` subscribes with `useStore(currentBlock)`, and a selector that returns
 * a fresh object each time re-renders forever ("maximum update depth
 * exceeded"). The blocks used to be module constants, which hid that; now
 * that they depend on the league's season shape they are cached per shape —
 * a league only ever has one, so this holds a handful of objects at most.
 */
const _blocks = new Map<string, Block>();
function stable(kind: string, shape: SeasonShape, build: (shape: SeasonShape) => Block): Block {
  const key = `${kind}|${shape.preseasonWeeks}|${shape.regularSeasonWeeks}|${shape.deadlineWeek}`;
  let b = _blocks.get(key);
  if (!b) {
    b = build(shape);
    _blocks.set(key, b);
  }
  return b;
}
