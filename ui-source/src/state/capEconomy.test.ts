import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { MAX_CONTRACT_M, contractValueFor } from "@/sim/MockSimulationService";
import {
  BASE_CAP_M,
  CAP_GROWTH_MEAN,
  CAP_GROWTH_SPREAD,
  capGrowthRate,
  growCap,
  marketScale,
  minSalaryM,
} from "./capEconomy.ts";
import { extensionAsk, franchiseTagPrice } from "./contracts.ts";
import { offerEligible, expectedSalary } from "./freeAgencyValues.ts";
import { beginFreeAgencyEvent, checkOffer, chooseFaMove, offerRoomFor } from "./freeAgencyEvent.ts";
import { ROSTER_SIZE } from "@/sim/roster-template";
import { rookieSlotFor, standingAsk, finalizeSeason, planCoreResign } from "./rules.ts";
import { awardCompensatoryPicks } from "./draftPicks.ts";
import { practiceSquadEligible, practiceSquadSalaryM } from "./practiceSquad.ts";
import { DEFAULT_CONFIG, createLeague, expireContracts, fillRosterGaps, fitDraftedPayrolls, recomputeTeamRatings } from "./seed.ts";

/**
 * The salary cap rises once a year, deterministically, and what a contract issued today costs rises with it
 * (`capEconomy.ts`); what is already on the books does not.
 */

const built = new Map<number, LeagueState>();
function league(seed: number): LeagueState {
  let base = built.get(seed);
  if (!base) {
    base = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(base);
    for (const g of base.gms) g.isHuman = false;
    for (const t of Object.values(base.teams)) t.controlledBy = { kind: "ai" };
    recomputeTeamRatings(base);
    built.set(seed, base);
  }
  return structuredClone(base);
}

const star = (s: LeagueState): Player => Object.values(s.players).filter((p) => !p.retired && !p.free_agent && p.position === "WR").sort((a, b) => b.overall - a.overall)[0]!;

describe("the cap's yearly growth", () => {
  it("is 5.5% to 9.5% a year, 7.5% on average, and the same for a given league and year", () => {
    const rates: number[] = [];
    for (let seed = 1; seed <= 20; seed++) for (let season = 2025; season < 2045; season++) rates.push(capGrowthRate(seed, season));
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(CAP_GROWTH_MEAN - CAP_GROWTH_SPREAD - 1e-9);
    expect(Math.max(...rates)).toBeLessThan(CAP_GROWTH_MEAN + CAP_GROWTH_SPREAD + 1e-9);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(mean).toBeGreaterThan(0.071);
    expect(mean).toBeLessThan(0.079);
    expect(new Set(rates.map((r) => r.toFixed(4))).size, "it varies from year to year and league to league").toBeGreaterThan(50);
    expect(capGrowthRate(7, 2031)).toBe(capGrowthRate(7, 2031));
    expect(capGrowthRate(7, 2031)).not.toBe(capGrowthRate(7, 2032));
    expect(capGrowthRate(undefined, 2031)).toBe(capGrowthRate(0, 2031)); // a league with no seed grows like seed 0
  });

  it("raises every team's cap by the same rate, and the market scale with it", () => {
    const s = league(11);
    s.season = 2029;
    const rate = growCap(s);
    expect(rate).toBe(capGrowthRate(s.seed, 2029));
    const totals = new Set(Object.values(s.teams).map((t) => t.cap.total));
    expect(totals.size, "one league-wide cap").toBe(1);
    expect([...totals][0]).toBeCloseTo(BASE_CAP_M * (1 + rate), 1);
    expect(s.capScale).toBeCloseTo(1 + rate, 9);
    s.season = 2030;
    const second = growCap(s);
    expect(s.capScale).toBeCloseTo((1 + rate) * (1 + second), 9);
  });

  it("is a league with no scale until the cap first grows: prices are what they always were", () => {
    const s = league(11);
    expect(s.capScale).toBeUndefined();
    expect(marketScale(s)).toBe(1);
    expect(minSalaryM(s)).toBe(1);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(marketScale({ capScale: bad })).toBe(bad === Number.POSITIVE_INFINITY ? 1 : 1);
  });

  it("happens once a year in the shared season rollover, and not for a season that was never played", () => {
    const unplayed = league(12);
    unplayed.season = 2029;
    finalizeSeason(unplayed);
    expect(unplayed.capScale, "a new league's opening offseason is not a played season").toBeUndefined();

    const s = league(12);
    s.season = 2029;
    const [home, away] = Object.keys(s.teams);
    s.games = [{ id: "g1", week: 1, phase: "REG", played: true, homeTeam: home, awayTeam: away, homeScore: 24, awayScore: 17 } as never];
    s.bracket = null;
    const before = s.teams[home!]!.cap.total;
    finalizeSeason(s);
    expect(s.teams[home!]!.cap.total).toBeCloseTo(before * (1 + capGrowthRate(s.seed, 2029)), 1);
    const once = s.capScale;
    finalizeSeason(s); // however a rollover is repeated, the cap rises once for a season
    expect(s.capScale).toBe(once);
    expect(growCap(s)).toBe(0);
    expect(s.capScale).toBe(once);
  });
});

