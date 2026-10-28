import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { agingDelta, expectedAgingDelta, MockSimulationService, retirementChance } from "@/sim/MockSimulationService";
import { Rng } from "@/sim/rng";
import { CAP_GROWTH_MEAN, marketScale } from "./capEconomy.ts";
import {
  CAP_PLANNING_GROWTH,
  EXTENSION_ACCEPT,
  type TermContext,
  type TermSubject,
  chooseTerm,
  commitmentsOf,
  discountRateFor,
  extensionSalaryAt,
  extensionTerms,
  offerYears,
  planTerm,
  projectRatings,
  survivalByYear,
} from "./contractValue.ts";
import { extendContract, extensionAsk } from "./contracts.ts";
import { expectedSalary } from "./freeAgencyValues.ts";
import { beginFreeAgencyEvent, runCpuTurns } from "./freeAgencyEvent.ts";
import { planCoreResign, resignAiCore } from "./rules.ts";
import { DEFAULT_CONFIG, createLeague, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";

/**
 * B2b: the multiyear contract evaluator (`contractValue.ts`) and where the CPU uses it.
 *
 * Pure behaviour first, each with the negative control that would catch the opposite mistake, then the same
 * evaluator in a real league's free-agent market and re-signing.
 */

const subject = (position: Player["position"], overall: number, age: number, decline: number, extra: Partial<TermSubject> = {}): TermSubject => ({
  position,
  overall,
  age,
  dev_age_threshold: 25,
  decline_age_threshold: decline,
  injury_history: [],
  ...extra,
});
const ctxOf = (o: Partial<TermContext> = {}): TermContext => ({
  scale: 1,
  capM: 255,
  committed: [150, 130, 100, 80, 50, 30],
  growthYears: 0,
  discountRate: discountRateFor(1),
  ...o,
});
const askFor = (s: TermSubject): number => expectedSalary({ overall: s.overall, position: s.position, age: s.age } as Player, 1);
const yearsFor = (s: TermSubject, usual = 4, ctx = ctxOf()): number => chooseTerm(s, ctx, () => askFor(s), usual).years;

describe("the aging projection is the game's own aging", () => {
  it.each([
    [22, 25, 31, 12], // developing, with a ceiling
    [23, 25, 31, undefined], // developing, no ceiling
    [28, 25, 31, undefined], // prime
    [31, 25, 31, undefined], // first year of decline
    [34, 25, 31, undefined], // well into it
    [37, 25, 36, undefined], // a quarterback's late decline
  ])("matches the mean of agingDelta at age %i (dev %i, decline %i, room %s)", (age, dev, decline, room) => {
    const rng = new Rng(age * 977 + decline);
    let sum = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) sum += agingDelta(rng, age, dev, decline, room);
    expect(expectedAgingDelta(age, dev, decline, room)).toBeCloseTo(sum / n, 1);
  });

  it("uses each player's own decline age: the same age and rating decline for one and not for another", () => {
    const early = projectRatings(subject("QB", 88, 33, 31), 4);
    const late = projectRatings(subject("QB", 88, 33, 38), 4);
    expect(early[3]!).toBeLessThan(late[3]! - 4);
    // negative control: a position table that put every QB's decline at one age would read these two players alike
    expect(early).not.toEqual(late);
  });

  it("retires with the review's own chance, which the review itself uses", () => {
    const p = { ...subject("WR", 80, 35, 31), id: "x" } as Player & TermSubject;
    const { chance, eligible } = retirementChance(p);
    expect(eligible).toBe(true);
    const sim = new MockSimulationService();
    let retired = 0;
    const n = 3000;
    for (let seed = 0; seed < n; seed++) retired += sim.retirementOutcomes(seed, [p]).filter((o) => o.decision === "retiring").length;
    expect(retired / n).toBeCloseTo(chance, 1);
  });
});

