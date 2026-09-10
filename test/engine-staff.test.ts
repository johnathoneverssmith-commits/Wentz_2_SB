import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { simulateGame } from "../src/engine/sim.js";
import {
  type Staff,
  leagueAverageStaff,
  ratingNorm,
} from "../src/engine/staff.js";
import { allStaffs, teamStaff } from "../src/engine/staff-data.js";
import {
  dcDefenseShift,
  hcGoForItDelta,
  hcPenaltyScale,
  ocOffenseShift,
  ocTempoScale,
} from "../src/engine/staff-shift.js";

/**
 * Phase A1 add-on: the coaching layer. Its contract is (1) a league-average
 * staff is a no-op — every shift is exactly zero, so a staff-on game with
 * neutral staffs is byte-identical to staff-off — and (2) a real staff moves
 * outcomes, but only a little.
 */

describe("staff shift math (pool-free)", () => {
  const avg = leagueAverageStaff();

  it("league-average staff produces zero from every shift function", () => {
    expect(hcPenaltyScale(avg.headCoach)).toBe(1);
    expect(hcGoForItDelta(avg.headCoach)).toBe(0);
    expect(ocTempoScale(avg.oc)).toBe(1);
    expect(ocOffenseShift(avg.oc)).toEqual({ complete: 0, rush: 0 });
    expect(dcDefenseShift(avg.dc)).toEqual({ complete: 0, rush: 0, sack: 0 });
  });

  it("ratingNorm maps 50→0 and clips at ±1", () => {
    expect(ratingNorm(50)).toBe(0);
    expect(ratingNorm(90)).toBe(1);
    expect(ratingNorm(10)).toBe(-1);
    expect(ratingNorm(99)).toBe(1);
  });

  it("shifts move in the right direction and stay small", () => {
    const elite: Staff["headCoach"] = { name: "e", gameManagement: 90, discipline: 90, aggression: 1 };
    const weak: Staff["headCoach"] = { name: "w", gameManagement: 10, discipline: 10, aggression: -1 };
    expect(hcPenaltyScale(elite)).toBeLessThan(1); // disciplined → fewer flags
    expect(hcPenaltyScale(weak)).toBeGreaterThan(1);
    expect(hcGoForItDelta(elite)).toBeGreaterThan(0.4);
    expect(Math.abs(hcGoForItDelta(elite))).toBeLessThan(0.7);

    const eliteOc: Staff["oc"] = { name: "e", rating: 95, scheme: "spread", passBias: 0, tempo: 1 };
    expect(ocOffenseShift(eliteOc).complete).toBeGreaterThan(0);
    expect(ocOffenseShift(eliteOc).complete).toBeLessThan(0.06);
    expect(ocTempoScale(eliteOc)).toBeLessThan(1); // faster → less runoff

    const eliteDc: Staff["dc"] = { name: "e", rating: 95, scheme: "man_press", blitzBias: 1 };
    const d = dcDefenseShift(eliteDc);
    expect(d.complete).toBeLessThan(0.1); // net: suppression minus blitz-beaten
    expect(d.sack).toBeGreaterThan(0); // pressure up
    expect(d.rush).toBeLessThan(0); // run D up
  });

  it("authored staff data covers all 32 teams on a compressed scale", () => {
    const all = allStaffs();
    expect(Object.keys(all).sort()).toEqual([...NFL_TEAMS].sort());
    for (const s of Object.values(all)) {
      for (const r of [s.headCoach.gameManagement, s.headCoach.discipline, s.oc.rating, s.dc.rating]) {
        expect(r).toBeGreaterThanOrEqual(30);
        expect(r).toBeLessThanOrEqual(75);
      }
      expect(Math.abs(s.headCoach.aggression)).toBeLessThanOrEqual(1);
    }
  });
});

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("staff in simulateGame", () => {
  const avg = leagueAverageStaff();

  it("a neutral staff is byte-identical to staff-off", () => {
    for (const seed of [1, 50, 777]) {
      const off = simulateGame(seed, "KC", "BUF");
      const neutral = simulateGame(seed, "KC", "BUF", { homeStaff: avg, awayStaff: avg });
      expect(neutral.score).toEqual(off.score);
      expect(neutral.teams[0].s).toEqual(off.teams[0].s);
      expect(neutral.teams[1].s).toEqual(off.teams[1].s);
    }
  });

  it("staff needs both sides — one-sided or roster-less staff is ignored", () => {
    const a = simulateGame(3, "KC", "BUF");
    const b = simulateGame(3, "KC", "BUF", { homeStaff: teamStaff("KC") });
    expect(b.score).toEqual(a.score); // only home staff → no-op
    const c = simulateGame(3, undefined, undefined, {
      homeStaff: teamStaff("KC"),
      awayStaff: teamStaff("BUF"),
    });
    expect(c.score[0] + c.score[1]).toBeGreaterThan(0); // ran fine, just no ratings/staff
  });

  it("a real staff mismatch nudges the score but not wildly", { timeout: 120_000 }, () => {
    const great: Staff = {
      headCoach: { name: "G", gameManagement: 95, discipline: 95, aggression: 0.6 },
      oc: { name: "G", rating: 95, scheme: "spread", passBias: 0.2, tempo: 0.3 },
      dc: { name: "G", rating: 95, scheme: "multiple", blitzBias: 0.2 },
    };
    const poor: Staff = {
      headCoach: { name: "P", gameManagement: 10, discipline: 10, aggression: -0.4 },
      oc: { name: "P", rating: 10, scheme: "power_run", passBias: -0.2, tempo: -0.3 },
      dc: { name: "P", rating: 10, scheme: "three_four", blitzBias: -0.2 },
    };
    const N = 60;
    let marginGreatHome = 0;
    let marginPoorHome = 0;
    for (let i = 0; i < N; i += 1) {
      const g1 = simulateGame(9000 + i, "KC", "BUF", { homeStaff: great, awayStaff: poor });
      const g2 = simulateGame(9000 + i, "KC", "BUF", { homeStaff: poor, awayStaff: great });
      marginGreatHome += g1.score[0] - g1.score[1];
      marginPoorHome += g2.score[0] - g2.score[1];
    }
    const swing = marginGreatHome / N - marginPoorHome / N;
    // a *contrived* 95-vs-10 staff gap (far wider than any authored team) —
    // some points of margin, not a blowout. 60 games ⇒ ±3 noise.
    expect(swing).toBeGreaterThan(1);
    expect(swing).toBeLessThan(14);
  });

  it("is deterministic", () => {
    const s = { homeStaff: teamStaff("KC"), awayStaff: teamStaff("BUF") };
    expect(simulateGame(42, "KC", "BUF", s).score).toEqual(
      simulateGame(42, "KC", "BUF", s).score,
    );
  });
});
