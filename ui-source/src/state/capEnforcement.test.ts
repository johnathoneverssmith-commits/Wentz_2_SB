import { describe, expect, it } from "vitest";

import type { ContractOffer, LeagueState } from "@/domain";

import { createLeague, fillRosterGaps, DEFAULT_CONFIG } from "./seed.ts";
import { checkBid, checkStandingSign } from "./store.ts";

/**
 * signStandingFreeAgent (human-side follow-up to OQ-9's AI cap enforcement):
 * previously this action had no cap check at all - a human GM could sign a
 * standing free agent for any amount regardless of `team.cap.total -
 * team.cap.used`. checkStandingSign is the pure gate it now runs through
 * before the store actually commits the signing.
 */

function fixture(): LeagueState {
  const s = createLeague(1, DEFAULT_CONFIG);
  fillRosterGaps(s);
  return s;
}

function offerFor(teamCode: string, baseSalary: number, years = 1): ContractOffer {
  return { teamCode, baseSalary, signingBonus: 0, years, guaranteed: 0 };
}

/** A real free agent: off a roster, so the signing team has a spot for him. */
function makeFreeAgent(s: LeagueState) {
  const p = Object.values(s.players)[0]!;
  p.free_agent = true;
  p.nfl_team = "FA";
  p.contract = null;
  return p;
}

/** Opens `n` roster spots on `teamCode` so the 53-man gate isn't what trips. */
function openSpots(s: LeagueState, teamCode: string, n: number): void {
  for (const p of Object.values(s.players).filter((x) => x.nfl_team === teamCode).slice(0, n)) {
    p.free_agent = true;
    p.nfl_team = "FA";
    p.contract = null;
  }
}

describe("checkStandingSign", () => {
  it("rejects an offer whose year-1 cap hit exceeds the team's remaining room", () => {
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[0]!;
    const team = s.teams[teamCode]!;
    openSpots(s, teamCode, 1);
    team.cap.total = 200;
    team.cap.used = 195; // 5M room

    const result = checkStandingSign(s, fa.id, offerFor(teamCode, 40)); // way over
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cap space/i);
  });

  it("accepts an offer that fits within remaining cap room", () => {
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[0]!;
    const team = s.teams[teamCode]!;
    openSpots(s, teamCode, 1);
    team.cap.total = 200;
    team.cap.used = 100; // 100M room

    const result = checkStandingSign(s, fa.id, offerFor(teamCode, 5));
    expect(result.ok).toBe(true);
  });

  it("rejects a signing that would put the team over the 53-man limit", () => {
    // all the cap room in the world doesn't buy a 54th roster spot
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[1]!;
    s.teams[teamCode]!.cap.used = 0;

    const result = checkStandingSign(s, fa.id, offerFor(teamCode, 1));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/roster is full/i);
  });

  it("rejects signing a player who isn't actually a free agent", () => {
    const s = fixture();
    const rostered = Object.values(s.players).find((p) => !p.free_agent)!;
    const teamCode = Object.keys(s.teams)[0]!;
    const result = checkStandingSign(s, rostered.id, offerFor(teamCode, 1));
    expect(result.ok).toBe(false);
  });

  it("never mutates the state it's given (read-only check)", () => {
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[0]!;
    const before = JSON.stringify(s.teams[teamCode]);
    checkStandingSign(s, fa.id, offerFor(teamCode, 3));
    expect(JSON.stringify(s.teams[teamCode])).toBe(before);
  });
});

/**
 * The live 5-day window took bids without charging anything, so a GM with $7M
 * of room could sit on six $20M offers and wake up on day 5 having won four of
 * them. `checkBid` treats a team's open bids as money already committed.
 */
describe("checkBid", () => {
  function windowFixture() {
    const s = fixture();
    const teamCode = Object.keys(s.teams)[0]!;
    s.teams[teamCode]!.cap.total = 200;
    s.teams[teamCode]!.cap.used = 180; // $20M of room
    s.freeAgency = {
      subject: "players",
      mode: "main",
      day: 1,
      secondsRemaining: 720,
      interstitialVisible: false,
      bids: {},
      signed: [],
    };
    return { s, teamCode };
  }

  it("allows a first bid that fits the room", () => {
    const { s, teamCode } = windowFixture();
    expect(checkBid(s, "players", "p1", offerFor(teamCode, 15)).ok).toBe(true);
  });

  it("counts the team's other open bids against the room", () => {
    const { s, teamCode } = windowFixture();
    s.freeAgency!.bids["p1"] = [offerFor(teamCode, 15)];
    const result = checkBid(s, "players", "p2", offerFor(teamCode, 15));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/tied up in open bids/i);
  });

  it("lets a GM raise their own standing bid rather than double-counting it", () => {
    const { s, teamCode } = windowFixture();
    s.freeAgency!.bids["p1"] = [offerFor(teamCode, 15)];
    expect(checkBid(s, "players", "p1", offerFor(teamCode, 18)).ok).toBe(true);
  });

  it("frees up the money once a bid has been resolved", () => {
    const { s, teamCode } = windowFixture();
    s.freeAgency!.bids["p1"] = [offerFor(teamCode, 15)];
    s.freeAgency!.signed.push({
      id: "p1",
      toTeam: teamCode,
      baseSalary: 15,
      signingBonus: 0,
      years: 1,
      guaranteed: 0,
      at: 1,
    });
    expect(checkBid(s, "players", "p2", offerFor(teamCode, 15)).ok).toBe(true);
  });

  it("doesn't gate coach bids — coaching salary isn't a player-cap charge", () => {
    const { s, teamCode } = windowFixture();
    expect(checkBid(s, "coaches", "c1", offerFor(teamCode, 99)).ok).toBe(true);
  });
});
