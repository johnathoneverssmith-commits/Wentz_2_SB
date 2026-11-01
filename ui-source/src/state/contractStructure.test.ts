import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { CONTRACT_STRUCTURES, STRUCTURE_TILT, buildSchedule, scheduleOf, structureWeights } from "./contractStructure.ts";
import { chooseStructure } from "./cpuContracts.ts";
import { extendContract, previewRestructure, restructureContract } from "./contracts.ts";
import { releasePenalty } from "./releaseCost.ts";
import { beginFreeAgencyEvent, applyOffer, onTheClock, runCpuTurns } from "./freeAgencyEvent.ts";
import { createLeague, DEFAULT_CONFIG, expireContracts, fillRosterGaps } from "./seed.ts";
import { upgradeLeagueState } from "./saveMigration.ts";
import { offerToContract } from "./rules.ts";
import { minSalaryM } from "./capEconomy.ts";

const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 10) / 10;

describe("schedules", () => {
  it("every structure pays the same total for the same average salary", () => {
    for (const years of [2, 3, 4, 5]) {
      const totals = CONTRACT_STRUCTURES.map((st) => buildSchedule({ salary: 20, years, structure: st }).total_value);
      expect(new Set(totals).size, `${years}y`).toBe(1);
      expect(totals[0]).toBe(20 * years);
    }
  });

  it("backloaded charges less early and more late than even; frontloaded the reverse", () => {
    const even = buildSchedule({ salary: 20, years: 4, structure: "even" }).cap_hit_by_year;
    const back = buildSchedule({ salary: 20, years: 4, structure: "backloaded" }).cap_hit_by_year;
    const front = buildSchedule({ salary: 20, years: 4, structure: "frontloaded" }).cap_hit_by_year;
    expect(even).toEqual([20, 20, 20, 20]);
    expect(back[0]!).toBeLessThan(even[0]!);
    expect(back[3]!).toBeGreaterThan(even[3]!);
    expect(front[0]!).toBeGreaterThan(even[0]!);
    expect(front[3]!).toBeLessThan(even[3]!);
    // monotone shapes
    expect([...back].sort((a, b) => a - b)).toEqual(back);
    expect([...front].sort((a, b) => b - a)).toEqual(front);
    // and bounded: year one is never more than ~20% under, so a salary cannot be hidden
    expect(back[0]!).toBeGreaterThan(20 * (1 - STRUCTURE_TILT));
    console.log("4y, $20M APY:", { even, back, front });
  });

  it("splits each year into salary and bonus proration that add up to the hit, and sum to the bonus", () => {
    for (const st of CONTRACT_STRUCTURES) {
      const s = buildSchedule({ salary: 13.7, years: 5, structure: st });
      s.cap_hit_by_year.forEach((h, i) => expect(Math.abs(s.salary_by_year[i]! + s.guaranteed_by_year[i]! - h)).toBeLessThan(0.051));
      expect(sum(s.guaranteed_by_year)).toBe(s.signing_bonus);
      expect(s.guaranteed).toBe(s.signing_bonus);
    }
  });

  it("never shapes a year under the league minimum", () => {
    const s = buildSchedule({ salary: 1.2, years: 4, structure: "backloaded", minSalary: 1.1 });
    expect(Math.min(...s.cap_hit_by_year)).toBeGreaterThanOrEqual(1.1 - 0.051);
    expect(sum(s.cap_hit_by_year)).toBe(4.8);
  });

  it("a one-year deal has nothing to shape", () => {
    expect(structureWeights(1, "backloaded")).toEqual([1]);
    expect(buildSchedule({ salary: 5, years: 1, structure: "backloaded" }).cap_hit_by_year).toEqual([5]);
  });

  it("ignores a split that no longer adds up (a rescaled or hand-edited deal)", () => {
    const c = offerToContract({ teamCode: "KC", baseSalary: 10, years: 3, signingBonus: 0, guaranteed: 0, structure: "backloaded" });
    expect(scheduleOf(c)).not.toBeNull();
    c.cap_hit_by_year = c.cap_hit_by_year.map((x) => x * 1.1);
    expect(scheduleOf(c)).toBeNull();
  });
});

const cfg = { ...DEFAULT_CONFIG, humanGmCount: 0, playerPool: "legacy" as const };
function league(): LeagueState {
  const s = createLeague(21, cfg);
  fillRosterGaps(s);
  return s;
}
const roster = (s: LeagueState, team: string): Player[] => Object.values(s.players).filter((p) => p.nfl_team === team && !p.retired && p.contract);

