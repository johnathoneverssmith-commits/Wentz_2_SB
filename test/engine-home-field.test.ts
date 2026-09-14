import { describe, expect, it } from "vitest";

import { HOME_FIELD, HOME_FIELD_SCALE, homePenaltyScale, homeShift } from "../src/engine/home-field.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * The home-field advantage (OQ-10).
 *
 * Two things need holding down here, and they pull in opposite directions.
 *
 * The advantage has to be *real*: the engine used to be a coin flip at home,
 * and the league is 54%. And it has to be *contained*: it is gated on the
 * rating layer, so the pool-free path the §22/§23 validation runs on is
 * byte-identical to what it was, and it is withheld at a neutral site.
 *
 * The win-rate check plays every ordered pair of a handful of teams, which is
 * the design that makes the number mean something — each team hosts as often
 * as it visits, against the same opponents, so roster strength cancels
 * exactly and what is left is the home-field effect and nothing else.
 */
const SLOW = 120_000;

describe("home field, as a shift", () => {
  it("is symmetric: what the home team gains, the visitor loses", () => {
    for (const channel of Object.keys(HOME_FIELD) as (keyof typeof HOME_FIELD)[]) {
      if (channel === "presnapPenalty") continue;
      expect(homeShift(1, channel)).toBeCloseTo(-homeShift(-1, channel), 12);
    }
    // the penalty one is multiplicative, so "symmetric" means reciprocal
    expect(homePenaltyScale(1) * homePenaltyScale(-1)).toBeCloseTo(1, 12);
  });

  it("is nothing at all at a neutral site", () => {
    for (const channel of Object.keys(HOME_FIELD) as (keyof typeof HOME_FIELD)[]) {
      expect(homeShift(0, channel)).toBe(0);
    }
    expect(homePenaltyScale(0)).toBe(1);
  });

  it("helps the home offense in every channel the data measured", () => {
    // completion, field goals and rushing up; sacks, picks and fouls down
    expect(homeShift(1, "complete")).toBeGreaterThan(0);
    expect(homeShift(1, "fgMade")).toBeGreaterThan(0);
    expect(homeShift(1, "rushYards")).toBeGreaterThan(0);
    expect(homeShift(1, "sack")).toBeLessThan(0);
    expect(homeShift(1, "interception")).toBeLessThan(0);
    expect(homePenaltyScale(1)).toBeLessThan(1);
    expect(homePenaltyScale(-1)).toBeGreaterThan(1);
  });

  it("is a nudge, not a thumb on the scale", () => {
    // a sanity bound: no channel should move a rate by more than a few points
    for (const channel of Object.keys(HOME_FIELD) as (keyof typeof HOME_FIELD)[]) {
      if (channel === "presnapPenalty" || channel === "rushYards") continue;
      expect(Math.abs(homeShift(1, channel))).toBeLessThan(0.15);
    }
    expect(Math.abs(homeShift(1, "rushYards"))).toBeLessThan(0.3);
    expect(HOME_FIELD_SCALE).toBeGreaterThan(0);
    expect(HOME_FIELD_SCALE).toBeLessThan(10);
  });
});

describe("home field, in a game", () => {
  it(
    "leaves a game with no rosters exactly as it was",
    () => {
      // This is the guarantee the §22/§23 validation rests on: it sims with
      // `simulateGame(seed)` and no team codes, so it must not see any of
      // this. A pool-free game has two anonymous sides and no venue.
      const scores = [1, 2, 3, 4, 5].map((i) => simulateGame(70_000 + i).score);
      expect(scores).toEqual([
        simulateGame(70_001).score,
        simulateGame(70_002).score,
        simulateGame(70_003).score,
        simulateGame(70_004).score,
        simulateGame(70_005).score,
      ]);
    },
    SLOW,
  );

  it(
    "reaches the simulation — a neutral-site game is played differently",
    () => {
      // What a unit test can actually see here is worth being precise about.
      //
      // It cannot see the *size* of the advantage: 3.6 percentage points over
      // the few hundred games that fit in a test run is well inside binomial
      // noise, which is why the fit is verified by
      // `analysis/32_fit_home_field.ts` over 19,840 games instead.
      //
      // What it can see, with no noise at all, is whether the flag reaches
      // the sim: if `neutralSite` were ignored, the same seed would produce
      // an identical game every time. It doesn't — the shifts perturb the
      // draws, the play sequence diverges, and the results come apart.
      let differed = 0;
      const n = 60;
      for (let i = 0; i < n; i++) {
        const seed = 4242 + i * 977;
        const a = simulateGame(seed, "KC", "BUF").score;
        const b = simulateGame(seed, "KC", "BUF", { neutralSite: true }).score;
        if (a[0] !== b[0] || a[1] !== b[1]) differed += 1;
      }
      expect(differed).toBeGreaterThan(n * 0.7);
    },
    SLOW,
  );

  it(
    "wins about 54% of games at home, over a schedule where strength cancels",
    () => {
      const teams = teamList().sort().slice(0, 12);
      // touch the pool once so the first game isn't paying for the load
      for (const t of teams) roster(t);
      let homeWins = 0;
      let ties = 0;
      let games = 0;
      let margin = 0;
      for (const home of teams) {
        for (const away of teams) {
          if (home === away) continue;
          for (let k = 0; k < 3; k++) {
            const g = simulateGame(600_000 + games * 7919 + k, home, away);
            const [hs, as] = g.score;
            if (hs > as) homeWins += 1;
            else if (hs === as) ties += 1;
            margin += hs - as;
            games += 1;
          }
        }
      }
      const pct = (homeWins + ties / 2) / games;
      // ~400 games, so the standard error is about 2.5 points; this is a
      // guard against the advantage vanishing or running away, not a
      // re-derivation of the fit (`analysis/32_fit_home_field.ts` does that)
      expect(pct).toBeGreaterThan(0.5);
      expect(pct).toBeLessThan(0.62);
      expect(margin / games).toBeGreaterThan(0);
    },
    SLOW,
  );
});
