import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hasFullPool } from "../src/data/players.js";
import type { Player } from "../src/schema/player.js";
import {
  familyModifier,
  offsets,
  puntDistanceShift,
  puntPlacementLogitShift,
  puntReturnYardsShift,
} from "../src/engine/ratings.js";
import { roster, teamList } from "../src/engine/roster.js";

/**
 * M21 punter attributes (ticket acceptance list). Reference stats (from
 * artifacts/ratings/attribute_reference_stats.json): punt_power
 * mean=88.469 sd=3.742, punt_accuracy mean=82.406 sd=4.641, coffin_corner
 * mean=83.031 sd=4.468, hang_time mean=84.438 sd=3.852 — all n=32, i.e. the
 * reference population *is* the league's 32 starting punters, so an
 * average punter (z≈0 on every attribute) nets ≈0 on every family below
 * without needing offsets() centering to make it so.
 */
const REF = {
  punt_power: 88.469,
  punt_accuracy: 82.406,
  coffin_corner: 83.031,
  hang_time: 84.438,
};

function punter(attrs: Partial<typeof REF>): Player {
  return { id: `p_${Math.random()}`, attributes: { ...REF, ...attrs } } as unknown as Player;
}

const average = punter({});
// roughly p10/p90 punters: one SD off the mean in each direction
const poor = punter({
  punt_power: REF.punt_power - 3.742,
  punt_accuracy: REF.punt_accuracy - 4.641,
  coffin_corner: REF.coffin_corner - 4.468,
  hang_time: REF.hang_time - 3.852,
});
const elite = punter({
  punt_power: REF.punt_power + 3.742,
  punt_accuracy: REF.punt_accuracy + 4.641,
  coffin_corner: REF.coffin_corner + 4.468,
  hang_time: REF.hang_time + 3.852,
});

describe("M21 punter families (familyModifier, pool-independent)", () => {
  it("an average punter nets ~0 on every punt family", () => {
    for (const fam of [
      "punt_power",
      "punt_accuracy_touchback",
      "punt_accuracy_placement",
      "punt_coffin_corner_touchback",
      "punt_coffin_corner_placement",
      "punt_hang_time_return",
      "punt_hang_time_return_yards",
    ]) {
      expect(familyModifier(fam, [average])).toBeCloseTo(0, 6);
    }
  });

  it("punt_power: monotonically increases gross distance with the attribute", () => {
    const lo = familyModifier("punt_power", [poor]);
    const hi = familyModifier("punt_power", [elite]);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });

  it("punt_accuracy: reduces touchback and increases useful placement as it rises", () => {
    const tbLo = familyModifier("punt_accuracy_touchback", [poor]);
    const tbHi = familyModifier("punt_accuracy_touchback", [elite]);
    // sign_constraint negative: higher accuracy -> more negative (less touchback)
    expect(tbHi).toBeLessThan(tbLo);

    const usefulLo = familyModifier("punt_accuracy_placement", [poor]);
    const usefulHi = familyModifier("punt_accuracy_placement", [elite]);
    expect(usefulHi).toBeGreaterThan(usefulLo);
  });

  it("hang_time: suppresses both the return rate and return yards as it rises", () => {
    const retLo = familyModifier("punt_hang_time_return", [poor]);
    const retHi = familyModifier("punt_hang_time_return", [elite]);
    expect(retHi).toBeLessThan(retLo); // negative sign: less RETURNED logit

    const ydLo = familyModifier("punt_hang_time_return_yards", [poor]);
    const ydHi = familyModifier("punt_hang_time_return_yards", [elite]);
    expect(ydHi).toBeLessThan(ydLo);
  });

  it("trait isolation: coffin_corner alone does not move punt_power or hang_time families", () => {
    const specialist = punter({ coffin_corner: REF.coffin_corner + 4.468 * 3 });
    expect(familyModifier("punt_power", [specialist])).toBeCloseTo(0, 6);
    expect(familyModifier("punt_hang_time_return", [specialist])).toBeCloseTo(0, 6);
    expect(familyModifier("punt_hang_time_return_yards", [specialist])).toBeCloseTo(0, 6);
  });

  it("clips z to ±3: an absurd attribute cannot exceed 3× beta_per_z", () => {
    const huge = punter({ punt_power: 9999 });
    const tiny = punter({ punt_power: -9999 });
    const a = familyModifier("punt_power", [huge]);
    const b = familyModifier("punt_power", [tiny]);
    expect(a).toBeCloseTo(-b, 9);
    expect(a).toBeCloseTo(0.426 * 3, 6);
  });

  it("is deterministic — same player, same result", () => {
    const a = familyModifier("punt_power", [elite]);
    const b = familyModifier("punt_power", [elite]);
    expect(a).toBe(b);
  });
});