describe("what is already on the books stays the dollars it was", () => {
  it("leaves every contract, guarantee and dead-money charge alone when the cap grows and a league year turns", () => {
    const s = league(13);
    const p = star(s);
    p.contract!.guaranteed = 12.3;
    s.teams[p.nfl_team]!.cap.dead = 4.4;
    const hits = Object.fromEntries(Object.values(s.players).filter((x) => x.contract).map((x) => [x.id, [...x.contract!.cap_hit_by_year]]));
    const guaranteed = p.contract!.guaranteed;
    s.season = 2030;
    growCap(s);
    for (const x of Object.values(s.players)) if (x.contract) expect(x.contract.cap_hit_by_year, x.id).toEqual(hits[x.id]);
    expect(p.contract!.guaranteed).toBe(guaranteed);
    expect(s.teams[p.nfl_team]!.cap.dead, "this year's dead money is untouched by the growth").toBe(4.4);
    // a league year turning ages the deals (a year off each, the next year's hit first) but never reprices them
    const wasYears = p.contract!.years_remaining;
    expireContracts(s);
    if (p.contract && !p.free_agent) {
      expect(p.contract.years_remaining).toBe(wasYears - 1);
      expect(p.contract.cap_hit_by_year).toEqual(hits[p.id]!.slice(hits[p.id]!.length > 1 ? 1 : 0));
    }
  });
});

describe("the market's prices rise with the cap", () => {
  const grown = (seed: number, factor: number): LeagueState => {
    const s = league(seed);
    s.capScale = factor;
    for (const t of Object.values(s.teams)) t.cap.total = Math.round(BASE_CAP_M * factor * 10) / 10;
    return s;
  };

  it("scales a free agent's asking price and the most a deal can pay, and nothing at a scale of 1", () => {
    const s = league(14);
    const p = star(s);
    expect(expectedSalary(p)).toBe(expectedSalary(p, 1));
    for (const k of [1.075, 1.3, 1.9]) {
      expect(expectedSalary(p, k)).toBeCloseTo(expectedSalary(p) * k, 0);
      expect(contractValueFor(p.overall, p.position, k)).toBeCloseTo(contractValueFor(p.overall, p.position) * k, 0);
    }
    const qb = { ...p, position: "QB", overall: 99, age: 27 } as Player;
    expect(expectedSalary(qb, 1.5)).toBeLessThanOrEqual(Math.round(MAX_CONTRACT_M * 1.5 * 10) / 10);
    expect(expectedSalary(qb, 1.5)).toBeGreaterThan(MAX_CONTRACT_M); // the ceiling rose too
  });

  it("holds an offer to the asking price at today's prices", () => {
    const s = grown(14, 1.5);
    const p = star(s);
    const ask = expectedSalary(p, 1.5);
    const offer = { teamCode: "KC", salary: ask - 0.2, years: 3, round: 1, sequence: 0 };
    expect(offerEligible(p, offer, 1.5)).toBe(false);
    expect(offerEligible(p, { ...offer, salary: ask }, 1.5)).toBe(true);
    // an old-save price level would have accepted it
    expect(offerEligible(p, offer)).toBe(true);
  });

  it("lets a deal pay up to the scaled maximum, and no more", () => {
    const s = grown(15, 1.5);
    s.stage = "freeAgency";
    beginFreeAgencyEvent(s);
    const e = s.freeAgencyEvent!;
    const team = e.order[0]!;
    const fa = Object.values(s.players).find((p) => p.free_agent && !p.retired)!;
    const top = Math.round(MAX_CONTRACT_M * 1.5 * 10) / 10;
    expect(checkOffer(s, team, fa.id, top, 3).ok).toBe(true);
    expect(checkOffer(s, team, fa.id, top + 0.5, 3).ok).toBe(false);
    expect(checkOffer(s, team, fa.id, MAX_CONTRACT_M + 0.5, 3).ok, "above the old maximum, below the new").toBe(true);
  });

  it("scales the rookie wage scale, the minimum, the practice squad and an extension's price", () => {
    const base = league(16);
    const s = grown(16, 1.5);
    const prospect = base.draftClass[0]!;
    expect(rookieSlotFor(s, prospect.id, 1)).toBeCloseTo(rookieSlotFor(base, prospect.id, 1) * 1.5, 1);
    expect(minSalaryM(s)).toBe(1.5);
    expect(practiceSquadSalaryM(s)).toBeCloseTo(0.3, 5);
    const p = star(s);
    expect(extensionAsk(p, 1.5).baseSalary).toBeCloseTo(extensionAsk(p).baseSalary * 1.5, 0);
    expect(standingAsk({ stage: "freeAgency", week: 0, capScale: 1.5 }, p)).toBeCloseTo(standingAsk({ stage: "freeAgency", week: 0 }, p) * 1.5, 0);
    // a young player on a minimum deal can still go to the practice squad at a scale where the minimum is above the old limit
    const kid = { ...p, years_pro: 1, contract: { ...p.contract!, cap_hit_by_year: [1.5] } } as Player;
    expect(practiceSquadEligible(kid, 1)).toBe(true);
    kid.contract!.cap_hit_by_year = [2.2];
    expect(practiceSquadEligible(kid, 1)).toBe(false);
    expect(practiceSquadEligible(kid, 1.5)).toBe(true);
  });

  it("scales the cap room a front office keeps back, and not a deal already signed", () => {
    const s = grown(17, 1.5);
    s.stage = "freeAgency";
    beginFreeAgencyEvent(s);
    const code = s.freeAgencyEvent!.order[0]!;
    const rooms = offerRoomFor(s, code);
    const plain = league(17);
    plain.stage = "freeAgency";
    beginFreeAgencyEvent(plain);
    // the same roster costs the same nominal dollars, and the empty spots it still has to fill cost the new minimum
    const plainRoom = offerRoomFor(plain, plain.freeAgencyEvent!.order.find((c) => c === code)!);
    const target = s.teams[code]!.cap.total - plain.teams[code]!.cap.total;
    expect(rooms - plainRoom).toBeLessThan(target + 1e-6);
    expect(rooms - plainRoom).toBeGreaterThan(target - 60); // the extra minimums for empty spots
    expect(planCoreResign(s, code)).toBeDefined();
    expect(franchiseTagPrice(s, star(s))).toBeGreaterThan(0);
  });
});

