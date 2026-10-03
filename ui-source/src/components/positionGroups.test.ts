import { describe, expect, it } from "vitest";

import { positionFilterLabel, positionMatches } from "./ListFilter";

describe("position groups in the player filter", () => {
  it("a group matches every position in it and nothing else", () => {
    for (const p of ["OT", "OG", "C"]) expect(positionMatches("GROUP:OLINE", p), p).toBe(true);
    for (const p of ["DT", "EDGE", "QB", "CB", "K"]) expect(positionMatches("GROUP:OLINE", p), p).toBe(false);
    expect(positionMatches("GROUP:DB", "S")).toBe(true);
    expect(positionMatches("GROUP:DLINE", "EDGE")).toBe(true);
    expect(positionMatches("GROUP:DEFENSE", "ILB")).toBe(true);
    expect(positionMatches("GROUP:DEFENSE", "WR")).toBe(false);
  });

  it("a single position and 'all' behave as before", () => {
    expect(positionMatches("ALL", "QB")).toBe(true);
    expect(positionMatches("QB", "QB")).toBe(true);
    expect(positionMatches("QB", "RB")).toBe(false);
    expect(positionMatches("GROUP:OLINE", null)).toBe(false);
  });

  it("reads as a phrase in the empty-list message", () => {
    expect(positionFilterLabel("ALL")).toBe("players");
    expect(positionFilterLabel("GROUP:OLINE")).toBe("offensive line");
    expect(positionFilterLabel("QB")).toBe("QB");
  });
});

import { posLabel } from "@/util/format";

describe("how a position reads on screen", () => {
  it("shows LB for ILB and leaves the rest alone", () => {
    expect(posLabel("ILB")).toBe("LB");
    expect(posLabel("OLB")).toBe("OLB");
    expect(posLabel("QB")).toBe("QB");
    expect(posLabel(undefined)).toBeUndefined();
  });
});
