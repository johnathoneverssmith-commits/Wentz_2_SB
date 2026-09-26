import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { humanGate, turnEventOpen } from "./rules.ts";
import type { LeagueState } from "@/domain";

/**
 * Readiness never ends a turn-based event.
 *
 * An online playthrough skipped the whole midseason market: a ready click
 * that raced the league onto the next stage counted there, every GM was
 * ready, and the stage left at round one, turn one. The fantasy draft had
 * the same hole (left at pick 20 of 640). The events end themselves.
 */
function ready(stage: LeagueState["stage"]): LeagueState {
  const s = createLeague(7, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  s.gms[0]!.teamCode = "GB";
  s.gms[0]!.isHuman = true;
  s.stage = stage;
  for (const g of s.gms) s.readiness[g.id] = true;
  return s;
}

describe("the readiness gate and turn-based events", () => {
  it("holds free agency until the market completes", () => {
    for (const stage of ["freeAgency", "midseasonFreeAgency"] as const) {
      const s = ready(stage);
      s.freeAgencyEvent = { round: 1, order: ["GB"], turnIndex: 0, offers: {}, signed: [], actedThisRound: [], complete: false };
      expect(turnEventOpen(s)).toBe(true);
      expect(humanGate(s)).toBe(false);
      s.freeAgencyEvent.complete = true;
      expect(humanGate(s)).toBe(true);
    }
  });

  it("holds the trade deadline until it is done", () => {
    const s = ready("tradeDeadline");
    s.tradeDeadline = { done: false } as unknown as LeagueState["tradeDeadline"];
    expect(humanGate(s)).toBe(false);
    s.tradeDeadline!.done = true;
    expect(humanGate(s)).toBe(true);
  });

  it("holds the coaching draft until every pick is in", () => {
    const s = ready("coachingDraft");
    s.coachingDraft = { pickOrder: ["GB", "KC"], currentPickIndex: 1 } as unknown as LeagueState["coachingDraft"];
    expect(humanGate(s)).toBe(false);
    s.coachingDraft!.currentPickIndex = 2;
    expect(humanGate(s)).toBe(true);
  });

  it("leaves ordinary stages to readiness", () => {
    expect(humanGate(ready("freeAgencySummary"))).toBe(true);
  });
});