describe("release (dead money)", () => {
  it("a deal with no schedule is priced exactly as before", () => {
    const p = { contract: { team_id: "KC", years_remaining: 3, total_value: 30, guaranteed: 0, cap_hit_by_year: [10, 10, 10], signing_bonus: 0 } } as unknown as Player;
    expect(releasePenalty(p)).toBe(Math.round(Math.min(10 * 0.22 * 3, 10 * 0.75) * 10) / 10);
  });

  it("a backloaded year one is not a cheap exit: it costs at least what the same average salary costs flat", () => {
    const mk = (structure: "even" | "backloaded" | "frontloaded") =>
      ({ contract: { ...offerToContract({ teamCode: "KC", baseSalary: 20, years: 4, signingBonus: 0, guaranteed: 0, structure }) } }) as unknown as Player;
    const even = releasePenalty(mk("even"));
    const back = releasePenalty(mk("backloaded"));
    const front = releasePenalty(mk("frontloaded"));
    expect(back).toBeGreaterThanOrEqual(even - 0.11);
    expect(front).toBeGreaterThanOrEqual(even - 0.11);
    // and the cut still frees something in year one only for the structure that charges the most up front
    const backHit = mk("backloaded").contract!.cap_hit_by_year[0]!;
    expect(back).toBeGreaterThan(backHit * 0.5);
  });

  it("after a shortening extension the release liability is the persisted bonus, not proration x years (review finding)", () => {
    const s = league();
    s.teams["KC"]!.cap.total = 10_000;
    const p = roster(s, "KC")[0]!;
    p.contract = { ...offerToContract({ teamCode: "KC", baseSalary: 20, years: 5, signingBonus: 0, guaranteed: 0, structure: "backloaded" }) };
    expect(extendContract(s, p, { baseSalary: 20, years: 1, guaranteed: 500, structure: "even" }).ok).toBe(true);
    const bonusLeft = p.contract!.guaranteed_by_year!.reduce((a, b) => a + b, 0);
    const owed = p.contract!.cap_hit_by_year.reduce((a, b) => a + b, 0);
    const mean = owed / p.contract!.years_remaining;
    const penalty = releasePenalty(p);
    expect(penalty).toBeLessThanOrEqual(Math.max(bonusLeft, Math.min(mean * 0.22 * p.contract!.years_remaining, mean * 0.75)) + 0.11);
    expect(penalty).toBeLessThanOrEqual(owed + 0.11);
  });

  it("the unamortized bonus accelerates: cutting after a bonus-heavy signing costs the remaining proration", () => {
    const c = offerToContract({ teamCode: "KC", baseSalary: 20, years: 5, signingBonus: 60, guaranteed: 60, structure: "even" });
    const p = { contract: { ...c } } as unknown as Player;
    // 60 of bonus over five years is 12 a year; all of it falls due on release
    expect(releasePenalty(p)).toBe(60);
  });

  it("bonus acceleration shrinks as the years pass (the schedule steps forward with expireContracts)", () => {
    const s = league();
    const p = roster(s, "KC")[0]!;
    p.contract = { ...offerToContract({ teamCode: "KC", baseSalary: 20, years: 4, signingBonus: 0, guaranteed: 0, structure: "backloaded" }) };
    const before = p.contract.guaranteed_by_year!.length;
    expireContracts(s);
    expect(p.contract!.cap_hit_by_year.length).toBe(before - 1);
    expect(p.contract!.guaranteed_by_year!.length).toBe(before - 1);
    expect(scheduleOf(p.contract)).not.toBeNull();
    expect(p.contract!.years_remaining).toBe(3);
  });
});

