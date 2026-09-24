import { describe, expect, it } from "vitest";

import { runCoachingCarousel } from "./coachingCarousel.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

describe("coaching carousel", () => {
  it("fires a CPU head coach after a four-win season, hires a replacement, and leaves humans alone", () => {
    const s = createLeague(21, { ...DEFAULT_CONFIG, fantasyDraft: false, humanGmCount: 1 });
    const gm = s.gms.find((g) => g.isHuman)!;
    gm.teamCode = "GB";
    s.teams.GB!.controlledBy = { kind: "human", gmId: gm.id };
    for (const c of Object.keys(s.teams)) {
      s.teams[c]!.wins = 9;
      s.teams[c]!.losses = 8;
    }
    s.teams.NYJ!.wins = 3;
    s.teams.NYJ!.losses = 14;
    s.teams.GB!.wins = 2;
    s.teams.GB!.losses = 15;
    const hcOf = (t: string) => Object.values(s.coaches).find((c) => c.team === t && c.role === "HC");
    const before = hcOf("NYJ")!.id;
    const gbBefore = hcOf("GB")!.id;

    const changes = runCoachingCarousel(s);

    expect(changes.some((c) => c.team === "NYJ" && c.role === "HC" && c.reason === "fired")).toBe(true);
    expect(hcOf("NYJ")?.id).not.toBe(before);
    expect(hcOf("NYJ")).toBeTruthy();
    expect(hcOf("GB")!.id).toBe(gbBefore);
    expect(changes.some((c) => c.team === "GB")).toBe(false);
    // every CPU team still has all three
    for (const t of Object.keys(s.teams)) {
      for (const role of ["HC", "OC", "DC"]) {
        expect(Object.values(s.coaches).some((c) => c.team === t && c.role === role), `${t} ${role}`).toBe(true);
      }
    }
  });
});
