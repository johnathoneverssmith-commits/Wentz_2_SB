import { describe, expect, it } from "vitest";

import { beginFreeAgencyEvent, onTheClock, runCpuTurns } from "@/state/freeAgencyEvent.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginTradeDeadline, onTheClock as deadlineClock, pendingFor } from "@/state/tradeDeadline.ts";
import type { LeagueState } from "@/domain";

import { decideSkipPreference, type Actor } from "../src/decide.js";

/**
 * "Skip free agency" and "skip the trade deadline", online: one GM's own turns
 * are passed for them and nobody else's, and at the deadline offers made to
 * them still arrive.
 */
function league(): LeagueState {
  const s = createLeague(71, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = "GB";
  s.gms[1]!.isHuman = true;
  s.gms[1]!.teamCode = "KC";
  return s;
}
const as = (teamCode: string, gmId: string): Actor => ({ userId: "u", leagueId: "l", teamCode, gmId });

describe("skipping, online", () => {
  it("passes the skipping GM's turn right now and leaves the other GM's alone", () => {
    const s = league();
    s.stage = "freeAgency";
    beginFreeAgencyEvent(s);
    // the CPU teams ahead of the first human take their turns; skip for whoever is up
    const humans = new Set(["GB", "KC"]);
    runCpuTurns(s, humans);
    const up = onTheClock(s);
    expect(up && humans.has(up), "the market should be waiting on a human").toBe(true);
    if (!up) return;
    const actor = as(up, s.gms.find((g) => g.teamCode === up)!.id);
    const other = up === "GB" ? "KC" : "GB";
    decideSkipPreference(s, actor, "freeAgency", true);
    expect(s.gms.find((g) => g.teamCode === up)!.skips?.freeAgency).toBe(true);
    expect(s.gms.find((g) => g.teamCode === other)!.skips?.freeAgency).toBeFalsy();
    // the clock is now on the other human (or the event is over) — never back on the skipper
    expect(onTheClock(s)).not.toBe(up);
  });

  it("a skipping GM's deadline turn is passed; an offer to them would still wait for them", () => {
    const s = league();
    s.stage = "tradeDeadline";
    beginTradeDeadline(s);
    const gb = as("GB", s.gms.find((g) => g.teamCode === "GB")!.id);
    decideSkipPreference(s, gb, "tradeDeadline", true);
    expect(pendingFor(s, "GB")).not.toBe("propose");
    expect(s.tradeDeadline!.done || deadlineClock(s) !== "GB").toBe(true);
  });

  it("only free agency and the deadline can be skipped", () => {
    const s = league();
    expect(() => decideSkipPreference(s, as("GB", s.gms[0]!.id), "draft" as never, true)).toThrow();
  });
});
