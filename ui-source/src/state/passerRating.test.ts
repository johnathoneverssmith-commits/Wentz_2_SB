import { describe, expect, it } from "vitest";

import { passerRating } from "./leagueStats.ts";

describe("passer rating", () => {
  it("matches the NFL formula at the extremes and in between", () => {
    expect(passerRating({ passAtt: 20, passCmp: 20, passYds: 500, passTd: 5, passInt: 0 })).toBe(158.3);
    expect(passerRating({ passAtt: 20, passCmp: 0, passYds: 0, passTd: 0, passInt: 5 })).toBe(0);
    // 2023-type season: 400/600, 4,500 yds, 30 TD, 10 INT
    expect(passerRating({ passAtt: 600, passCmp: 400, passYds: 4500, passTd: 30, passInt: 10 })).toBeCloseTo(98.6, 1);
    expect(passerRating({ passAtt: 5, passCmp: 5 })).toBeNull();
  });
});
