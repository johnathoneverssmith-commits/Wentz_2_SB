import { describe, expect, it } from "vitest";

import {
  PlayerSchema,
  PlayerPoolSchema,
  AttributesSchema,
  GENERAL_ATTRIBUTE_KEYS,
  unknownAttributeKeys,
  type Player,
} from "../src/schema/player.js";
import { loadPlayerPool, indexById, parsePlayerPool } from "../src/data/players.js";

/** A minimal valid player, spread-and-overridden per test. */
function makePlayer(overrides: Partial<Player> = {}): unknown {
  return {
    id: "p_09999",
    name: "Test Player",
    position: "WR",
    age: 25,
    nfl_team: "FA",
    years_pro: 3,
    overall: 80,
    attributes: { speed: 90, catching: 85, route_running_short: 80 },
    scheme_tags: ["spread"],
    dev_age_threshold: 26,
    decline_age_threshold: 30,
    injury_history: [],
    contract: null,
    free_agent: true,
    injury_status: null,
    retired: false,
    ...overrides,
  };
}

describe("sample data", () => {
  const pool = loadPlayerPool(undefined, { strictAttributes: true });

  it("loads and validates all 8 sample players", () => {
    expect(pool).toHaveLength(8);
  });

  it("every sample player passes the schema individually", () => {
    for (const p of pool) {
      expect(() => PlayerSchema.parse(p)).not.toThrow();
    }
  });

  it("uses only known attribute keys for its position", () => {
    for (const p of pool) {
      expect(unknownAttributeKeys(p.position, p.attributes)).toEqual([]);
    }
  });

  it("has unique ids and indexes cleanly", () => {
    const idx = indexById(pool);
    expect(idx.size).toBe(pool.length);
    expect(idx.get("p_00001")?.name).toBe("Patrick Mahomes");
  });
});

describe("PlayerSchema validation", () => {
  it("accepts a well-formed player", () => {
    expect(() => PlayerSchema.parse(makePlayer())).not.toThrow();
  });

  it("rejects an out-of-range rating", () => {
    expect(() => PlayerSchema.parse(makePlayer({ overall: 120 }))).toThrow();
  });

  it("rejects an unknown position", () => {
    expect(() =>
      PlayerSchema.parse(makePlayer({ position: "FB" as unknown as Player["position"] })),
    ).toThrow();
  });

  it("rejects a malformed id", () => {
    expect(() => PlayerSchema.parse(makePlayer({ id: "42" }))).toThrow();
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => PlayerSchema.parse({ ...(makePlayer() as object), nickname: "Speedy" })).toThrow();
  });

  it("rejects decline threshold below dev threshold", () => {
    expect(() =>
      PlayerSchema.parse(makePlayer({ dev_age_threshold: 30, decline_age_threshold: 26 })),
    ).toThrow();
  });

  it("rejects a free agent that still has a contract", () => {
    expect(() =>
      PlayerSchema.parse(
        makePlayer({
          free_agent: true,
          contract: {
            team_id: "KC",
            years_remaining: 2,
            total_value: 20_000_000,
            guaranteed: 10_000_000,
            cap_hit_by_year: [8_000_000, 12_000_000],
            signing_bonus: 4_000_000,
          },
        }),
      ),
    ).toThrow();
  });

  it("rejects a rostered player with no contract", () => {
    expect(() =>
      PlayerSchema.parse(makePlayer({ free_agent: false, contract: null, retired: false })),
    ).toThrow();
  });
});

describe("parsePlayerPool", () => {
  it("rejects duplicate ids", () => {
    const a = makePlayer();
    const b = makePlayer();
    expect(() => parsePlayerPool([a, b])).toThrow(/duplicate player id/);
  });

  it("flags unknown attribute keys only under strictAttributes", () => {
    const p = makePlayer({ attributes: { speed: 90, bogus_stat: 50 } });
    expect(() => parsePlayerPool([p])).not.toThrow();
    expect(() => parsePlayerPool([p], { strictAttributes: true })).toThrow(/unknown attribute keys/);
  });

  it("accepts an empty pool", () => {
    expect(PlayerPoolSchema.parse([])).toEqual([]);
  });
});

describe("schema internal consistency", () => {
  it("GENERAL_ATTRIBUTE_KEYS matches the typed keys on AttributesSchema", () => {
    const shapeKeys = Object.keys(AttributesSchema.shape).sort();
    expect(shapeKeys).toEqual([...GENERAL_ATTRIBUTE_KEYS].sort());
  });
});
