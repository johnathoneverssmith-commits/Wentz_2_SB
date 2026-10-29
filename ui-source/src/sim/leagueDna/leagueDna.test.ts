import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { POSITIONS, type Position } from "@/domain";
import { ATTRIBUTE_FIT } from "../attributeFit";
import { realPlayerNames } from "../MockSimulationService";
import { ROSTER_TEMPLATE } from "../roster-template";
import { ARCHETYPES, archetypeById } from "./archetypes";
import { classDnaFor } from "./classDna";
import { GEN_VERSION, drawLeagueDna, neutralDna } from "./dna";
import { ERAS, matchEra, profileForPool } from "./eras";
import { generateFictionalPool, playersAt } from "./generate";
import { makeDnaLeague } from "./index";
import { groupScores, tendencySentence } from "./profile";
import { dnaSeedFor, hash32 } from "./streams";
import { neutralTop } from "./targets";
import { TEAMS } from "@/data/teams";

const seeds = Array.from({ length: 24 }, (_, i) => 500 + i * 37);
const pool = (seed: number) => generateFictionalPool(drawLeagueDna(dnaSeedFor(seed, GEN_VERSION)));
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2)));

describe("determinism and identity", () => {
  it("the same seed and version give an identical pool", () => {
    expect(pool(42)).toEqual(pool(42));
  });
  it("different seeds give measurably different populations", () => {
    const stars = (s: number) => new Set(pool(s).filter((p) => p.overall >= 88).map((p) => p.name));
    let overlap = 0;
    let pairs = 0;
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const sa = stars(seeds[a]!);
      const sb = stars(seeds[b]!);
      overlap += [...sa].filter((n) => sb.has(n)).length / Math.max(1, sa.size);
      pairs++;
    }
    expect(overlap / pairs).toBeLessThan(0.05);
  });
  it("ids and names are unique, and none is a shipped real name", () => {
    const real = new Set(realPlayerNames().map((n) => n.toLowerCase()));
    const dna = drawLeagueDna(dnaSeedFor(7, GEN_VERSION));
    const p = generateFictionalPool(dna, realPlayerNames());
    expect(new Set(p.map((x) => x.id)).size).toBe(p.length);
    expect(new Set(p.map((x) => x.name.toLowerCase())).size).toBe(p.length);
    expect(p.filter((x) => real.has(x.name.toLowerCase()))).toEqual([]);
    expect(p.every((x) => /^p_g\d+_[0-9a-f]{6}_[A-Z]+\d{3}$/.test(x.id))).toBe(true);
  });
  it("a player depends only on (seed, position, index), not on what else is generated", () => {
    const a = drawLeagueDna(99);
    const b = { ...a, positions: { ...a.positions, WR: { ...a.positions.WR, depth: 1.3 } } };
    const pa = generateFictionalPool(a).filter((p) => p.position === "QB");
    const pb = generateFictionalPool(b).filter((p) => p.position === "QB");
    expect(pb.map((p) => ({ ...p, name: "" }))).toEqual(pa.map((p) => ({ ...p, name: "" })));
  });
  it("streams are independent of each other and of the seed's size", () => {
    expect(hash32("a", 1)).not.toBe(hash32("a", 2));
    expect(dnaSeedFor(1, 1)).not.toBe(dnaSeedFor(2, 1));
    expect(dnaSeedFor(1, 1)).not.toBe(dnaSeedFor(1, 2));
  });
});

