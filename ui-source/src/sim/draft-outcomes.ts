/**
 * What a draft slot is actually worth, measured rather than guessed.
 *
 * The long-standing gap here (see `draft-history.ts`, which got the *position
 * mix* from OCR'd PFR draft pages) was that no outcome data survived the OCR:
 * Pro-Football-Reference's Approximate Value columns wouldn't read, so the
 * rating a prospect ends up with was a curve somebody reasoned their way to —
 * `86 - 13*log10(rank)` — rather than one fitted to anything.
 *
 * nflverse publishes the same draft data as a clean CSV *with* AV, under the
 * same open licence as the roster data `generate:pool` already pulls:
 *   https://github.com/nflverse/nflverse-data/releases/download/draft_picks/
 * The tables below come from 3,562 picks, drafts **2006-2019** — old enough
 * that every career has played out, recent enough to be the modern game.
 * `w_av` is PFR's weighted career Approximate Value; a pick who never
 * recorded any counts as 0 rather than being dropped, because "never played"
 * is the outcome that matters most at the bottom of the board.
 *
 * Two things are data and one is a judgement call, and it's worth being clear
 * which is which:
 *
 *  - **Data**: the mean AV at each point on the board, and how much it
 *    varies there. Both come straight from the 3,562 picks. The means are
 *    made monotone (the 12-16 bucket reads *above* the 8-12 bucket on n=56,
 *    which is sampling noise, not a real bump).
 *  - **Data**: the spread. Coefficient of variation rises from 0.54 at the
 *    top of round one to 1.90 at the end of round seven — late picks aren't
 *    just worse in expectation, they're far less knowable. The old model used
 *    one flat +/-4 at every slot, which is the opposite of what scouting is.
 *  - **Judgement**: where career AV lands on this game's 0-99 rating scale.
 *    AV is a career total and `trueOverall` is a rookie-year rating; nothing
 *    in the data fixes that mapping. It's anchored log-linearly so the top of
 *    the board arrives at 80 — a starter from day one — and the end of it at
 *    53, a camp body. `draftClass.test.ts` then checks the *consequences*
 *    against the real per-round rate of producing a player who ever started.
 */

/** [pick number, rookie-year overall, spread] — see the header for provenance. */
const CURVE: ReadonlyArray<readonly [pick: number, overall: number, sigma: number]> = [
  [2, 80.0, 5.7],
  [5, 78.3, 5.6],
  [9, 76.2, 6.2],
  [13, 76.2, 5.5],
  [19, 74.8, 5.9],
  [27, 74.1, 6.5],
  [39, 72.3, 6.8],
  [55, 70.2, 7.4],
  [75, 67.9, 8.1],
  [99, 65.4, 8.4],
  [127, 62.8, 9.1],
  [159, 60.3, 9.8],
  [191, 56.6, 11.6],
  [223, 53.6, 11.8],
  [251, 53.0, 12.5],
];

/**
 * The share of picks in each round that ever started an NFL season, from the
 * same 3,562. Not used by the generator — it's what the generated classes are
 * *checked against*, which is the only way to know the mapping above is sane.
 */
export const REAL_STARTER_RATE_BY_ROUND: Readonly<Record<number, number>> = {
  1: 0.94,
  2: 0.79,
  3: 0.63,
  4: 0.51,
  5: 0.41,
  6: 0.28,
  7: 0.22,
};

function interpolate(pick: number, index: 1 | 2): number {
  const p = Math.max(1, pick);
  if (p <= CURVE[0]![0]) return CURVE[0]![index];
  const last = CURVE[CURVE.length - 1]!;
  if (p >= last[0]) return last[index];
  for (let i = 1; i < CURVE.length; i++) {
    const hi = CURVE[i]!;
    if (p > hi[0]) continue;
    const lo = CURVE[i - 1]!;
    const t = (p - lo[0]) / (hi[0] - lo[0]);
    return lo[index] + (hi[index] - lo[index]) * t;
  }
  return last[index];
}

/** The rookie-year overall a pick at this board position is worth, on average. */
export function expectedRookieOverall(pick: number): number {
  return interpolate(pick, 1);
}

/**
 * How uncertain that is. Rises steeply down the board: a top-ten pick is a
 * fairly known quantity, a seventh-rounder is a lottery ticket, and that gap
 * is the entire reason scouting is a job.
 */
export function rookieOverallSpread(pick: number): number {
  return interpolate(pick, 2);
}
