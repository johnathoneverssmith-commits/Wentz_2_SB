import { describe, expect, it } from "vitest";

import { currentScreen } from "./stageMachine.ts";
import { awardsSeenBy, markStep, stepOf } from "./reveal.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

/**
 * Playthrough: only one human GM was shown the end-of-season awards. Seeing
 * them is each GM's own step: the season screen opens on the awards for every
 * GM until that GM has seen them, and one GM seeing them shows nobody else's.
 */
describe("season awards are seen per GM", () => {
  const league = () => {
    const s = createLeague(5, { ...DEFAULT_CONFIG, humanGmCount: 2 });
    s.gms[0]!.isHuman = true;
    s.gms[1]!.isHuman = true;
    s.stage = "endOfSeasonConsolation";
    s.awards = [{ season: s.season, award: "MVP", playerId: "p", name: "A Player", position: "QB", team: "GB", line: "x" } as never];
    return s;
  };

  it("each GM opens on the awards until they have seen them", () => {
    const s = league();
    const [a, b] = [s.gms[0]!.id, s.gms[1]!.id];
    expect(currentScreen(s.stage, stepOf(s, a)).route).toBe("/end-of-season");
    markStep(s, a, "awardsSeen");
    expect(awardsSeenBy(s, a)).toBe(true);
    expect(currentScreen(s.stage, stepOf(s, a)).route).toBe("/season-complete");
    // the other GM has not seen them
    expect(awardsSeenBy(s, b)).toBe(false);
    expect(currentScreen(s.stage, stepOf(s, b)).route).toBe("/end-of-season");
  });

  it("is a fresh question every season, and not a question when there are no awards", () => {
    const s = league();
    markStep(s, s.gms[0]!.id, "awardsSeen");
    s.season += 1;
    expect(awardsSeenBy(s, s.gms[0]!.id)).toBe(true); // no awards yet this season
    s.awards = [...(s.awards ?? []), { season: s.season, award: "MVP", playerId: "q", name: "B Player", position: "QB", team: "KC", line: "y" } as never];
    expect(awardsSeenBy(s, s.gms[0]!.id)).toBe(false);
  });
});
