import { describe, expect, it } from "vitest";

import { engineStaffFor, engineStaffsFor } from "./coachScale.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { derivedSchemeTags, effectiveSchemeTags, schemeFitModeOf } from "./schemeTags.ts";
import { rosterSchemeFit } from "./store.ts";
import { derivedSchemeTags as engineDerived } from "../../../src/engine/scheme-tags.ts";
import type { LeagueState } from "@/domain";

/** Phase 0 scheme fit, franchise side: the flag, the staff carrier and the CPU's hiring fit. */

const league = (schemeFit?: "legacy" | "derived"): LeagueState => {
  const { schemeFit: _drop, ...rest } = DEFAULT_CONFIG;
  const s = createLeague(3, { ...rest, ...(schemeFit ? { schemeFit } : {}) });
  fillRosterGaps(s);
  return s;
};
const strip = (s: LeagueState, team: string) => {
  for (const p of Object.values(s.players)) if (p.nfl_team === team) p.scheme_tags = [];
};

describe("scheme-fit flag", () => {
  it("new leagues start derived; an absent field reads legacy", () => {
    expect(DEFAULT_CONFIG.schemeFit).toBe("derived");
    expect(schemeFitModeOf({})).toBe("legacy");
    expect(schemeFitModeOf({ schemeFit: "derived" })).toBe("derived");
  });

  it("travels with the engine staff only when derived (legacy staffs are untouched)", () => {
    const d = league("derived");
    const l = league();
    const code = Object.keys(d.teams)[0]!;
    expect(engineStaffFor(d, code).schemeFit).toBe("derived");
    expect("schemeFit" in engineStaffFor(l, code)).toBe(false);
    expect(Object.values(engineStaffsFor(d)).every((st) => st.schemeFit === "derived")).toBe(true);
    expect(Object.values(engineStaffsFor(l)).some((st) => "schemeFit" in st)).toBe(false);
    // a bare { coaches } (old callers, tests) is legacy too
    expect("schemeFit" in engineStaffFor({ coaches: {} } as never, code)).toBe(false);
  });
});

describe("derived tags", () => {
  it("match the engine's table (the franchise layer keeps its own copy)", () => {
    const samples = [
      ["QB", { speed: 90 }], ["QB", { throw_power: 95 }], ["QB", {}], ["RB", { break_tackle: 90 }], ["RB", {}],
      ["WR", { speed: 95 }], ["WR", { route_running_short: 85 }], ["WR", {}], ["TE", { run_block: 80 }], ["TE", {}],
      ["OT", { agility: 70 }], ["OG", { agility: 40 }], ["C", {}], ["EDGE", { finesse_moves: 80, power_moves: 60 }],
      ["EDGE", { finesse_moves: 50, power_moves: 60 }], ["DT", { power_moves: 80 }], ["DT", {}],
      ["ILB", { man_coverage: 80 }], ["OLB", { zone_coverage: 70, block_shedding: 60 }], ["ILB", { zone_coverage: 50, block_shedding: 60 }],
      ["CB", { press: 85 }], ["CB", {}], ["S", { man_coverage: 80 }], ["S", {}], ["K", {}], ["P", {}],
    ] as const;
    for (const [position, attributes] of samples) {
      expect(derivedSchemeTags({ position, attributes } as never), `${position} ${JSON.stringify(attributes)}`).toEqual(
        engineDerived({ position, attributes }),
      );
    }
  });

  it("stored tags win", () => {
    const p = { position: "QB", attributes: { speed: 90 }, scheme_tags: ["vertical"] } as never;
    expect(effectiveSchemeTags(p)).toEqual(["vertical"]);
  });
});

describe("CPU coaching decisions read derived fit", () => {
  it("an untagged roster is no longer 'fits nothing' for every coordinator (derived) but still is (legacy)", () => {
    const d = league("derived");
    const l = league("legacy");
    const code = Object.keys(d.teams)[0]!;
    strip(d, code);
    strip(l, code);
    for (const scheme of ["west_coast", "power_run", "spread"]) {
      expect(rosterSchemeFit(l, code, "OC", scheme)).toBe(0); // exact legacy behaviour
    }
    const fits = ["west_coast", "power_run", "spread", "zone_run", "vertical"].map((x) => rosterSchemeFit(d, code, "OC", x));
    expect(Math.max(...fits)).toBeGreaterThan(0.2);
    expect(fits.some((f) => f !== fits[0])).toBe(true); // and it discriminates between schemes
    expect(rosterSchemeFit(d, code, "DC", "cover_3")).toBeGreaterThan(0);
  });

  it("a tagged roster scores the same in both modes up to the K/P denominator", () => {
    const d = league("derived");
    const code = Object.keys(d.teams)[0]!;
    for (const p of Object.values(d.players)) if (p.nfl_team === code) p.scheme_tags = ["west_coast"];
    expect(rosterSchemeFit(d, code, "OC", "west_coast")).toBe(1);
    expect(rosterSchemeFit(d, code, "OC", "power_run")).toBe(0);
  });
});
