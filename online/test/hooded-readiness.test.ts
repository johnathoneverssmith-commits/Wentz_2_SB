import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { clearReadinessOnline } from "../src/phases.js";

/**
 * The Hooded Figure visits one GM; the others were held at an empty
 * "Nothing unusual this year" screen until they checked in too.
 */
const league = (stage: string) =>
  ({
    stage,
    season: 2028,
    readiness: {},
    gms: [
      { id: "g1", isHuman: true, teamCode: "GB" },
      { id: "g2", isHuman: true, teamCode: "KC" },
      { id: "cpu", isHuman: false, teamCode: "DEN" },
    ],
    hoodedFigure: { encountersBySeason: { 2028: { KC: { teamCode: "KC", resolved: false } } } },
  }) as unknown as LeagueState;

describe("readiness at the Hooded Figure", () => {
  it("checks in every GM the figure isn't visiting", () => {
    const s = league("hoodedFigureEncounter");
    clearReadinessOnline(s);
    expect(s.readiness).toEqual({ g1: true, g2: false, cpu: true });
  });

  it("leaves other stages alone", () => {
    const s = league("offseasonDepthChart");
    clearReadinessOnline(s);
    expect(s.readiness).toEqual({ g1: false, g2: false, cpu: true });
  });
});
