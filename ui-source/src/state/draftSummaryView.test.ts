import { describe, expect, it } from "vitest";
import type { Player } from "@/domain";
import { bestValuePicks, strengthsAndWeaknesses } from "./draftSummaryView";

const pl = (id: string, overall: number): Player => ({ id, name: id, position: "WR", age: 24, overall } as unknown as Player);

describe("draft summary view", () => {
  const players = { a: pl("a", 90), b: pl("b", 80), c: pl("c", 85), d: pl("d", 70) };
  const results = [
    { pickNumber: 1, round: 1, teamCode: "X", selectedId: "d" }, // taken first, ranks 4th => negative
    { pickNumber: 2, round: 1, teamCode: "Y", selectedId: "b" },
    { pickNumber: 3, round: 1, teamCode: "X", selectedId: "a" }, // best player taken 3rd => value 2
    { pickNumber: 4, round: 1, teamCode: "X", selectedId: "c" }, // 2nd best taken 4th => value 2
  ];
  it("lists only picks taken later than their rating, biggest first", () => {
    const v = bestValuePicks(results, players, "X");
    expect(v.map((x) => x.id)).toEqual(["a", "c"]);
    expect(v[0]!.value).toBe(2);
    expect(v.every((x) => x.value > 0)).toBe(true);
  });
  it("is empty for a team with no picks", () => {
    expect(bestValuePicks(results, players, "Z")).toEqual([]);
  });
  it("picks strengths and weaknesses from rank, skipping inert units", () => {
    const units = [
      { key: "q", label: "QB", rank: 1, teams: 32, weight: 1 },
      { key: "r", label: "RB", rank: 10, teams: 32, weight: 1 },
      { key: "o", label: "OL", rank: 30, teams: 32, weight: 1 },
      { key: "s", label: "S", rank: 20, teams: 32, weight: 1 },
      { key: "k", label: "K", rank: 32, teams: 32, weight: 0 },
    ];
    const { strengths, weaknesses } = strengthsAndWeaknesses(units);
    expect(strengths.map((u) => u.key)).toEqual(["q", "r"]);
    expect(weaknesses.map((u) => u.key)).toEqual(["o", "s"]);
  });
});
