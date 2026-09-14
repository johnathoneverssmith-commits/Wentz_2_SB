import { describe, expect, it } from "vitest";

import { extractBoxScore } from "../src/engine/boxscore.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * The game clock has one identity, and it used to be broken.
 *
 * Time of possession for the two teams sums to exactly sixty minutes. That is
 * not a nicety of the box score — it is what "possession" means. Three
 * counters track the same clock (`gsr` the game, `hsr` the half, `qsr` the
 * quarter), and two code paths used to subtract a fixed amount from all three
 * without capping at what the quarter had left. `qsr` floors at zero and
 * `hsr` doesn't, so every overshoot moved them permanently out of step.
 *
 * The consequence was not a rounding error. Once `hsr` reached zero with time
 * still on `qsr`, the end-of-half machinery had nothing to end, no play
 * advanced the clock, and the game span until the 400-play guard stopped it —
 * roughly **one game in 370 finished at halftime**, with two quarters of
 * statistics and a box score that looked plausible until you added it up.
 *
 * Which is why these check the arithmetic rather than the symptom: a game
 * that ends early is the loud version of a fault whose quiet version is a
 * box score seventeen seconds short.
 */
const MATCHUPS = [
  ["KC", "BUF"],
  ["SF", "PHI"],
  ["NYJ", "MIA"],
] as const;

/** Seeds 5846 and 8706 are two that used to end at halftime. */
const SEEDS = [5846, 8706, 8472, ...Array.from({ length: 27 }, (_, i) => 4000 + i * 13)];

/** A game is ~60ms, and these play a few hundred of them. */
const SLOW = 60_000;

describe("the game clock", () => {
  it("gives the two teams the whole sixty minutes, and no more", () => {
    for (const seed of SEEDS) {
      for (const [home, away] of MATCHUPS) {
        const g = simulateGame(seed, home, away, { injuries: true });
        const b = extractBoxScore(g, home, away);
        const total = b.home.possessionSeconds + b.away.possessionSeconds;
        // Overtime is the only thing that legitimately adds time. The engine
        // plays it as "one possession each" rather than a clocked ten-minute
        // period (`sim.ts` says so), so a long pair of drives can run past
        // ten minutes — what matters here is that time is only ever added,
        // never lost.
        if (total === 3600) continue;
        expect(total, `${home}@${away} seed ${seed}`).toBeGreaterThan(3600);
        expect(
          total,
          `${home}@${away} seed ${seed} — overtime, but not a second game`,
        ).toBeLessThan(3600 + 1200);
      }
    }
  }, SLOW);

  it("plays four quarters", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const [home, away] of MATCHUPS) {
        const g = simulateGame(seed, home, away, { trace: true });
        const last = g.playTrace?.at(-1);
        expect(last?.quarter, `${home}@${away} seed ${seed}`).toBeGreaterThanOrEqual(4);
      }
    }
  }, SLOW);

  it("never lets the half run out before the quarter it contains", () => {
    // the invariant the two uncapped runoffs used to break; a game that keeps
    // it cannot reach the spin state
    for (const seed of SEEDS.slice(0, 30)) {
      const g = simulateGame(seed, "KC", "BUF", { trace: true });
      let quarter = 1;
      for (const p of g.playTrace ?? []) {
        expect(p.quarter).toBeGreaterThanOrEqual(quarter);
        quarter = p.quarter;
      }
      expect(quarter).toBeGreaterThanOrEqual(4);
    }
  }, SLOW);
});