describe("restructure and extension keep the books straight", () => {
  it("restructuring a structured deal keeps the split valid and moves cap, not money", () => {
    const s = league();
    const p = roster(s, "KC")[0]!;
    p.contract = { ...offerToContract({ teamCode: "KC", baseSalary: 20, years: 4, signingBonus: 0, guaranteed: 0, structure: "even" }) };
    const total = sum(p.contract.cap_hit_by_year);
    expect(previewRestructure(p, s.season, 1).ok).toBe(true);
    expect(restructureContract(p, s.season, 1).ok).toBe(true);
    expect(scheduleOf(p.contract)).not.toBeNull();
    expect(Math.abs(sum(p.contract.cap_hit_by_year) - total)).toBeLessThan(0.3);
    expect(p.contract.cap_hit_by_year[0]!).toBeLessThan(20);
  });

  it("an extension carries the unamortized bonus of the years it replaces", () => {
    const s = league();
    const team = "KC";
    const p = roster(s, team).sort((a, b) => b.overall - a.overall)[0]!;
    s.teams[team]!.cap.total = 10_000; // room is not what this tests
    p.contract = { ...offerToContract({ teamCode: team, baseSalary: 8, years: 3, signingBonus: 12, guaranteed: 12, structure: "even" }) };
    const before = p.contract.guaranteed_by_year!.reduce((a, b) => a + b, 0);
    const ask = 30; // far above his ask, so he accepts
    const r = extendContract(s, p, { baseSalary: ask, years: 2, guaranteed: 200, structure: "frontloaded" });
    expect(r.ok, r.reason).toBe(true);
    expect(scheduleOf(p.contract)).not.toBeNull();
    expect(p.contract!.years_remaining).toBe(3);
    // the year-one proration stands; the other two years' share is rolled into the new years, not erased
    const after = p.contract!.guaranteed_by_year!.reduce((a, b) => a + b, 0);
    expect(after).toBeGreaterThanOrEqual(before - 0.3);
    const hits = p.contract!.cap_hit_by_year;
    expect(hits[1]!).toBeGreaterThan(hits[2]!); // frontloaded extension years
  });

  it("counts restructured bonus money once when extending a deal (review finding)", () => {
    const s = league();
    const team = "KC";
    const p = roster(s, team).sort((a, b) => b.overall - a.overall)[0]!;
    s.teams[team]!.cap.total = 10_000;
    p.contract = { ...offerToContract({ teamCode: team, baseSalary: 20, years: 4, signingBonus: 0, guaranteed: 0, structure: "even" }) };
    expect(restructureContract(p, s.season, 1).ok).toBe(true);
    const owedBonus = p.contract.guaranteed_by_year!.slice(1).reduce((a, b) => a + b, 0);
    const r = extendContract(s, p, { baseSalary: 20, years: 3, guaranteed: 500, structure: "even" });
    expect(r.ok, r.reason).toBe(true);
    const ext = p.contract!.cap_hit_by_year.slice(1);
    // each new year is the 20 salary plus the old bonus spread over the three new years, and nothing more
    const expected = 20 + owedBonus / 3;
    for (const h of ext) expect(Math.abs(h - expected)).toBeLessThan(0.3);
    // the bonus still owed equals what was owed (plus the extension's own), not double
    const after = p.contract!.guaranteed_by_year!.slice(1).reduce((a, b) => a + b, 0);
    expect(after).toBeLessThan(owedBonus + 20 * 3 * 0.15 + 0.5);
    expect(scheduleOf(p.contract)).not.toBeNull();
  });

  it("refuses an extension whose later years do not fit under the cap", () => {
    const s = league();
    const team = "KC";
    const p = roster(s, team).sort((a, b) => b.overall - a.overall)[0]!;
    s.teams[team]!.cap.total = 1; // nothing fits anywhere
    p.contract!.years_remaining = 1;
    const r = extendContract(s, p, { baseSalary: 30, years: 3, guaranteed: 200, structure: "backloaded" });
    expect(r.ok).toBe(false);
  });
});

