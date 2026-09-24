import { describe, expect, it } from "vitest";

import { campCuts, createLeague, DEFAULT_CONFIG, recomputeTeamRatings } from "./seed.ts";

describe("camp cuts", () => {
  it("a CPU team swaps a camp body for a better unsigned veteran on a camp deal", () => {
    const s = createLeague(9, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const team = Object.keys(s.teams).find((c) => s.teams[c]!.controlledBy.kind === "ai")!;
    const starter = Object.values(s.players).find((p) => p.nfl_team === team && p.position === "WR")!;
    // turn one of his teammates into a camp body
    const body = { ...starter, id: "p_depth_test_1", name: "Camp Body", overall: 55, contract: { ...starter.contract!, cap_hit_by_year: [1], years_remaining: 2 } };
    s.players[body.id] = body;
    // and put a real veteran on the market
    const vet = Object.values(s.players).find((p) => p.position === "WR" && p.nfl_team !== team && s.teams[p.nfl_team])!;
    vet.nfl_team = "FA";
    vet.free_agent = true;
    vet.contract = null;
    vet.overall = 78;
    recomputeTeamRatings(s);
    s.teams[team]!.cap.total = 400; // room is not the question here

    const swaps = campCuts(s);
    expect(swaps).toBeGreaterThan(0);
    expect(s.players[body.id]).toBeUndefined();
    expect(vet.nfl_team).toBe(team);
    expect(vet.contract!.cap_hit_by_year[0]).toBeLessThan(10);
  });
});