describe("position-specific distributions", () => {
  it("every position can fill every roster with room to spare", () => {
    for (const s of seeds) {
      const p = pool(s);
      for (const { pos, count, starters } of ROSTER_TEMPLATE) {
        if (count === 0) continue;
        const have = p.filter((x) => x.position === pos);
        expect(have.length, `${pos} seed ${s}`).toBeGreaterThanOrEqual(Math.ceil(count * 32 * 1.1));
        // enough real-quality bodies: starters-and-a-backup at 60+
        expect(have.filter((x) => x.overall >= 60).length, `${pos} 60+ seed ${s}`).toBeGreaterThanOrEqual(Math.min(count, starters + 1) * 32);
      }
    }
  });
  it("a neutral league has today's shape: elite counts near the shipped pool's", () => {
    const p = generateFictionalPool({ ...neutralDna(), dnaSeed: 5 });
    const n85 = p.filter((x) => x.overall >= 85).length;
    const n90 = p.filter((x) => x.overall >= 90).length;
    expect(n85).toBeGreaterThan(100);
    expect(n85).toBeLessThan(170);
    expect(n90).toBeGreaterThan(35);
    expect(n90).toBeLessThan(80);
    for (const x of p) {
      expect(x.overall).toBeGreaterThanOrEqual(42);
      expect(x.overall).toBeLessThanOrEqual(99);
      expect(x.age).toBeGreaterThanOrEqual(21);
      expect(x.potential!).toBeGreaterThanOrEqual(x.overall);
      expect(x.decline_age_threshold).toBeGreaterThan(x.dev_age_threshold);
    }
  });
  it("league DNA varies the talent environment: positional means and elite counts differ across seeds", () => {
    const meanOf = (s: number, pos: Position) => mean(pool(s).filter((x) => x.position === pos).map((x) => x.overall));
    for (const pos of ["QB", "OT", "CB", "EDGE"] as Position[]) {
      const m = seeds.map((s) => meanOf(s, pos));
      expect(sd(m), pos).toBeGreaterThan(1.0);
    }
    const elite = seeds.map((s) => pool(s).filter((x) => x.overall >= 88).length);
    expect(sd(elite)).toBeGreaterThan(4);
  });
  it("is correlated, not independent: quarterback and receiver shifts move together", () => {
    const many = Array.from({ length: 300 }, (_, i) => drawLeagueDna(dnaSeedFor(i, 1)));
    const qb = many.map((d) => d.positions.QB.shift);
    const wr = many.map((d) => d.positions.WR.shift);
    const mq = mean(qb), mw = mean(wr);
    const corr = mean(qb.map((v, i) => (v - mq) * (wr[i]! - mw))) / (sd(qb) * sd(wr));
    expect(corr).toBeGreaterThan(0.15);
  });
});

describe("archetypes", () => {
  const engineAttrs = (() => {
    const j = JSON.parse(readFileSync(new URL("../../../../artifacts/ratings/rating_effect_coefficients.json", import.meta.url), "utf8")) as { families: Record<string, { attributes: { attribute: string }[] }> };
    const s = new Set<string>();
    for (const f of Object.values(j.families)) for (const a of f.attributes) s.add(a.attribute);
    // synergy.ts skills and the quarterback-mobility / kicker-leg terms read these as well
    for (const k of ["speed", "acceleration", "agility", "scrambling", "tackle", "pursuit", "hit_power", "strength", "yac", "break_tackle", "jumping", "run_block", "kick_power", "kick_accuracy", "line_calls", "anchor"]) s.add(k);
    return s;
  })();
  it("every type changes attributes the engine reads, and only attributes its position has", () => {
    for (const a of ARCHETYPES) {
      const keys = Object.keys({ ...a.boost, ...a.cost });
      const has = new Set(Object.keys(ATTRIBUTE_FIT[a.position] ?? {}));
      for (const k of keys) expect(has.has(k), `${a.id}.${k}`).toBe(true);
      expect(keys.some((k) => engineAttrs.has(k)), a.id).toBe(true);
    }
  });
  it("a type shows up in the attributes it names", () => {
    const p = pool(11);
    const mob = p.filter((x) => x.archetype === "qb_mobile" && x.position === "QB");
    const poc = p.filter((x) => x.archetype === "qb_pocket" && x.position === "QB");
    expect(mob.length).toBeGreaterThan(5);
    expect(poc.length).toBeGreaterThan(5);
    expect(mean(mob.map((x) => x.attributes.scrambling!))).toBeGreaterThan(mean(poc.map((x) => x.attributes.scrambling!)) + 10);
    expect(mean(poc.map((x) => x.attributes.throw_accuracy_short!))).toBeGreaterThan(mean(mob.map((x) => x.attributes.throw_accuracy_short!)));
    expect(archetypeById("qb_mobile")?.position).toBe("QB");
  });
  it("archetype mix differs by league", () => {
    const share = (s: number) => {
      const q = pool(s).filter((x) => x.position === "QB");
      return q.filter((x) => x.archetype === "qb_mobile").length / q.length;
    };
    expect(sd(seeds.slice(0, 12).map(share))).toBeGreaterThan(0.04);
  });
});

