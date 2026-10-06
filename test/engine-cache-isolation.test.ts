import { describe, expect, it } from "vitest";

import { predictProba } from "../src/engine/loaders.js";
import { loadPool, Roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * Live playthrough, 2026-10: every online league on the server recorded 0
 * passing yards. Every dropback had become a scramble. The rating caches keyed
 * on player ids, which a real player shares across every league and with the
 * reference rosters each rating is centred on, so one league's bad attribute
 * was cached and handed to every game after it, and a single NaN in a shift
 * turned the whole dropback resolver into "always the last label".
 */
const passes = (g: ReturnType<typeof simulateGame>) => (g.teams[0].s.pass_att ?? 0) + (g.teams[1].s.pass_att ?? 0);
const scrambles = (g: ReturnType<typeof simulateGame>) => (g.teams[0].s.scramble ?? 0) + (g.teams[1].s.scramble ?? 0);

describe("engine caches are per league, and a bad input costs one adjustment", () => {
  it("a NaN shift is ignored, not spread over every class", () => {
    const ctx = { down: 2, ydstogo: 7, yardline_100: 60, qtr: 1, half_seconds_remaining: 1500, score_differential: 0, shotgun: 1 };
    const clean = predictProba("M04", ctx);
    const broken = predictProba("M04", ctx, { SACK: Number.NaN });
    expect(broken).toEqual(clean);
  });

  it("another league's broken players never reach this league's games", () => {
    // first thing this process simulates, as on a server that has just
    // started: the same people (same ids) in a league whose ratings are broken
    const pool = loadPool();
    const broken = (team: string) =>
      new Roster(
        team,
        (pool.get(team) ?? []).map((p) => ({
          ...p,
          attributes: Object.fromEntries(Object.keys(p.attributes ?? {}).map((k) => [k, Number.NaN])),
        })) as never,
      );
    const bad = simulateGame(4402, "KC", "BUF", { homeRoster: broken("KC"), awayRoster: broken("BUF") });
    // even that league still throws the ball
    expect(passes(bad)).toBeGreaterThan(40);
    expect(scrambles(bad)).toBeLessThan(passes(bad));

    // and every league after it plays ordinary football
    for (const seed of [4401, 4403, 4404]) {
      const g = simulateGame(seed, "KC", "BUF");
      expect(passes(g), `seed ${seed}`).toBeGreaterThan(40);
      expect(scrambles(g), `seed ${seed}`).toBeLessThan(12);
    }
  });
});
