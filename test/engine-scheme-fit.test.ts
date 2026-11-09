import { describe, expect, it } from "vitest";

import { hasFullPool } from "../src/data/players.js";
import type { Player } from "../src/schema/player.js";
import { Roster, roster, teamList } from "../src/engine/roster.js";
import { derivedSchemeTags, effectiveSchemeTags } from "../src/engine/scheme-tags.js";
import { simulateGame } from "../src/engine/sim.js";
import {
  DEF_SCHEME_TAGS,
  leagueAverageStaff,
  OFF_SCHEME_TAGS,
  schemeFitFraction,
  schemeFitFractionOrNull,
  type DefScheme,
  type OffScheme,
  type Staff,
} from "../src/engine/staff.js";
import { defSchemeFitShift, defSchemeFitShiftDerived, offSchemeFitShift, offSchemeFitShiftDerived, schemeFitBaseline } from "../src/engine/staff-fit.js";

/**
 * Phase 0 scheme fit: an untagged roster must not be charged for a coordinator's
 * specialisation, and a league that never opts in must play exactly as before.
 */

const hasPool = hasFullPool();
const OFF_SLOTS = ["QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT"];
const DEF_SLOTS = ["EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2"];
const OFF = Object.keys(OFF_SCHEME_TAGS) as OffScheme[];
const DEF = Object.keys(DEF_SCHEME_TAGS) as DefScheme[];

const retag = (r: Roster, f: (p: Player) => string[]): Roster => {
  const all: Player[] = [];
  const order: Record<string, string[]> = {};
  for (const [pos, list] of r.depth) {
    for (const p of list) all.push({ ...p, scheme_tags: f(p) });
    order[pos] = list.map((p) => p.id);
  }
  return new Roster(r.team, all, order);
};
const stripped = (team: string) => retag(roster(team), () => []);

const starters = (r: Roster, side: "off" | "def") => {
  const u = (side === "off" ? r.offense() : r.defense()) as Record<string, Player | null>;
  return (side === "off" ? OFF_SLOTS : DEF_SLOTS).map((x) => u[x]);
};
const tagsOf = (r: Roster, side: "off" | "def", derived: boolean) => {
  const u = (side === "off" ? r.offense() : r.defense()) as Record<string, Player | null>;
  return (side === "off" ? OFF_SLOTS : DEF_SLOTS).map((s) => (derived ? effectiveSchemeTags(u[s]) : u[s]?.scheme_tags));
};

describe("derived scheme tags (pool-free)", () => {
  it("reads archetype-like styles off attributes", () => {
    expect(derivedSchemeTags({ position: "RB", attributes: { break_tackle: 90 } })).toEqual(["power_run", "gap_scheme"]);
    expect(derivedSchemeTags({ position: "RB", attributes: { break_tackle: 50, strength: 60 } })).toEqual(["outside_zone", "zone_run"]);
    expect(derivedSchemeTags({ position: "CB", attributes: { press: 85 } })).toEqual(["man_press", "cover_1"]);
    expect(derivedSchemeTags({ position: "ILB", attributes: { zone_coverage: 70, block_shedding: 60 } })).toEqual(["base_4_3", "cover_2"]);
    expect(derivedSchemeTags({ position: "K", attributes: {} })).toEqual([]);
  });

  it("is a pure function: same player, same tags", () => {
    const p = { position: "EDGE", attributes: { finesse_moves: 80, power_moves: 60 } };
    expect(derivedSchemeTags(p)).toEqual(derivedSchemeTags({ ...p }));
  });

  it("stored tags always win; derivation only fills a hole", () => {
    const attrs = { speed: 90 };
    expect(effectiveSchemeTags({ position: "QB", attributes: attrs, scheme_tags: ["vertical"] })).toEqual(["vertical"]);
    expect(effectiveSchemeTags({ position: "QB", attributes: attrs, scheme_tags: [] })).toEqual(["rpo", "play_action"]);
    expect(effectiveSchemeTags(null)).toBeUndefined();
  });

  it("an all-untagged unit is `null` (no information), not a 0% match", () => {
    const want = OFF_SCHEME_TAGS.power_run;
    expect(schemeFitFraction([[], undefined, []], want)).toBe(0); // legacy reading, unchanged
    expect(schemeFitFractionOrNull([[], undefined, []], want)).toBeNull();
    expect(schemeFitFractionOrNull([[], ["power_run"]], want)).toBe(1);
  });

  it("a unit with nothing readable is exactly neutral in derived mode", () => {
    if (!hasPool) return; // the shift is centred on the 32-team baseline
    const blank = OFF_SLOTS.map(() => undefined);
    for (const s of OFF) expect(offSchemeFitShiftDerived(s, blank)).toEqual({ complete: 0, rush: 0 });
    for (const s of DEF) expect(defSchemeFitShiftDerived(s, blank)).toEqual({ complete: 0, rush: 0 });
  });
});

