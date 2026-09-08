import { describe, expect, it } from "vitest";

import { PlayerPoolSchema, type Player } from "../src/schema/player.js";
import { buildPlayer, type PlayerSeed } from "../src/model/ratings.js";
import { poolToCsv, csvToPool, attributeColumns } from "../src/data/pool-csv.js";

function seed(over: Partial<PlayerSeed> = {}): PlayerSeed {
  return {
    key: "k",
    name: "Test Player",
    position: "WR",
    age: 25,
    yearsExp: 3,
    draftNumber: 40,
    team: "KC",
    onIR: false,
    practiceSquad: false,
    perf: 0.7,
    ...over,
  };
}

/** A small spread-of-positions pool with real ids. */
function samplePool(): Player[] {
  const seeds: PlayerSeed[] = [
    seed({ key: "a", name: "Aaron Arm", position: "QB", draftNumber: 1 }),
    seed({ key: "b", name: "Bo Back", position: "RB", draftNumber: 60 }),
    seed({ key: "c", name: "Cy Corner", position: "CB", draftNumber: 200, perf: null }),
    seed({ key: "d", name: "Dee Guard", position: "OG", draftNumber: null, perf: null }),
    seed({ key: "e", name: "Ed Kicker", position: "K", draftNumber: null, perf: 0.9 }),
  ];
  return seeds
    .map((s, i) => ({ id: `p_${String(i + 1).padStart(5, "0")}`, ...buildPlayer(s) }))
    .sort((x, y) => y.overall - x.overall || x.name.localeCompare(y.name));
}

describe("poolToCsv", () => {
  it("has one header + one row per player and stable attribute columns", () => {
    const pool = samplePool();
    const lines = poolToCsv(pool).trimEnd().split("\n");
    expect(lines).toHaveLength(pool.length + 1);

    const header = lines[0]!.split(",");
    expect(header.slice(0, 7)).toEqual([
      "id",
      "name",
      "position",
      "age",
      "nfl_team",
      "years_pro",
      "overall",
    ]);
    for (const col of attributeColumns(pool)) expect(header).toContain(col);
    expect(header.slice(-3)).toEqual([
      "contract_json",
      "injury_history_json",
      "injury_status_json",
    ]);
  });

  it("quotes only cells that need it", () => {
    const pool = samplePool();
    // scheme_tags is pipe-joined, never comma -> no quoting anywhere in a clean pool
    expect(poolToCsv(pool)).not.toContain('"');
  });
});

describe("round-trip", () => {
  it("pool -> csv -> pool is identity", () => {
    const pool = samplePool();
    const { players, warnings } = csvToPool(poolToCsv(pool));
    expect(warnings).toEqual([]);
    expect(players).toEqual(pool);
    expect(() => PlayerPoolSchema.parse(players)).not.toThrow();
  });

  it("survives a pool that has jumping on some rows but not others", () => {
    const pool = samplePool(); // WR/RB/CB have jumping, QB/OG/K do not
    const back = csvToPool(poolToCsv(pool)).players;
    const qb = back.find((p) => p.position === "QB")!;
    const wr = back.find((p) => p.position === "WR" || p.position === "RB")!;
    expect(qb.attributes).not.toHaveProperty("jumping");
    expect(wr.attributes).toHaveProperty("jumping");
  });
});

describe("editing", () => {
  const pool = samplePool();
  const csv = poolToCsv(pool);
  const header = csv.split("\n")[0]!.split(",");

  /** Overwrite one or more cells on the row whose `id` matches. */
  function applyEdits(playerId: string, edits: Record<string, string>): string {
    const idCol = header.indexOf("id");
    return csv
      .split("\n")
      .map((line, i) => {
        if (i === 0 || line === "") return line;
        const cells = line.split(",");
        if (cells[idCol] !== playerId) return line;
        for (const [col, value] of Object.entries(edits)) cells[header.indexOf(col)] = value;
        return cells.join(",");
      })
      .join("\n");
  }

  it("applies a hand-edited overall and attribute", () => {
    const target = pool[0]!;
    const { players } = csvToPool(applyEdits(target.id, { overall: "77", awareness: "64" }));
    const updated = players.find((p) => p.id === target.id)!;
    expect(updated.overall).toBe(77);
    expect(updated.attributes.awareness).toBe(64);
  });

  it("clamps an out-of-range rating and warns", () => {
    const { players, warnings } = csvToPool(applyEdits(pool[0]!.id, { overall: "140" }));
    expect(players.find((p) => p.id === pool[0]!.id)!.overall).toBe(99);
    expect(warnings.some((w) => w.includes("overall") && w.includes("clamped"))).toBe(true);
  });

  it("skips a non-numeric attribute cell with a warning", () => {
    const { players, warnings } = csvToPool(applyEdits(pool[0]!.id, { awareness: "high" }));
    expect(players.find((p) => p.id === pool[0]!.id)!.attributes).not.toHaveProperty("awareness");
    expect(warnings.some((w) => w.includes("non-numeric awareness"))).toBe(true);
  });

  it("treats a blanked attribute cell as omitted", () => {
    const { players } = csvToPool(applyEdits(pool[0]!.id, { awareness: "" }));
    expect(players.find((p) => p.id === pool[0]!.id)!.attributes).not.toHaveProperty("awareness");
  });
});

describe("validation errors", () => {
  const csv = poolToCsv(samplePool());

  it("throws with a row number on an invalid position", () => {
    const bad = csv.replace(/,QB,/, ",XX,");
    expect(() => csvToPool(bad)).toThrow(/row \d+/);
  });

  it("throws on a duplicate id", () => {
    const lines = csv.split("\n");
    lines[2] = lines[1]!; // clone row 1's id into row 2
    expect(() => csvToPool(lines.join("\n"))).toThrow(/duplicate id/);
  });
});
