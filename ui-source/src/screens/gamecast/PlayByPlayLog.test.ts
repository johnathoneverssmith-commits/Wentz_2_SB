import { describe, expect, it } from "vitest";

import { playIndicesIn, quartersOf } from "./PlayByPlayLog";

// a drive that starts in Q1 and scores in Q2, and a Q3 drive that runs into Q4
const drives = [
  { quarter: 1, plays: [{ quarter: 1 }, { quarter: 1 }, { quarter: 2 }, { quarter: 2 }] },
  { quarter: 2, plays: [{ quarter: 2 }] },
  { quarter: 3, plays: [{ quarter: 3 }, { quarter: 4 }, { quarter: 4 }] },
];

describe("play-by-play log quarters", () => {
  it("lists quarters from the plays, so a quarter with no newly started drive still has a tab", () => {
    expect(quartersOf(drives)).toEqual([1, 2, 3, 4]);
    expect(quartersOf([{ quarter: 1, plays: [{ quarter: 1 }, { quarter: 3 }] }])).toEqual([1, 3]);
  });

  it("puts each play in its own quarter, keeping its index in the drive", () => {
    expect(playIndicesIn(drives[0]!, 1)).toEqual([0, 1]);
    expect(playIndicesIn(drives[0]!, 2)).toEqual([2, 3]); // the Q2 scoring plays are not filed under Q1
    expect(playIndicesIn(drives[2]!, 4)).toEqual([1, 2]);
    expect(playIndicesIn(drives[2]!, "all")).toEqual([0, 1, 2]);
  });

  it("every play appears in exactly one quarter", () => {
    for (const d of drives) {
      const seen = quartersOf([d]).flatMap((q) => playIndicesIn(d, q));
      expect(seen.sort()).toEqual(d.plays.map((_, i) => i));
    }
  });
});
