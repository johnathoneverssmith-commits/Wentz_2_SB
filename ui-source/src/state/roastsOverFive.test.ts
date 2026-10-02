import { expect, it } from "vitest";

import { roastFor, type RoastContext } from "./roasts.ts";

/** "in the field at 1 game over .500" was said of a 3-4 team. */
it("never calls a team at or under .500 games over it", () => {
  for (let week = 0; week < 60; week++) {
    const ctx = {
      teamCode: "GB",
      gmName: "Sam",
      bestPlayer: "Somebody",
      weakestUnit: "secondary",
      biggestMargin: -1,
      fromDraft: false,
      race: { inField: true, eliminated: false },
      onBye: false,
    } as unknown as RoastContext;
    expect(roastFor(ctx, `week|2027|${week}`)).not.toMatch(/over \.500/);
  }
});