describe("league profile and eras", () => {
  it("the profile is built from the generated pool, is qualitative and reveals no numbers", () => {
    neutralTop();
    for (const s of seeds.slice(0, 12)) {
      const prof = profileForPool(pool(s));
      expect(prof.title.length).toBeGreaterThan(3);
      expect(prof.blurb).not.toMatch(/\d/);
      expect(prof.blurb).not.toMatch(/optimal|best strategy|you should/i);
      expect(Object.keys(prof.tendencies).length).toBe(7);
      if (prof.eraId) expect(ERAS.map((e) => e.id)).toContain(prof.eraId);
    }
  });
  it("uses a fictional description when nothing is close, and a real era when something is", () => {
    expect(matchEra({ passing: 0.9, ground: -0.3, front: 0, coverage: -0.4 })?.era.id).toBe("2011");
    expect(matchEra({ passing: 3, ground: -3, front: 3, coverage: -3 })).toBeNull();
  });
  it("across many seeds both outcomes occur, and more than one era is matched", () => {
    const t = Array.from({ length: 60 }, (_, i) => profileForPool(pool(2000 + i)).eraId);
    expect(new Set(t).size).toBeGreaterThanOrEqual(3);
    expect(t.filter((x) => x === null).length).toBeGreaterThan(0);
    expect(t.filter((x) => x !== null).length).toBeGreaterThan(10);
  });
  it("the tendency sentence names the clear strengths of a lopsided pool", () => {
    const g = { passing: 1.2, receivers: 0.8, line: -1.1, backfield: 0, front: 0, secondary: 0, specialists: 0 };
    const s = tendencySentence(g, "x");
    expect(s).toMatch(/quarterback/i);
    expect(s).toMatch(/offensive linemen/i);
  });
  it("group scores of a neutral pool sit near zero", () => {
    const g = groupScores(generateFictionalPool({ ...neutralDna(), dnaSeed: 9 }), neutralTop());
    expect(mean(Object.values(g).map(Math.abs))).toBeLessThan(0.5);
  });
});

describe("independent draft classes", () => {
  it("a class is a pure function of (seed, year)", () => {
    expect(classDnaFor(5, 2030)).toEqual(classDnaFor(5, 2030));
    expect(classDnaFor(5, 2030)).not.toEqual(classDnaFor(5, 2031));
  });
  it("classes vary a lot year to year, including strong and weak ones", () => {
    const q = Array.from({ length: 40 }, (_, y) => classDnaFor(77, 2027 + y).quality);
    expect(sd(q)).toBeGreaterThan(0.9);
    expect(Math.max(...q)).toBeGreaterThan(1.5);
    expect(Math.min(...q)).toBeLessThan(-1.5);
    const qb = Array.from({ length: 40 }, (_, y) => classDnaFor(77, 2027 + y).positions.QB.quality);
    expect(sd(qb)).toBeGreaterThan(1.3);
  });
  it("a quarterback-rich opening league does not make quarterback-rich classes", () => {
    const opening: number[] = [];
    const later: number[] = [];
    for (const s of seeds) {
      const dna = drawLeagueDna(dnaSeedFor(s, 1));
      opening.push(dna.positions.QB.shift);
      later.push(mean(Array.from({ length: 6 }, (_, y) => classDnaFor(dna.dnaSeed, 2027 + y).positions.QB.quality)));
    }
    const mo = mean(opening), ml = mean(later);
    const corr = mean(opening.map((v, i) => (v - mo) * (later[i]! - ml))) / (sd(opening) * sd(later));
    expect(Math.abs(corr)).toBeLessThan(0.45);
  });
});

describe("league creation helper", () => {
  it("deals every team a full template and keeps the home team", () => {
    const codes = TEAMS.map((t) => t.code);
    const { pool: p, profile } = makeDnaLeague(3, codes, realPlayerNames());
    for (const code of codes) {
      for (const { pos, count } of ROSTER_TEMPLATE) {
        expect(p.filter((x) => x.nfl_team === code && x.position === pos).length).toBe(count);
      }
    }
    expect(p.filter((x) => x.nfl_team !== "FA").every((x) => x.home_team === x.nfl_team)).toBe(true);
    expect(profile.title).toBeTruthy();
    expect(playersAt("QB", neutralDna())).toBeGreaterThanOrEqual(96);
    expect(POSITIONS.length).toBe(15);
  });
});
