import { describe, expect, it } from "vitest";

import { applyPass, beginFreeAgencyEvent, onTheClock, runCpuTurns } from "./freeAgencyEvent.ts";
import { FA_ROUNDS_MAX, beginDraft, cleanConfigPatch, draftThresholdMet, humanDraftRounds, humanFaRounds } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import type { LeagueState } from "@/domain";
import { FREE_AGENCY_ROUNDS } from "./freeAgencyEvent.ts";

function league(over: Partial<LeagueState["config"]> = {}): LeagueState {
  const s = createLeague(33, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false, ...over });
  fillRosterGaps(s);
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = "GB";
  s.teams.GB!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
  return s;
}

describe("how many rounds the humans play by hand", () => {
  it("free agency's round count in the rules file matches the market's", () => {
    expect(FA_ROUNDS_MAX).toBe(FREE_AGENCY_ROUNDS);
  });

  it("the rookie draft hands over to the staff after the league's rounds", () => {
    for (const rounds of [1, 2, 3]) {
      const s = league({ draftHumanRounds: rounds });
      s.stage = "offseasonDraft";
      beginDraft(s, "rookie");
      const teams = Object.keys(s.teams).length;
      const d = s.draft!;
      d.currentPickIndex = 0;
      expect(draftThresholdMet(s), `round 1 of ${rounds}`).toBe(false);
      d.currentPickIndex = rounds * teams - 1;
      expect(draftThresholdMet(s), `last pick of round ${rounds}`).toBe(false);
      d.currentPickIndex = d.pickOrder.length - 1;
      expect(draftThresholdMet(s), `the last pick of the draft is the staff's`).toBe(true);
    }
  });

  it("all rounds by hand never hands over", () => {
    const s = league({ draftHumanRounds: null });
    s.stage = "offseasonDraft";
    beginDraft(s, "rookie");
    s.draft!.currentPickIndex = s.draft!.pickOrder.length - 1;
    expect(draftThresholdMet(s)).toBe(false);
  });

  it("a save from before the setting still drafts one round by hand", () => {
    const s = league();
    delete (s.config as { draftHumanRounds?: unknown }).draftHumanRounds;
    expect(humanDraftRounds(s.config)).toBe(1);
    expect(humanFaRounds(s.config)).toBeNull();
  });

  it("free agency: the human takes their turn in the first rounds, the staff after", () => {
    const s = league({ faHumanRounds: 2 });
    s.stage = "freeAgency";
    beginFreeAgencyEvent(s);
    const humans = new Set(["GB"]);
    const seen: number[] = [];
    for (let guard = 0; guard < 40 && !s.freeAgencyEvent!.complete; guard++) {
      runCpuTurns(s, humans);
      const e = s.freeAgencyEvent!;
      if (e.complete) break;
      // stopped on the human: only ever in a round they play by hand
      expect(onTheClock(s)).toBe("GB");
      seen.push(e.round);
      expect(e.round).toBeLessThanOrEqual(2);
      // they pass, as a person would
      applyPass(s, "GB");
    }
    expect(seen).toEqual([1, 2]);
    expect(s.freeAgencyEvent!.complete).toBe(true);
  });

  it("the settings change at the start of an offseason, not mid-season", () => {
    const s = league();
    s.stage = "regularSeason";
    expect(cleanConfigPatch(s, { draftHumanRounds: 2 }).ok).toBe(false);
    s.stage = "endOfSeasonWin";
    const ok = cleanConfigPatch(s, { draftHumanRounds: 2, faHumanRounds: null });
    expect(ok.ok).toBe(true);
    expect(cleanConfigPatch(s, { draftHumanRounds: 9 }).ok).toBe(false);
    expect(cleanConfigPatch(s, { talentImpact: "extreme" }).ok).toBe(false);
    s.stage = "setup";
    expect(cleanConfigPatch(s, { talentImpact: "extreme", draftHumanRounds: 3 }).ok).toBe(true);
  });
});