describe("retirement does not make a bad contract look good", () => {
  it("scales a year's surplus by the chance he is still playing, and nothing else", () => {
    const old = subject("WR", 85, 36, 31);
    const ratings = projectRatings(old, 3);
    const alive = survivalByYear(old, ratings);
    expect(alive[0]).toBe(1);
    expect(alive[1]!).toBeLessThan(1);
    expect(alive[2]!).toBeLessThan(alive[1]!);
    // the same player given a clean bill, no review at all: only the weighting differs
    const sure = planTerm({ ...old, position: "K" }, ctxOf(), 3, 8);
    const risky = planTerm({ ...old, position: "WR" }, ctxOf(), 3, 8);
    expect(sure.net.length).toBe(risky.net.length);
  });

  it("does not hold the cap-flexibility penalty to the retirement odds: room is read as if everyone owed were still there", () => {
    const old = subject("WR", 80, 37, 31);
    const tight = ctxOf({ committed: [250, 250, 250] });
    const loose = ctxOf({ committed: [100, 100, 100] });
    const a = planTerm(old, tight, 3, 9);
    const b = planTerm(old, loose, 3, 9);
    // tighter books cost more in the later years, however likely he is to be gone by then
    expect(a.net[2]!).toBeLessThan(b.net[2]!);
  });

  it("never makes a veteran with a long, losing tail worth more years because he might retire", () => {
    const old = subject("WR", 82, 36, 31);
    expect(yearsFor(old)).toBe(1);
  });
});

describe("contract length follows decline, quality and the cap", () => {
  it("gives a player in his prime the long deal and a player past his decline age one year", () => {
    expect(yearsFor(subject("WR", 85, 26, 31))).toBeGreaterThanOrEqual(4);
    expect(yearsFor(subject("WR", 85, 33, 31))).toBe(1);
    expect(yearsFor(subject("CB", 78, 32, 30))).toBe(1);
  });

  it("is not an age cutoff: a veteran whose own decline is years off still gets years, and a contender gets its one-year veteran", () => {
    expect(yearsFor(subject("QB", 90, 31, 36))).toBeGreaterThanOrEqual(3);
    expect(yearsFor(subject("QB", 90, 36, 38))).toBeGreaterThanOrEqual(1);
    // a young player past his own (early) decline is short; an older one before his own is not
    expect(yearsFor(subject("RB", 80, 29, 28))).toBe(1);
    expect(yearsFor(subject("OT", 74, 31, 36))).toBeGreaterThanOrEqual(2);
  });

  it("counts the cap's yearly rise: the same player on the same salary gets years when the cap grows and one when it does not", () => {
    const prime = subject("WR", 85, 26, 31);
    expect(chooseTerm(prime, ctxOf({ growth: CAP_GROWTH_MEAN }), () => askFor(prime), 4).years).toBeGreaterThanOrEqual(4);
    // negative control: no growth, a flat salary and a flat rating earn nothing in the later years
    expect(chooseTerm(prime, ctxOf({ growth: 0 }), () => askFor(prime), 4).years).toBe(1);
  });

  it("adds a year only if that year pays for itself, not because the total is larger", () => {
    const prime = subject("WR", 85, 26, 31);
    // the books are nearly spent in the third season only: that year costs more than it earns, the fourth and fifth do not
    const ctx = ctxOf({ committed: [100, 100, 252, 100, 100] });
    const choice = chooseTerm(prime, ctx, () => askFor(prime), 5);
    const five = planTerm(prime, ctx, 5, askFor(prime));
    const two = planTerm(prime, ctx, 2, askFor(prime));
    expect(five.cumulative[4]!, "a five-year deal still has the larger total").toBeGreaterThan(two.cumulative[1]!);
    expect(choice.years, "but the year that does not pay ends the term").toBe(2);
  });

  it("never plans a year past the projected cap", () => {
    const prime = subject("WR", 85, 26, 31);
    expect(yearsFor(prime, 5, ctxOf({ committed: [100, 100, 258, 100, 100] }))).toBeLessThanOrEqual(2);
    // the cap rises, so the same books fit later: 258 against a 255 cap now is under the cap by the third season
    expect(planTerm(prime, ctxOf({ committed: [100, 100, 250] }), 3, askFor(prime)).fits).toBe(3);
  });

  it("plans room on a slow year of cap growth, not the average one", () => {
    const prime = subject("WR", 85, 26, 31);
    const salary = askFor(prime);
    // books that fit under the cap at its 7.5% mean growth in the third season, but not at the 5.5% a slow year gives
    const owed = 255 * (1 + CAP_GROWTH_MEAN) ** 2 - salary - 1;
    expect(255 * (1 + CAP_PLANNING_GROWTH) ** 2).toBeLessThan(owed + salary);
    expect(planTerm(prime, ctxOf({ committed: [100, 100, owed] }), 3, salary).fits).toBe(2);
    // negative control: planned on the mean, the same books look as if they fit
    expect(planTerm(prime, ctxOf({ committed: [100, 100, owed], capGrowth: CAP_GROWTH_MEAN }), 3, salary).fits).toBe(3);
  });

  it("walks away from an overpay: a bidding war's price is not locked in for years", () => {
    const prime = subject("WR", 85, 26, 31);
    const ask = askFor(prime);
    expect(chooseTerm(prime, ctxOf(), () => ask * 1.4, 4).years).toBe(1);
    expect(chooseTerm(prime, ctxOf(), () => ask, 4).years).toBeGreaterThanOrEqual(4);
  });

  it("lets a rebuild weigh the later years more than a contender does, and a contender the early ones", () => {
    const prime = subject("WR", 85, 26, 31);
    const rebuild = planTerm(prime, ctxOf({ discountRate: discountRateFor(2) }), 5, askFor(prime)).cumulative[4]!;
    const contender = planTerm(prime, ctxOf({ discountRate: discountRateFor(0) }), 5, askFor(prime)).cumulative[4]!;
    expect(rebuild).toBeGreaterThan(contender);
    expect(discountRateFor(null)).toBe(discountRateFor(1));
  });

  it("scales with the GM's planning: an easier GM keeps its own usual length, an expert takes the evaluator's", () => {
    const old = subject("WR", 85, 33, 31);
    const ask = askFor(old);
    expect(offerYears(old, ctxOf(), ask, 4, 0)).toBe(4);
    expect(offerYears(old, ctxOf(), ask, 4, 1)).toBe(1);
    const half = offerYears(old, ctxOf(), ask, 4, 0.45);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(4);
  });

  it("never stretches a deal for a signing that only fills a roster spot", () => {
    const young = subject("EDGE", 70, 24, 31);
    const open = offerYears(young, ctxOf(), askFor(young), 3, 1);
    const fill = offerYears(young, ctxOf(), askFor(young), 3, 1, 3);
    expect(open).toBeGreaterThanOrEqual(3);
    expect(fill).toBeLessThanOrEqual(3);
    // but it still shortens: a veteran past his decline gets one year either way
    const old = subject("WR", 85, 33, 31);
    expect(offerYears(old, ctxOf(), askFor(old), 4, 1, 4)).toBe(1);
  });

  it("can add a year the club would not have offered, but only when it clearly pays", () => {
    const young = subject("EDGE", 70, 24, 31);
    const longer = chooseTerm(young, ctxOf(), () => askFor(young), 3);
    expect(longer.years).toBeLessThanOrEqual(4);
    expect(longer.years).toBeGreaterThanOrEqual(3);
  });
});

