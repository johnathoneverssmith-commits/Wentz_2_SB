import { describe, expect, it } from "vitest";

import { MAX_CONTRACT_M } from "@/sim/MockSimulationService";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import {
  applyOffer,
  applyPass,
  beginFreeAgencyEvent,
  checkOffer,
  freeAgencyOrder,
  FREE_AGENCY_ROUNDS,
  leadingOffer,
  onTheClock,
  runCpuTurns,
  unsignedPool,
} from "@/state/freeAgencyEvent.ts";
import { expectedSalary } from "@/state/freeAgencyValues.ts";
import { advanceStage } from "../src/phases.js";

/**
 * Change 4 — the five-round market.
 *
 * Nothing resolves until a round ends. That is the rule the whole event turns
 * on: a player who signed the instant somebody met his price would never hear
 * the better offer two turns later, and bidding late would be worthless.
 */
function faLeague(): LeagueState {
  const s = createLeague(1470, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  beginFreeAgencyEvent(s);
  return s;
}

const aFreeAgent = (s: LeagueState) => unsignedPool(s)[0]!;

describe("the order", () => {
  it("runs strongest roster first", () => {
    const s = faLeague();
    const order = freeAgencyOrder(s);
    const first = s.teams[order[0]!]!.ratings.overall;
    const last = s.teams[order[order.length - 1]!]!.ratings.overall;
    expect(first).toBeGreaterThanOrEqual(last);
  }, 60_000);

  it("is fixed for the whole event", () => {
    const s = faLeague();
    const before = [...s.freeAgencyEvent!.order];
    runCpuTurns(s, new Set());
    expect(s.freeAgencyEvent!.order).toEqual(before);
  }, 120_000);
});

describe("taking a turn", () => {
  it("refuses a team that isn't on the clock", () => {
    const s = faLeague();
    const onClock = onTheClock(s)!;
    const other = Object.keys(s.teams).find((t) => t !== onClock)!;
    const p = aFreeAgent(s);
    expect(checkOffer(s, other, p.id, 10, 3).ok).toBe(false);
  }, 60_000);

  it("refuses a contract outside one to five years", () => {
    const s = faLeague();
    const team = onTheClock(s)!;
    const p = aFreeAgent(s);
    expect(checkOffer(s, team, p.id, 10, 0).ok).toBe(false);
    expect(checkOffer(s, team, p.id, 10, 6).ok).toBe(false);
    expect(checkOffer(s, team, p.id, 10, 3).ok).toBe(true);
  }, 60_000);

  it("allows an offer the team cannot yet afford", () => {
    const s = faLeague();
    const team = onTheClock(s)!;
    const p = aFreeAgent(s);
    // the cap is suspended during bidding and restored at reconciliation
    // (up to the league's max deal: nothing pays more than that)
    expect(checkOffer(s, team, p.id, MAX_CONTRACT_M, 5).ok).toBe(true);
    expect(checkOffer(s, team, p.id, MAX_CONTRACT_M + 1, 5).ok).toBe(false);
  }, 60_000);

  it("passes the clock along", () => {
    const s = faLeague();
    const first = onTheClock(s)!;
    applyPass(s, first);
    expect(onTheClock(s)).not.toBe(first);
  }, 60_000);
});

describe("resolution", () => {
  it("signs nobody until the round ends", () => {
    const s = faLeague();
    const team = onTheClock(s)!;
    const p = aFreeAgent(s);
    applyOffer(s, team, p.id, expectedSalary(p) * 2, 3);
    // an offer well over the asking price, and he is still unsigned
    expect(s.freeAgencyEvent!.signed).toHaveLength(0);
    expect(s.players[p.id]!.free_agent).toBe(true);
    expect(leadingOffer(s, p.id)!.teamCode).toBe(team);
  }, 60_000);

  it("signs him when the round does end", () => {
    const s = faLeague();
    const team = onTheClock(s)!;
    const p = aFreeAgent(s);
    applyOffer(s, team, p.id, expectedSalary(p) * 2, 3);
    // everybody else passes, which closes the round
    let guard = 0;
    while (s.freeAgencyEvent!.round === 1 && guard++ < 40) {
      const next = onTheClock(s);
      if (!next) break;
      applyPass(s, next);
    }
    expect(s.players[p.id]!.free_agent).toBe(false);
    expect(s.players[p.id]!.nfl_team).toBe(team);
    expect(s.players[p.id]!.contract).toBeTruthy();
  }, 60_000);

  it("keeps a losing offer live into the next round", () => {
    const s = faLeague();
    const team = onTheClock(s)!;
    const p = aFreeAgent(s);
    // deliberately short of the asking price, so nobody signs
    applyOffer(s, team, p.id, Math.max(0.5, expectedSalary(p) - 5), 2);
    let guard = 0;
    while (s.freeAgencyEvent!.round === 1 && guard++ < 40) {
      const next = onTheClock(s);
      if (!next) break;
      applyPass(s, next);
    }
    expect(s.players[p.id]!.free_agent).toBe(true);
    // the bid is still on the table in round two
    expect(s.freeAgencyEvent!.offers[p.id]).toHaveLength(1);
  }, 60_000);

  it("ends after five rounds", () => {
    const s = faLeague();
    let guard = 0;
    while (!s.freeAgencyEvent!.complete && guard++ < 400) {
      const team = onTheClock(s);
      if (!team) break;
      applyPass(s, team);
    }
    expect(s.freeAgencyEvent!.complete).toBe(true);
    expect(s.freeAgencyEvent!.round).toBe(FREE_AGENCY_ROUNDS);
  }, 120_000);
});

describe("the CPU", () => {
  it("signs people when left to run the whole market", () => {
    const s = faLeague();
    let guard = 0;
    while (!s.freeAgencyEvent!.complete && guard++ < 40) {
      runCpuTurns(s, new Set());
    }
    expect(s.freeAgencyEvent!.complete).toBe(true);
    expect(s.freeAgencyEvent!.signed.length).toBeGreaterThan(0);
  }, 180_000);

  it("stops on a human team rather than bidding for them", () => {
    const s = faLeague();
    runCpuTurns(s, new Set(["KC", "BUF"]));
    const team = onTheClock(s);
    if (team) expect(["KC", "BUF"]).toContain(team);
  }, 120_000);
});

describe("the mid-season market opened through the server's stage change", () => {
  it("records the market, and has the CPU teams ahead of the first human bid at the mid-season bar", () => {
    const s = createLeague(1470, { ...DEFAULT_CONFIG, humanGmCount: 2 });
    fillRosterGaps(s);
    s.gms[0]!.teamCode = "KC";
    s.gms[0]!.isHuman = true;
    s.gms[1]!.teamCode = "BUF";
    s.gms[1]!.isHuman = true;
    s.stage = "tradeDeadlineSummary";
    s.week = 9;
    // one free agent is left, a tackle three points better than a line of seventies: about four weighted points to
    // every team, over the mid-season bar (3) and under the offseason's (6)
    const free = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
    free.slice(1).forEach((p) => {
      p.retired = true;
    });
    Object.assign(free[0]!, { position: "DT", overall: 73, age: 26 });
    for (const code of Object.keys(s.teams)) {
      s.teams[code]!.cap.total += 300;
      Object.values(s.players)
        .filter((p) => p.nfl_team === code && p.position === "DT" && !p.retired && !p.free_agent)
        .forEach((p, i) => {
          p.overall = i < 5 ? 70 : 40;
        });
    }

    expect(advanceStage(s).moved).toBe(true);

    expect(s.stage).toBe("midseasonFreeAgency");
    const e = s.freeAgencyEvent!;
    expect(e.market).toBe("midseason");
    expect(Object.keys(e.timeline ?? {}).sort(), "the windows are recorded for every team as the market opens").toEqual(Object.keys(s.teams).sort());
    const firstHuman = e.order.findIndex((c) => c === "KC" || c === "BUF");
    const ahead = e.order.slice(0, firstHuman);
    expect(ahead.length, "a human is not first, so some CPU teams act before them").toBeGreaterThan(0);
    // The team first in the order holds the line every team was given, so the tackle is worth about four weighted points
    // to it: over the mid-season bar and under the offseason's. It acts before any human, while the league is entering
    // the stage, so it bids only if the bar follows the market the event was opened for.
    const bidders = new Set(Object.values(e.offers).flat().map((o) => o.teamCode));
    expect(bidders.has(e.order[0]!), `the first team in the order (${e.order[0]}) bid`).toBe(true);
  }, 120_000);
});
