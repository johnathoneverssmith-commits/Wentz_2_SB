import { describe, expect, it } from "vitest";

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
    expect(checkOffer(s, team, p.id, 900, 5).ok).toBe(true);
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