describe.skipIf(!hasPool)("scheme fit on the reference rosters", () => {
  const teams = teamList();
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  it("legacy is pinned: an untagged unit is charged baseline x coefficient", () => {
    const base = schemeFitBaseline();
    for (const s of OFF.filter((x) => x !== "pro_style")) {
      const sh = offSchemeFitShift(s, OFF_SLOTS.map(() => undefined));
      expect(sh.rush).toBeCloseTo(0.4 * (0 - base.off[s]), 12);
      expect(sh.complete).toBeCloseTo(0.08 * (0 - base.off[s]), 12);
      expect(sh.rush).toBeLessThan(-0.05); // the defect: a real penalty for nothing
    }
    for (const s of DEF.filter((x) => x !== "multiple")) {
      expect(defSchemeFitShift(s, DEF_SLOTS.map(() => undefined)).rush).toBeGreaterThan(0.05); // and the mirror on defense
    }
  });

  it("neutral schemes contribute nothing in either mode, tagged or not", () => {
    for (const t of teams.slice(0, 4)) {
      const r = stripped(t);
      expect(offSchemeFitShiftDerived("pro_style", starters(r, "off"))).toEqual({ complete: 0, rush: 0 });
      expect(defSchemeFitShiftDerived("multiple", starters(r, "def"))).toEqual({ complete: 0, rush: 0 });
      expect(offSchemeFitShift("pro_style", tagsOf(r, "off", false))).toEqual({ complete: 0, rush: 0 });
    }
  });

  it("tagged rosters: derived mode is the legacy shift, exactly", () => {
    for (const t of teams) {
      const r = roster(t);
      for (const s of OFF) expect(offSchemeFitShiftDerived(s, starters(r, "off"))).toEqual(offSchemeFitShift(s, tagsOf(r, "off", false)));
      for (const s of DEF) expect(defSchemeFitShiftDerived(s, starters(r, "def"))).toEqual(defSchemeFitShift(s, tagsOf(r, "def", false)));
    }
  });

  it("untagged rosters: the legacy penalty is gone, specialisation is not punished on average", () => {
    for (const s of OFF.filter((x) => x !== "pro_style")) {
      const legacy = mean(teams.map((t) => offSchemeFitShift(s, tagsOf(stripped(t), "off", false)).rush));
      const derived = mean(teams.map((t) => offSchemeFitShiftDerived(s, starters(stripped(t), "off")).rush));
      expect(legacy, `${s} legacy`).toBeLessThan(-0.1);
      expect(Math.abs(derived), `${s} derived`).toBeLessThan(0.05);
    }
    for (const s of DEF.filter((x) => x !== "multiple")) {
      const legacy = mean(teams.map((t) => defSchemeFitShift(s, tagsOf(stripped(t), "def", false)).rush));
      const derived = mean(teams.map((t) => defSchemeFitShiftDerived(s, starters(stripped(t), "def")).rush));
      expect(legacy, `${s} legacy`).toBeGreaterThan(0.07);
      expect(Math.abs(derived), `${s} derived`).toBeLessThan(0.07);
    }
  });

  it("compatible beats neutral beats incompatible", () => {
    const t = teams[0]!;
    for (const s of OFF.filter((x) => x !== "pro_style")) {
      const mk = (f: (p: Player) => string[]) => offSchemeFitShiftDerived(s, starters(retag(roster(t), f), "off")).rush;
      const good = mk(() => [OFF_SCHEME_TAGS[s][0]!]);
      const bad = mk(() => ["__none__"]);
      expect(good).toBeGreaterThan(0.1);
      expect(good).toBeGreaterThan(bad);
      expect(bad).toBeLessThan(0); // offense is still charged for a roster built against its scheme
    }
    for (const s of DEF.filter((x) => x !== "multiple")) {
      const mk = (f: (p: Player) => string[]) => defSchemeFitShiftDerived(s, starters(retag(roster(t), f), "def")).rush;
      expect(mk(() => [DEF_SCHEME_TAGS[s][0]!])).toBeLessThan(mk(() => ["__none__"])); // negative = better for the defense
    }
  });

  const avg = (derived: boolean, oc?: OffScheme, dc?: DefScheme): Staff => {
    const s = leagueAverageStaff();
    if (derived) s.schemeFit = "derived";
    if (oc) s.oc = { ...s.oc, scheme: oc };
    if (dc) s.dc = { ...s.dc, scheme: dc };
    return s;
  };
  const play = (seed: number, a: string, b: string, ra: Roster, rb: Roster, sa: Staff, sb: Staff, talentScale: number) =>
    simulateGame(seed, a, b, { homeRoster: ra, awayRoster: rb, homeStaff: sa, awayStaff: sb, talentScale });
  const sig = (g: unknown) => JSON.stringify((g as { score: number[] }).score) + JSON.stringify((g as { snaps: unknown }).snaps);

  for (const talent of [1, 1.5]) {
    describe(`talent ${talent}`, () => {
      const [h, a] = [teams[0]!, teams[9]!];

      it("flag absent / legacy is byte-identical to the unflagged engine (untagged and tagged)", () => {
        for (const [ra, rb] of [[roster(h), roster(a)], [stripped(h), stripped(a)]] as const) {
          for (const seed of [11, 12, 13]) {
            const plain = play(seed, h, a, ra, rb, avg(false, "spread", "cover_2"), avg(false, "power_run", "man_press"), talent);
            const explicit = play(seed, h, a, ra, rb, { ...avg(false, "spread", "cover_2"), schemeFit: undefined }, avg(false, "power_run", "man_press"), talent);
            expect(sig(explicit)).toBe(sig(plain));
          }
        }
      });

      it("tagged rosters play identically in derived mode (nothing to derive)", () => {
        for (const seed of [21, 22, 23]) {
          const legacy = play(seed, h, a, roster(h), roster(a), avg(false, "spread", "cover_2"), avg(false, "zone_run", "three_four"), talent);
          const derived = play(seed, h, a, roster(h), roster(a), avg(true, "spread", "cover_2"), avg(true, "zone_run", "three_four"), talent);
          expect(sig(derived)).toBe(sig(legacy));
        }
      });

      it("a league-average staff stays an exact no-op in derived mode, untagged", () => {
        for (const seed of [31, 32]) {
          const off = play(seed, h, a, stripped(h), stripped(a), avg(false), avg(false), talent);
          const on = play(seed, h, a, stripped(h), stripped(a), avg(true), avg(true), talent);
          expect(sig(on)).toBe(sig(off));
        }
      });

      it("untagged + specialised scheme: reproducible, and the legacy penalty no longer decides games", () => {
        const mk = (derived: boolean, seed: number) =>
          play(seed, h, a, stripped(h), stripped(a), avg(derived, "spread", "cover_3"), avg(derived, "zone_run", "man_press"), talent);
        let differs = 0;
        for (const seed of [41, 42, 43, 44, 45, 46]) {
          expect(sig(mk(true, seed))).toBe(sig(mk(true, seed)));
          if (sig(mk(true, seed)) !== sig(mk(false, seed))) differs += 1;
        }
        expect(differs).toBeGreaterThan(0);
      });
    });
  }
});