describe("free agency", () => {
  function market(): LeagueState {
    const s = createLeague(33, { ...cfg });
    fillRosterGaps(s);
    s.stage = "freeAgency";
    for (const g of s.gms) g.isHuman = false;
    for (const t of Object.values(s.teams)) t.controlledBy = { kind: "ai" };
    for (const p of Object.values(s.players)) {
      if (!p.retired && !p.free_agent && p.contract && p.contract.years_remaining <= 0) {
        p.free_agent = true;
        p.nfl_team = "FA";
        p.contract = null as never;
      }
    }
    return s;
  }

  it("an offer with a structure signs a deal with that structure; an unknown or one-year structure is ignored", () => {
    const s = market();
    beginFreeAgencyEvent(s);
    const team = onTheClock(s)!;
    const fa = Object.values(s.players).filter((p) => p.free_agent && !p.retired).sort((a, b) => b.overall - a.overall);
    const [a, b, c] = fa;
    s.teams[team]!.cap.total += 500;
    applyOffer(s, team, a!.id, 5, 4, "backloaded");
    expect(s.freeAgencyEvent!.offers[a!.id]![0]!.structure).toBe("backloaded");
    // fresh state for the other two cases
    const t2 = market();
    beginFreeAgencyEvent(t2);
    const tm = onTheClock(t2)!;
    applyOffer(t2, tm, b!.id, 5, 1, "backloaded");
    expect(t2.freeAgencyEvent!.offers[b!.id]![0]!.structure).toBeUndefined();
    const t3 = market();
    beginFreeAgencyEvent(t3);
    applyOffer(t3, onTheClock(t3)!, c!.id, 5, 3, "sideways" as never);
    expect(t3.freeAgencyEvent!.offers[c!.id]![0]!.structure).toBeUndefined();
  });

  it("CPU free agency produces structured deals that fit the cap in every year, deterministically", () => {
    const run = () => {
      const s = market();
      // young stars (backloaded) and veterans (frontloaded), so the run has shaped deals to check
      for (const p of Object.values(s.players)) if (p.free_agent && !p.retired && p.overall >= 60) p.age = p.overall >= 72 ? 26 : 33;
      beginFreeAgencyEvent(s);
      runCpuTurns(s, new Set());
      return s;
    };
    const a = run();
    const b = run();
    const deals = Object.values(a.players).filter((p) => p.contract?.structure && !p.free_agent);
    expect(deals.length).toBeGreaterThan(3);
    expect(deals.every((p) => p.contract!.structure !== 'even')).toBe(true); // flat deals carry no schedule
    const kinds = new Set(deals.map((p) => p.contract!.structure));
    for (const p of deals) {
      expect(scheduleOf(p.contract), p.name).not.toBeNull();
      expect(p.contract!.years_remaining).toBe(p.contract!.cap_hit_by_year.length);
    }
    const fingerprint = (s: LeagueState) => Object.values(s.players).filter((p) => p.contract?.structure).map((p) => `${p.id}:${p.contract!.structure}:${p.contract!.cap_hit_by_year.join(",")}`).sort();
    expect(fingerprint(a)).toEqual(fingerprint(b));
    console.log("CPU structures chosen:", Object.fromEntries([...kinds].map((k) => [k, deals.filter((p) => p.contract!.structure === k).length])));
  }, 120_000);

  it("a young player on a club tight now and clear later gets a backloaded deal; a crowded next year gets frontloaded", () => {
    const s = market();
    beginFreeAgencyEvent(s);
    const team = Object.keys(s.teams)[0]!;
    const kid = Object.values(s.players).find((p) => p.free_agent && !p.retired)!;
    kid.age = 25;
    for (const p of Object.values(s.players)) if (p.nfl_team === team && p.contract) p.contract.years_remaining = 1;
    s.teams[team]!.cap.total = 200;
    s.teams[team]!.cap.used = 198; // 2M of room against a 10M player: tight now, nothing owed later
    expect(chooseStructure(s, team, kid, 10, 4)).toBe("backloaded");
    // the same club with a comfortable year but a crowded next one: pay now
    s.teams[team]!.cap.used = 100;
    const mate = Object.values(s.players).find((p) => p.nfl_team === team && p.contract)!;
    mate.contract!.years_remaining = 3;
    mate.contract!.cap_hit_by_year = [5, 180, 5];
    expect(chooseStructure(s, team, kid, 10, 3)).toBe("frontloaded");
  });

  it("a veteran gets a frontloaded deal, and a shape that would overrun a later season is never chosen", () => {
    const s = market();
    beginFreeAgencyEvent(s);
    const team = Object.keys(s.teams)[0]!;
    const vet = Object.values(s.players).find((p) => p.free_agent && !p.retired)!;
    vet.age = 33;
    s.teams[team]!.cap.total = 10_000;
    expect(chooseStructure(s, team, vet, 6, 3)).toBe("frontloaded");
    // the same deal on a club with no room anywhere falls back to the flat shape
    s.teams[team]!.cap.total = 1;
    expect(chooseStructure(s, team, vet, 6, 3)).toBeUndefined(); // flat
    expect(chooseStructure(s, team, vet, 6, 1)).toBeUndefined();
  });
});

describe("legacy saves", () => {
  it("a league with no structure fields loads, rolls a year and prices a release exactly as it always did", () => {
    const s = league();
    const flat = roster(s, "KC").filter((p) => p.contract!.years_remaining >= 2);
    expect(flat.length).toBeGreaterThan(5);
    for (const p of flat) expect(p.contract!.structure).toBeUndefined();
    const penalties = flat.map((p) => releasePenalty(p));
    const round = JSON.parse(JSON.stringify(s)) as LeagueState; // the save round trip
    upgradeLeagueState(round);
    expect(flat.map((p) => releasePenalty(round.players[p.id]!))).toEqual(penalties);
    expireContracts(round);
    for (const p of flat) {
      const q = round.players[p.id]!;
      expect(q.contract!.cap_hit_by_year.length).toBe(Math.max(1, p.contract!.cap_hit_by_year.length - 1));
      expect(q.contract!.salary_by_year).toBeUndefined();
    }
  });

  it("a minimum salary is never touched by the structure code", () => {
    expect(minSalaryM(league())).toBeGreaterThan(0);
  });
});
