import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginFreeAgencyEvent } from "@/state/freeAgencyEvent.ts";

import { decideFreeAgencyTurn, type Actor } from "../src/decide.js";

/**
 * The five-round free-agency event runs on two different stages across a
 * season — the opening market (`freeAgency`) and Change 9's midseason window
 * (`midseasonFreeAgency`) — reusing the same event machinery and the same
 * `decideFreeAgencyTurn` action both times. The stage transition that fires
 * once the fifth round resolves has to recognise whichever of the two stages
 * is actually running, or a league that plays midseason free agency to its
 * real conclusion — every human passing every turn, same as they would the
 * opening market — is left on that stage forever, with no other control on
 * the screen able to move it on.
 */
function faLeague(stage: Stage): LeagueState {
  const s = createLeague(1470, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  s.stage = stage;
  beginFreeAgencyEvent(s);
  return s;
}

function actorFor(teamCode: string): Actor {
  return { userId: teamCode, leagueId: "l", teamCode, gmId: teamCode };
}

/**
 * Passes every turn until the event resolves — every human passing, exactly
 * as `decideFreeAgencyTurn` itself lets the CPU teams behind them run via
 * `runCpuTurns`. The "on the clock" team is not necessarily human, but
 * `decideFreeAgencyTurn` only checks it against the actor's team code, so
 * this is the real turn-taking path a human's own client drives, not a
 * shortcut around it.
 */
function passToCompletion(s: LeagueState): void {
  let guard = 0;
  while (!s.freeAgencyEvent!.complete && guard++ < 400) {
    const team = s.freeAgencyEvent!.order[s.freeAgencyEvent!.turnIndex]!;
    decideFreeAgencyTurn(s, actorFor(team), { pass: true });
  }
  expect(s.freeAgencyEvent!.complete, "free agency never resolved").toBe(true);
}

describe("decideFreeAgencyTurn — stage transition on completion", () => {
  it("advances freeAgency to freeAgencySummary once the fifth round resolves", () => {
    const s = faLeague("freeAgency");
    passToCompletion(s);
    expect(s.stage).toBe("freeAgencySummary");
  }, 120_000);

  it("advances midseasonFreeAgency to midseasonFreeAgencySummary the same way", () => {
    const s = faLeague("midseasonFreeAgency");
    passToCompletion(s);
    expect(s.stage).toBe("midseasonFreeAgencySummary");
  }, 120_000);
});