describe("an extension is priced by the same evaluator, on terms the player takes", () => {
  it("asks for no more years than he did, and pays what the acceptance rule needs for fewer", () => {
    expect(extensionSalaryAt(10, 4, 4)).toBe(10);
    expect(extensionSalaryAt(10, 4, 2)).toBeGreaterThanOrEqual((EXTENSION_ACCEPT * 10 * 4) / 2);
    for (const years of [1, 2, 3]) expect(extensionSalaryAt(8.3, 3, years) * years).toBeGreaterThanOrEqual(EXTENSION_ACCEPT * 8.3 * 3 - 1e-9);
  });

  it("declines to extend a player the market would not pay for what he will be, and extends one it would", () => {
    const decliner = subject("WR", 84, 34, 31);
    const prime = subject("WR", 84, 27, 31);
    const ask = (s: TermSubject) => ({ baseSalary: askFor(s), years: 3 });
    expect(extensionTerms(decliner, ctxOf({ growthYears: 1 }), ask(decliner))).toBeNull();
    const got = extensionTerms(prime, ctxOf({ growthYears: 1 }), ask(prime));
    expect(got).not.toBeNull();
    expect(got!.years).toBeLessThanOrEqual(3);
  });

  it("agrees with the free-agent market on the same player: the same decliner gets one year there and none here", () => {
    const decliner = subject("WR", 84, 34, 31);
    expect(yearsFor(decliner)).toBe(1);
    expect(extensionTerms(decliner, ctxOf({ growthYears: 1 }), { baseSalary: askFor(decliner), years: 3 })).toBeNull();
    const prime = subject("WR", 84, 27, 31);
    expect(yearsFor(prime)).toBeGreaterThanOrEqual(4);
    expect(extensionTerms(prime, ctxOf({ growthYears: 1 }), { baseSalary: askFor(prime), years: 3 })!.years).toBe(3);
  });
});