describe("the room a front office keeps back is a share of the cap, not a number of dollars", () => {
  /** a market with one free agent left (a wide receiver far better than the team's), and a team whose cap room is set exactly */
  function bid(scale: number, headroom: number): "offer" | "pass" {
    const s = league(18);
    s.capScale = scale;
    s.stage = "freeAgency";
    beginFreeAgencyEvent(s);
    const code = s.freeAgencyEvent!.order[0]!;
    const pool = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
    pool.slice(1).forEach((p) => {
      p.retired = true;
    });
    Object.assign(pool[0]!, { position: "WR", overall: 92, age: 26 });
    Object.values(s.players)
      .filter((p) => p.nfl_team === code && p.position === "WR" && !p.retired && !p.free_agent)
      .forEach((p) => {
        p.overall = 55;
      });
    const ask = expectedSalary(pool[0]!, scale);
    s.teams[code]!.cap.total += ask + headroom - offerRoomFor(s, code);
    expect(offerRoomFor(s, code)).toBeCloseTo(ask + headroom, 5);
    return chooseFaMove(s, code).kind;
  }

  it("keeps back $2M at the starting prices and $3M once the cap has risen by half", () => {
    expect(bid(1, 1.5)).toBe("pass");
    expect(bid(1, 2.5)).toBe("offer");
    expect(bid(1.5, 2.5)).toBe("pass");
    expect(bid(1.5, 3.5)).toBe("offer");
  });

  it("trims a payroll to the cap less the working room, which rises with the cap", () => {
    const at = (scale: number): number => {
      const s = league(19);
      s.capScale = scale;
      const code = Object.keys(s.teams)[0]!;
      for (const t of Object.values(s.teams)) t.cap.total = Math.round(BASE_CAP_M * scale * 10) / 10;
      for (const p of Object.values(s.players)) if (!p.retired && !p.free_agent && p.nfl_team === code && p.contract) {
        p.contract.cap_hit_by_year = p.contract.cap_hit_by_year.map((x) => x * 3 * scale);
      }
      fitDraftedPayrolls(s);
      const roster = Object.values(s.players).filter((p) => !p.retired && !p.free_agent && p.nfl_team === code && p.contract);
      const payroll = roster.reduce((n, p) => n + p.contract!.cap_hit_by_year[0]!, 0);
      const open = Math.max(0, ROSTER_SIZE - roster.length);
      return s.teams[code]!.cap.total - open * minSalaryM(s) - payroll; // the room it left
    };
    expect(at(1)).toBeGreaterThan(15);
    expect(at(1)).toBeLessThan(18);
    expect(at(1.5)).toBeGreaterThan(23);
    expect(at(1.5)).toBeLessThan(26);
  });

  it("reads a deal's compensatory value at the prices of the year: a minimum deal never earns a pick, a mid-sized one earns the same round", () => {
    /** the round of the pick the loss earns, or 0 for none */
    const run = (hit: number, scale: number): number => {
      const s = league(20);
      s.capScale = scale;
      const [from, to] = Object.keys(s.teams) as [string, string];
      const p = star(s);
      p.nfl_team = to;
      Object.assign(p, { expired_season: s.season - 1, expired_from: from });
      p.contract!.cap_hit_by_year = [hit];
      return awardCompensatoryPicks(s)[0]?.round ?? 0;
    };
    expect(run(1.2, 1)).toBe(0);
    expect(run(1.2 * 1.5, 1.5), "a minimum deal at 1.5x prices is still a minimum deal").toBe(0);
    expect(run(8, 1)).toBe(5);
    expect(run(8 * 1.5, 1.5), "the same deal at 1.5x prices earns the same round").toBe(5);
    expect(run(8, 1.5), "$8M at 1.5x prices is a smaller deal").toBe(6);
  });
});
