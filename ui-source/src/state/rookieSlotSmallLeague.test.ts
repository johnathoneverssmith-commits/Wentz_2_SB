import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { rookieSlotFor, rookieSlotSalary } from "./rules.ts";

/**
 * A four-team humans-only league's seventh-rounder is pick 25, and the NFL
 * scale paid him — and everyone drafted before him — like a first-rounder.
 */
const league = (teams: number, pickNumber: number) =>
  ({
    teams: Object.fromEntries(Array.from({ length: teams }, (_, i) => [`T${i}`, {}])),
    draft: { results: [{ selectedId: "p", pickNumber }] },
  }) as unknown as LeagueState;

describe("rookie slot pay", () => {
  it("is unchanged in a 32-team league", () => {
    for (const pick of [1, 32, 33, 100, 224]) expect(rookieSlotFor(league(32, pick), "p", 1)).toBe(rookieSlotSalary(pick));
  });

  it("prices a small league's pick where it would fall in a 32-team draft", () => {
    // pick 9 of a 4-team league: the first pick of round three
    expect(rookieSlotFor(league(4, 9), "p", 3)).toBe(rookieSlotSalary(65));
    // pick 25: the first pick of round seven, not a late first-rounder
    expect(rookieSlotFor(league(4, 25), "p", 7)).toBe(rookieSlotSalary(193));
    expect(rookieSlotFor(league(4, 25), "p", 7)).toBeLessThan(rookieSlotSalary(25) / 2);
  });
});
