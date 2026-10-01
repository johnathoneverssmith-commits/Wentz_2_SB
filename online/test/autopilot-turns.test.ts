import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { beginCoachingDraft, coachingOnTheClock, runAiCoachingPicks } from "@/state/coachingDraft.ts";
import { beginFreeAgencyEvent, onTheClock, runCpuTurns } from "@/state/freeAgencyEvent.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { runPendingCpuTurns } from "../src/decide.js";
import { takeNotes } from "../src/notes.js";
import { autopilotAbsent, isTurnStage, turnKey } from "../src/phases.js";

/**
 * An expired clock takes the absent GM's turn in every turn-based event.
 *
 * Only the draft used to: a GM who went quiet on the clock in the coaching
 * draft or a free-agency market held every other GM there until the
 * commissioner forced the whole stage past, skipping everyone's turns.
 */
function league(stage: Stage): LeagueState {
  const s = createLeague(8080, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  for (let i = 2; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  s.stage = stage;
  return s;
}
const humans = new Set(["KC", "BUF"]);

describe("an expired clock in a turn-based event", () => {
  it("hires for the absent GM in the coaching draft", () => {
    const s = league("coachingDraft");
    beginCoachingDraft(s);
    runAiCoachingPicks(s, humans);
    const on = coachingOnTheClock(s)!;
    expect(humans.has(on)).toBe(true);
    const before = s.coachingDraft!.currentPickIndex;
    expect(autopilotAbsent(s)).toContain(on);
    expect(s.coachingDraft!.currentPickIndex).toBeGreaterThan(before);
    // and the wire says which coach, not just that "their staff acted"
    expect(takeNotes(s).some((n) => n.teamCode === on && /their staff hired /.test(n.summary))).toBe(true);
  });

  it("says the commissioner did it, when the commissioner did", () => {
    const s = league("freeAgency");
    beginFreeAgencyEvent(s);
    runCpuTurns(s, humans);
    const on = onTheClock(s)!;
    expect(autopilotAbsent(s, "commissioner")).toContain(on);
    const note = takeNotes(s).find((n) => n.teamCode === on);
    expect(note?.summary).toMatch(/^The commissioner had .+'s staff take their turn: they passed/);
  });

  it("passes for the absent GM in free agency", () => {
    const s = league("freeAgency");
    beginFreeAgencyEvent(s);
    runCpuTurns(s, humans);
    const on = onTheClock(s)!;
    expect(humans.has(on)).toBe(true);
    const key = turnKey(s);
    expect(autopilotAbsent(s)).toContain(on);
    expect(turnKey(s)).not.toBe(key);
    expect(takeNotes(s).some((n) => n.teamCode === on && /passed on their free-agency turn/.test(n.summary))).toBe(true);
  });

  it("moves on when the team on the clock became a CPU team (a seat reopened)", () => {
    const s = league("coachingDraft");
    beginCoachingDraft(s);
    runAiCoachingPicks(s, humans);
    const on = coachingOnTheClock(s)!;
    // the commissioner reopens that seat: the GM is gone, the CPU has the team
    s.gms.find((g) => g.teamCode === on)!.isHuman = false;
    const before = s.coachingDraft!.currentPickIndex;
    autopilotAbsent(s);
    expect(s.coachingDraft!.currentPickIndex).toBeGreaterThan(before);
    expect(coachingOnTheClock(s)).not.toBe(on);
  });

  it("does the same in free agency, straight from the reopened seat", () => {
    const s = league("freeAgency");
    beginFreeAgencyEvent(s);
    runCpuTurns(s, humans);
    const on = onTheClock(s)!;
    s.gms.find((g) => g.teamCode === on)!.isHuman = false;
    const key = turnKey(s);
    runPendingCpuTurns(s);
    expect(turnKey(s)).not.toBe(key);
  });

  it("uses the per-turn clock for every turn-based stage", () => {
    for (const stage of ["fantasyDraft", "offseasonDraft", "coachingDraft", "freeAgency", "midseasonFreeAgency", "tradeDeadline"]) {
      expect(isTurnStage(stage), stage).toBe(true);
    }
    expect(isTurnStage("freeAgencySummary")).toBe(false);
  });
});
