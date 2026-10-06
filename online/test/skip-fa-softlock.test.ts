import { expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { decideSkipPreference, runPendingCpuTurns, type Actor } from "../src/decide.js";
import { advanceStage } from "../src/phases.js";

/**
 * Playthrough: "Skip Free Agency" in year one stayed on, and year two's
 * market finished itself on the way in and then never left its stage — no
 * turn to take, no ready button, a save stuck in the offseason for good.
 *
 * Skipping is for one market. Each market opens with every GM back in, and a
 * market that is over always moves the league on.
 */
function league(): LeagueState {
  const s = createLeague(515, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = "GB";
  s.teams.GB!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
  return s;
}
const me = (s: LeagueState): Actor => ({ userId: "u", leagueId: "l", teamCode: "GB", gmId: s.gms[0]!.id });
const skipping = (s: LeagueState) => !!s.gms[0]!.skips?.freeAgency;

function enterMarket(s: LeagueState): void {
  s.stage = "offseasonDraftSummary";
  s.freeAgencyEvent = null;
  advanceStage(s);
}

it("year one: skipping finishes this market and the league moves on", () => {
  const s = league();
  enterMarket(s);
  expect(s.stage).toBe("freeAgency");
  expect(skipping(s)).toBe(false);
  // GB's turn arrives; skipping passes it and every later one
  decideSkipPreference(s, me(s), "freeAgency", true);
  expect(s.stage).not.toBe("freeAgency");
});

it("year two: the skip has reset, and skipping again still finishes the market", () => {
  const s = league();
  enterMarket(s);
  decideSkipPreference(s, me(s), "freeAgency", true);
  expect(s.stage).not.toBe("freeAgency");

  // next offseason: the market opens with GB back in, waiting on GB's turn
  enterMarket(s);
  expect(s.stage).toBe("freeAgency");
  expect(skipping(s)).toBe(false);
  expect(s.freeAgencyEvent?.complete).toBe(false);

  decideSkipPreference(s, me(s), "freeAgency", true);
  expect(s.stage).not.toBe("freeAgency");
});

it("a save already stuck on a finished market is moved on", () => {
  const s = league();
  enterMarket(s);
  // what an old save looks like: the market over, the stage never left
  s.freeAgencyEvent!.complete = true;
  expect(runPendingCpuTurns(s)).toBe(true);
  expect(s.stage).not.toBe("freeAgency");
});

it("a skip carried in from an old save still cannot trap the market", () => {
  const s = league();
  s.gms[0]!.skips = { freeAgency: true };
  enterMarket(s);
  // reset on the way in, so GB gets the board
  expect(skipping(s)).toBe(false);
  expect(s.stage).toBe("freeAgency");
});
