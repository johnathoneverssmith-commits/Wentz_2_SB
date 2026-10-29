import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { classDnaForLeague } from "@/sim/leagueDna";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { draftClassTilt } from "@/state/draftSupply.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";

/**
 * Seeded League DNA on the server path: two servers (or one server before and after a restart) must build the same
 * players and the same draft classes from the same stored league, and what a client is sent must hold no hidden rating.
 */
const make = () => createLeague(4242, { ...DEFAULT_CONFIG, humanGmCount: 2, draftHumanRounds: 3, faHumanRounds: 3 });
const sim = new MockSimulationService();

describe("League DNA on the server", () => {
  it("two servers make the same league from the same seed", () => {
    expect(JSON.stringify(make().players)).toBe(JSON.stringify(make().players));
    expect(JSON.stringify(make().draftClass)).toBe(JSON.stringify(make().draftClass));
  });

  it("a stored league reloads to the same future classes, whatever else happened in between", () => {
    const a = make();
    const stored = JSON.stringify(a);
    const next = (s: LeagueState, year: number) =>
      sim.generateDraftClass(year + 7, year, draftClassTilt(s), classDnaForLeague(s.dna, year));
    const one = next(JSON.parse(stored) as LeagueState, 2030);
    // unrelated random draws between the two (a different league, other classes) change nothing
    make();
    next(JSON.parse(stored) as LeagueState, 2031);
    const two = next(JSON.parse(stored) as LeagueState, 2030);
    expect(two).toEqual(one);
    // and a different year is a different class
    expect(next(JSON.parse(stored) as LeagueState, 2031).map((p) => p.name)).not.toEqual(one.map((p) => p.name));
  });

  it("the public profiles carry no ratings, potential or individual players", () => {
    const s = make();
    for (const profile of [s.dna!.profile, s.draftClassProfile!]) {
      const text = JSON.stringify(profile);
      expect(text).not.toMatch(/potential|trueOverall|overall|"id"|p_g\d/);
      // the only numbers are calendar years (an era or a class year), never a count or a rating
      expect(text.replace(/\b(19|20)\d\d\b/g, "")).not.toMatch(/\d/);
    }
    // the stored DNA record is the seed, the version and the profile: not a rating table
    expect(Object.keys(s.dna!).sort()).toEqual(["dnaSeed", "profile", "version"]);
  });

  it("prospects carry a type but the class profile is the only summary of true ratings", () => {
    const s = make();
    expect(s.draftClass.every((p) => p.archetype)).toBe(true);
    expect(s.draftClassProfile?.tendencies.classStrength).toBeDefined();
  });
});
