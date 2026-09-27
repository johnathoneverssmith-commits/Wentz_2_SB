import { describe, expect, it } from "vitest";

import { MockSimulationService } from "@/sim/MockSimulationService";
import { beginDraft, draftTargetsFor, planAutopicks } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { decideDraftTarget } from "../src/decide.js";

/**
 * Draft stars used to live on the previous draft object: starred in the
 * preview, wiped when the new draft began, and never saved online at all —
 * the next refresh from the server erased them. They are league state now.
 */
describe("draft targets", () => {
  function league() {
    const s = createLeague(3, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
    fillRosterGaps(s);
    s.gms[0]!.teamCode = "GB";
    s.gms[0]!.isHuman = true;
    s.draftClass = new MockSimulationService().generateDraftClass(s.season, s.season);
    return s;
  }
  const actor = (s: ReturnType<typeof league>) => ({
    leagueId: "t",
    gmId: s.gms[0]!.id,
    teamCode: "GB",
    userId: "u",
  });

  it("toggles a star on league state and survives the draft beginning", () => {
    const s = league();
    const late = s.draftClass[s.draftClass.length - 1]!.id;
    decideDraftTarget(s, actor(s), late);
    expect(draftTargetsFor(s, s.gms[0]!.id)).toEqual([late]);
    s.stage = "offseasonDraft";
    beginDraft(s, "rookie");
    expect(draftTargetsFor(s, s.gms[0]!.id)).toEqual([late]);
    decideDraftTarget(s, actor(s), late);
    expect(draftTargetsFor(s, s.gms[0]!.id)).toEqual([]);
  });

  it("refuses a prospect who isn't in the class", () => {
    const s = league();
    expect(() => decideDraftTarget(s, actor(s), "nobody")).toThrow();
  });

  it("an expired clock picks the GM's own star before the board's best", () => {
    const s = league();
    const late = s.draftClass[s.draftClass.length - 1]!.id;
    decideDraftTarget(s, actor(s), late);
    s.stage = "offseasonDraft";
    beginDraft(s, "rookie");
    const at = s.draft!.pickOrder.indexOf("GB");
    const picks = planAutopicks(s);
    expect(picks[at - s.draft!.currentPickIndex]).toBe(late);
  });
});