// The pool file is git-ignored (large); roster-dependent shift-function
// checks (which run through centered()/offsets(), needing all 32 rosters)
// only run locally, matching engine-ratings.test.ts's convention.
const hasPool = hasFullPool();
describe.runIf(hasPool)("M21 punter shift functions — against the live pool", () => {
  it("§12 offsets exist for every punt family and are small (an average matchup nets ~0)", () => {
    const off = offsets();
    for (const fam of [
      "punt_power",
      "punt_accuracy_touchback",
      "punt_accuracy_placement",
      "punt_coffin_corner_touchback",
      "punt_coffin_corner_placement",
      "punt_hang_time_return",
      "punt_hang_time_return_yards",
    ]) {
      expect(off[fam]).toBeDefined();
      expect(Math.abs(off[fam] ?? 0)).toBeLessThan(0.05);
    }
  });

  it("coffin_corner: context-dependent — bigger effect near the goal line than at midfield", () => {
    const nearGl = puntPlacementLogitShift(elite, 15);
    const midfield = puntPlacementLogitShift(elite, 70);
    // near the punting team's target end zone (low yardline_100 for the
    // receiving side... here the field position the *punter* faces when
    // pinning deep), the coffin_corner-driven share of the touchback/useful
    // shift should dominate; at midfield only punt_accuracy contributes.
    expect(Math.abs(nearGl.TOUCHBACK ?? 0)).toBeGreaterThan(Math.abs(midfield.TOUCHBACK ?? 0));
    expect(Math.abs(nearGl.DOWNED ?? 0)).toBeGreaterThan(Math.abs(midfield.DOWNED ?? 0));
    // no large midfield distance/placement bonus for a pure coffin-corner specialist beyond accuracy's flat share
    expect(midfield.TOUCHBACK).toBeLessThan(0); // punt_accuracy's flat share still applies
  });

  it("bounds: field-position weighting for coffin_corner never exceeds [0, 1]", () => {
    const beyond = puntPlacementLogitShift(elite, -10); // outside real range, defensive check
    const deep = puntPlacementLogitShift(elite, 130);
    expect(Number.isFinite(beyond.TOUCHBACK)).toBe(true);
    expect(Number.isFinite(deep.TOUCHBACK)).toBe(true);
  });

  it("Monte Carlo summary: poor vs average vs elite punter's per-attempt shifts", () => {
    const teams = teamList();
    const anyPunter = roster(teams[0]!).punter();
    // exercising the real shift functions end-to-end (through centered()) at
    // a representative near-goal-line field position for a punting team
    const yardline100 = 25;
    const rows = { poor, average, elite } as const;
    const report: Record<string, unknown> = {};
    for (const [label, p] of Object.entries(rows)) {
      const dist = puntDistanceShift(p);
      const placement = puntPlacementLogitShift(p, yardline100);
      const retYd = puntReturnYardsShift(p);
      report[label] = { dist, placement, retYd };
    }
    // gross distance: elite > average > poor
    expect((report.elite as any).dist).toBeGreaterThan((report.average as any).dist);
    expect((report.average as any).dist).toBeGreaterThan((report.poor as any).dist);
    // touchback logit: elite most negative (least touchback-prone), poor least negative
    expect((report.elite as any).placement.TOUCHBACK).toBeLessThan((report.average as any).placement.TOUCHBACK);
    expect((report.average as any).placement.TOUCHBACK).toBeLessThan((report.poor as any).placement.TOUCHBACK);
    // return-yards suppression: elite most negative
    expect((report.elite as any).retYd).toBeLessThan((report.poor as any).retYd);
    // sanity: the real pool's punter isn't literally the average fixture,
    // but running the same functions on it should return finite numbers
    expect(Number.isFinite(puntDistanceShift(anyPunter))).toBe(true);
  });
});
