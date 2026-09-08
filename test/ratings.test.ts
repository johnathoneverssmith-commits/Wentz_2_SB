import { describe, expect, it } from "vitest";

import { PlayerSchema, type Position } from "../src/schema/player.js";
import { buildPlayer, type PlayerSeed } from "../src/model/ratings.js";
import { AGING_CURVES } from "../src/model/positions.js";

function seed(over: Partial<PlayerSeed> = {}): PlayerSeed {
  return {
    key: "test-1",
    name: "Test Player",
    position: "WR",
    age: 25,
    yearsExp: 3,
    draftNumber: 50,
    team: "FA",
    onIR: false,
    practiceSquad: false,
    perf: null,
    ...over,
  };
}

/** Mean overall across many distinct RNG streams for otherwise-equal seeds. */
function meanOverall(base: Partial<PlayerSeed>, n = 200): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buildPlayer(seed({ ...base, key: `k${i}` })).overall;
  return sum / n;
}

describe("buildPlayer — invariants", () => {
  it("is deterministic for the same seed + key", () => {
    const a = buildPlayer(seed({ key: "same" }));
    const b = buildPlayer(seed({ key: "same" }));
    expect(a).toEqual(b);
  });

  it("changes output when the model seed changes", () => {
    const a = buildPlayer(seed({ key: "same" }), { seed: "v0" });
    const b = buildPlayer(seed({ key: "same" }), { seed: "v1" });
    expect(a).not.toEqual(b);
  });

  it("produces schema-valid players across positions, ages, pedigrees", () => {
    const positions = Object.keys(AGING_CURVES) as Position[];
    for (const position of positions) {
      for (const age of [21, 25, 30, 36]) {
        for (const draftNumber of [1, 90, 260, null]) {
          for (const perf of [null, 0.1, 0.9]) {
            const p = buildPlayer(
              seed({ key: `${position}-${age}-${draftNumber}-${perf}`, position, age, draftNumber, perf }),
            );
            expect(() => PlayerSchema.parse({ id: "p_00001", ...p })).not.toThrow();
          }
        }
      }
    }
  });
});

describe("buildPlayer — position shaping", () => {
  it("gives receivers far more speed than guards", () => {
    const wr = meanAttr({ position: "WR" }, "speed");
    const og = meanAttr({ position: "OG" }, "speed");
    expect(wr).toBeGreaterThan(og + 15);
  });

  it("gives guards more strength than corners", () => {
    expect(meanAttr({ position: "OG" }, "strength")).toBeGreaterThan(
      meanAttr({ position: "CB" }, "strength") + 15,
    );
  });

  it("only writes jumping for skill-position bodies", () => {
    expect(buildPlayer(seed({ position: "WR", key: "j1" })).attributes).toHaveProperty("jumping");
    expect(buildPlayer(seed({ position: "OG", key: "j2" })).attributes).not.toHaveProperty("jumping");
    expect(buildPlayer(seed({ position: "QB", key: "j3" })).attributes).not.toHaveProperty("jumping");
  });
});

function meanAttr(base: Partial<PlayerSeed>, attr: string, n = 150): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = buildPlayer(seed({ ...base, key: `a${i}` }));
    sum += p.attributes[attr] ?? 0;
  }
  return sum / n;
}

describe("buildPlayer — talent signals", () => {
  it("rates a first-round pick above an undrafted player (no snap data)", () => {
    expect(meanOverall({ draftNumber: 1, perf: null })).toBeGreaterThan(
      meanOverall({ draftNumber: null, perf: null }) + 8,
    );
  });

  it("lets a strong snap share outweigh a late draft slot", () => {
    const starterLatePick = meanOverall({ draftNumber: 220, perf: 0.95 });
    const benchEarlyPick = meanOverall({ draftNumber: 15, perf: 0.05 });
    expect(starterLatePick).toBeGreaterThan(benchEarlyPick);
  });

  it("caps practice-squad players well below starter range", () => {
    for (let i = 0; i < 50; i++) {
      const p = buildPlayer(seed({ key: `ps${i}`, practiceSquad: true, draftNumber: 1, perf: 0.9 }));
      expect(p.overall).toBeLessThanOrEqual(73);
    }
  });

  it("declines aging players past the position curve", () => {
    const young = meanOverall({ position: "RB", age: 24, draftNumber: 20, perf: 0.8 });
    const old = meanOverall({ position: "RB", age: 32, draftNumber: 20, perf: 0.8 });
    expect(young).toBeGreaterThan(old + 5);
  });
});

describe("buildPlayer — franchise-draft defaults + scheme tags", () => {
  it("marks every generated player a free agent with no contract", () => {
    const p = buildPlayer(seed());
    expect(p.free_agent).toBe(true);
    expect(p.contract).toBeNull();
    expect(p.retired).toBe(false);
    expect(p.injury_history).toEqual([]);
  });

  it("pulls aging thresholds from the position curve", () => {
    const p = buildPlayer(seed({ position: "CB" }));
    expect(p.dev_age_threshold).toBe(AGING_CURVES.CB.dev);
    expect(p.decline_age_threshold).toBe(AGING_CURVES.CB.decline);
  });

  it("assigns 0-2 scheme tags to field players and none to specialists", () => {
    for (const position of ["QB", "RB", "WR", "CB", "EDGE"] as Position[]) {
      const tags = buildPlayer(seed({ position, key: `s-${position}` })).scheme_tags;
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.length).toBeLessThanOrEqual(2);
    }
    expect(buildPlayer(seed({ position: "K", key: "s-k" })).scheme_tags).toEqual([]);
    expect(buildPlayer(seed({ position: "P", key: "s-p" })).scheme_tags).toEqual([]);
  });
});