describe("commitments", () => {
  it("add up the years each team has left, skipping the retired and the unsigned", () => {
    const mk = (id: string, team: string, hits: number[], extra: Partial<Player> = {}): Player =>
      ({ id, nfl_team: team, free_agent: false, retired: false, contract: { years_remaining: hits.length, cap_hit_by_year: hits }, ...extra }) as unknown as Player;
    const out = commitmentsOf([mk("a", "KC", [5, 4, 3]), mk("b", "KC", [2, 2]), mk("c", "KC", [9, 9], { retired: true }), mk("d", "FA", [1], { free_agent: true })]);
    expect(out.get("KC")!.slice(0, 4)).toEqual([7, 6, 3, 0]);
    expect(out.has("FA")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// In a league
// ---------------------------------------------------------------------------------------------------------------------

const built = new Map<number, LeagueState>();
function aiLeague(seed: number): LeagueState {
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

function openMarket(seed: number): LeagueState {
  const s = aiLeague(seed);
  s.stage = "freeAgency";
  // a market of a quarter of the league's players, drawn from every age, rating and position
  let k = 0;
  for (const p of Object.values(s.players)) {
    if (!p.retired && !p.free_agent && p.contract && k++ % 4 === 0) {
      p.free_agent = true;
      p.nfl_team = "FA";
      p.contract = null as never;
    }
  }
  recomputeTeamRatings(s);
  Object.assign(s, { freeAgencyEvent: null });
  beginFreeAgencyEvent(s);
  return s;
}

/** Every deal a year from its end, as at the close of a season in which they were all signed for one more. */
function expiring(seed: number): LeagueState {
  const s = aiLeague(seed);
  for (const p of Object.values(s.players)) {
    if (p.retired || p.free_agent || !p.contract) continue;
    p.contract.years_remaining = 1;
    p.contract.cap_hit_by_year = [p.contract.cap_hit_by_year[0] ?? 1];
  }
  return s;
}

function playMarket(s: LeagueState): { id: string; years: number; salary: number; age: number; decline: number; team: string }[] {
  runCpuTurns(s, new Set());
  return s.freeAgencyEvent!.signed.map((x) => {
    const p = s.players[x.playerId]!;
    return { id: x.playerId, years: x.years, salary: x.salary, age: p.age, decline: p.decline_age_threshold, team: x.teamCode };
  });
}

describe("the CPU free-agent market with the evaluator", () => {
  it("is deterministic, and the same after a save is written and read back (as the online server does)", () => {
    const a = playMarket(openMarket(4101));
    const b = playMarket(JSON.parse(JSON.stringify(openMarket(4101))) as LeagueState);
    expect(a.length).toBeGreaterThan(30);
    expect(b).toEqual(a);
  }, 300_000);

  it("gives players past their decline age short deals and players well short of it longer ones, with veterans still signing", () => {
    const signed = playMarket(openMarket(4102));
    const past = signed.filter((x) => x.age >= x.decline);
    const prime = signed.filter((x) => x.age <= x.decline - 3);
    expect(past.length, "veterans are still signed").toBeGreaterThan(0);
    const mean = (xs: { years: number }[]) => xs.reduce((n, x) => n + x.years, 0) / Math.max(1, xs.length);
    expect(mean(prime)).toBeGreaterThan(mean(past) + 0.5);
    expect(Math.max(0, ...past.map((x) => x.years))).toBeLessThanOrEqual(2);
  }, 300_000);
});

describe("a save from before the evaluator's inputs were recorded", () => {
  it("still gets a market: no cap growth, no window recorded, and the same signings every time", () => {
    const strip = (s: LeagueState): LeagueState => {
      const old = JSON.parse(JSON.stringify(s)) as LeagueState;
      delete (old as Partial<LeagueState>).capScale;
      delete (old as Partial<LeagueState>).capGrowthSeason;
      delete (old.freeAgencyEvent as { timeline?: unknown }).timeline;
      return old;
    };
    const a = playMarket(strip(openMarket(4107)));
    const b = playMarket(strip(openMarket(4107)));
    expect(a.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
    for (const x of a) {
      expect(x.years).toBeGreaterThanOrEqual(1);
      expect(x.years).toBeLessThanOrEqual(5);
    }
  }, 300_000);
});

describe("CPU re-signing with the evaluator", () => {
  it("offers terms the player takes, so a person's staff proposing the same list is accepted", () => {
    const s = expiring(4103);
    let planned = 0;
    for (const code of Object.keys(s.teams)) {
      for (const { player, ask } of planCoreResign(s, code)) {
        planned++;
        const wanted = extensionAsk(player, marketScale(s));
        expect(ask.years, `${player.name} is offered no more years than he asked`).toBeLessThanOrEqual(wanted.years);
        const r = extendContract(structuredClone(s), structuredClone(s.players[player.id]!), ask);
        expect(r.ok, `${player.name}: ${r.reason}`).toBe(true);
      }
    }
    expect(planned).toBeGreaterThan(5);
  }, 300_000);

  it("re-signs fewer long deals for players already past their decline age than for the same players in their prime", () => {
    const s = expiring(4104);
    const teams = Object.keys(s.teams);
    const before = teams.flatMap((c) => planCoreResign(s, c)).map((x) => x.player.id);
    expect(before.length).toBeGreaterThan(5);
    for (const id of before) {
      const p = s.players[id]!;
      p.age = p.decline_age_threshold + 3;
      p.overall = Math.min(p.overall, 84);
    }
    const old = teams.flatMap((c) => planCoreResign(s, c)).filter((x) => before.includes(x.player.id));
    // negative control: the same players seven years younger are kept as they were
    for (const id of before) s.players[id]!.age -= 7;
    const young = teams.flatMap((c) => planCoreResign(s, c)).filter((x) => before.includes(x.player.id));
    expect(young.length).toBeGreaterThan(old.length);
    const years = (xs: typeof old) => xs.reduce((n, x) => n + x.ask.years, 0);
    expect(years(young) / young.length).toBeGreaterThan(old.length ? years(old) / old.length : 0);
  }, 300_000);

  it("keeps the re-sign budget where it was: a club extends a player until $18M (at the starting cap) is left of next year's cap, no sooner", () => {
    // B2b does not move the cap buffer. A wider one was measured and bought no less dead money on identical league states, while
    // skipping about one extension in twelve.
    const s = expiring(4106);
    const code = Object.keys(s.teams)[0]!;
    const first = planCoreResign(s, code)[0];
    expect(first).toBeDefined();
    const scale = marketScale(s);
    const price = first!.ask.baseSalary;
    // a franchise player (88+) keeps a smaller buffer of his own: 6, against 18
    const buffer = first!.player.overall >= 88 ? 6 : 18;
    s.teams[code]!.cap.total = price + (buffer + (buffer === 6 ? 1.5 : 4)) * scale; // just inside the buffer, and well inside a 50% wider one
    expect(planCoreResign(s, code).map((x) => x.player.id)).toContain(first!.player.id);
    s.teams[code]!.cap.total = price + (buffer - 2) * scale; // short of it
    expect(planCoreResign(s, code).map((x) => x.player.id)).not.toContain(first!.player.id);
  }, 300_000);

  it("resignAiCore applies exactly the plan and is deterministic", () => {
    const a = expiring(4105);
    const b = expiring(4105);
    expect(resignAiCore(a)).toBe(resignAiCore(b));
    const terms = (s: LeagueState) => Object.values(s.players).filter((p) => p.contract).map((p) => [p.id, p.contract!.years_remaining, p.contract!.cap_hit_by_year.join(",")]);
    expect(terms(a)).toEqual(terms(b));
  }, 300_000);
});
