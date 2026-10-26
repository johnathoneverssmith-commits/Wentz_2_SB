import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { applyRelease, releasePenalty } from "./reconciliation.ts";
import { advanceBiddingDayOn, affordableTeams, aiControlledTeams, aiOfferForPlayer, beginBidding, contractTermsFor } from "./rules.ts";
import { beginFreeAgencyEvent, chooseFaMove, offerRoomFor } from "./freeAgencyEvent.ts";
import { deterministicNoiseUnit } from "./aiDifficulty.ts";
import {
  DEFAULT_CONFIG,
  capUsedOf,
  clearRoomFor,
  createLeague,
  fillRosterGaps,
  openCapRoomForFreeAgency,
  planRoomFor,
  recomputeTeamRatings,
  cpuCapShortfalls,
  releaseWithDeadMoney,
  resetCpuCapShortfalls,
  trimRosters,
} from "./seed.ts";

/**
 * CPU cap fairness and contract realism: a CPU team's release is charged the way a GM's is, a release that
 * does not really open the room is not made, nobody is handed a contract they have no room for, and the
 * terms a CPU team offers follow who the player is.
 */

const built = new Map<number, LeagueState>();
function freshLeague(seed: number): LeagueState {
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

const rosterOf = (s: LeagueState, code: string): Player[] =>
  Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent);
const hitOf = (p: Player): number => p.contract?.cap_hit_by_year[0] ?? 0;
const room = (s: LeagueState, code: string): number => s.teams[code]!.cap.total - capUsedOf(s, code);
const firstTeam = (s: LeagueState): string => Object.keys(s.teams)[0]!;

/** A team's players that are not its best at a position. */
function bench(s: LeagueState, code: string): Player[] {
  const roster = rosterOf(s, code);
  const best = new Set<string>();
  for (const pos of new Set(roster.map((p) => p.position))) {
    best.add(roster.filter((p) => p.position === pos).reduce((a, b) => (b.overall > a.overall ? b : a)).id);
  }
  return roster.filter((p) => !best.has(p.id));
}
/** The players a team could cut for room: not its best at a position, on real money, on a multi-year deal. */
const cuttable = (s: LeagueState, code: string): Player[] => bench(s, code).filter((p) => hitOf(p) > 1.5 && (p.contract?.years_remaining ?? 0) >= 2);

describe("a CPU release follows a GM's release", () => {
  it("charges the same dead money, and leaves the same cap, as a GM's release of the same player", () => {
    const a = freshLeague(41);
    const b = freshLeague(41);
    const code = firstTeam(a);
    const target = cuttable(a, code).sort((x, y) => hitOf(y) - hitOf(x))[0]!;
    expect(releasePenalty(target)).toBeGreaterThan(0);
    const expectedFreed = hitOf(target) - releasePenalty(target);
    applyRelease(a, code, target.id);
    recomputeTeamRatings(a);
    const freed = releaseWithDeadMoney(b, b.players[target.id]!);
    recomputeTeamRatings(b);
    expect(b.teams[code]!.cap.dead).toBe(a.teams[code]!.cap.dead);
    expect(b.teams[code]!.cap.used).toBe(a.teams[code]!.cap.used);
    expect(b.players[target.id]!.free_agent).toBe(true);
    // and what it reports opening is what the books really show
    expect(freed).toBeCloseTo(expectedFreed, 1);
  });

  it("keeps the release penalty where it always was: reconciliation still exports it, and it is the same function", () => {
    const s = freshLeague(41);
    const p = cuttable(s, firstTeam(s))[0]!;
    expect(releasePenalty(p)).toBe(Math.round(Math.min(hitOf(p) * 0.22 * p.contract!.years_remaining, hitOf(p) * 0.75) * 10) / 10);
  });
});

describe("clearing room for a signing", () => {
  it("opens the room it was asked for after the penalties, and leaves the dead money on the books", () => {
    const s = freshLeague(42);
    const code = firstTeam(s);
    const needed = room(s, code) + 12;
    const penalties = new Map(rosterOf(s, code).map((p) => [p.id, releasePenalty(p)]));
    const deadBefore = s.teams[code]!.cap.dead;
    expect(clearRoomFor(s, code, needed)).toBe(true);
    expect(room(s, code)).toBeGreaterThanOrEqual(needed);
    const cut = [...penalties.keys()].filter((id) => s.players[id]!.free_agent);
    expect(cut.length).toBeGreaterThan(0);
    expect(s.teams[code]!.cap.dead).toBeCloseTo(deadBefore + cut.reduce((n, id) => n + penalties.get(id)!, 0), 0);
    // the books agree with themselves
    const reported = s.teams[code]!.cap.used;
    recomputeTeamRatings(s);
    expect(s.teams[code]!.cap.used).toBe(reported);
  });

  it("releases nobody for a signing that cannot happen", () => {
    const s = freshLeague(42);
    const code = firstTeam(s);
    // plenty it could cut, none of it enough: the first cuts would free something and the last could not reach the ask
    for (const p of bench(s, code).slice(0, 12)) {
      p.contract!.cap_hit_by_year = [5];
      p.contract!.years_remaining = 1;
    }
    expect(rosterOf(s, code).filter((p) => hitOf(p) === 5).length).toBeGreaterThanOrEqual(11);
    const before = rosterOf(s, code).map((p) => p.id).sort();
    const deadBefore = s.teams[code]!.cap.dead;
    expect(clearRoomFor(s, code, room(s, code) + 1_000)).toBe(false);
    expect(rosterOf(s, code).map((p) => p.id).sort()).toEqual(before);
    expect(s.teams[code]!.cap.dead).toBe(deadBefore);
  });

  it("never cuts a player the window just signed, as a GM cannot", () => {
    const s = freshLeague(42);
    const code = firstTeam(s);
    const needed = room(s, code) + 12;
    const plan = planRoomFor(s, code, needed)!;
    expect(plan.length).toBeGreaterThan(0);
    const locked = new Set(plan.map((p) => p.id));
    const again = planRoomFor(s, code, needed, locked);
    for (const p of again ?? []) expect(locked.has(p.id)).toBe(false);
  });

  it("never makes a cut that frees nothing: a deal that costs as much to leave as to keep is not room", () => {
    const s = freshLeague(42);
    const code = firstTeam(s);
    // the dearest cuttable man carries so much unamortised bonus that releasing him costs more than his hit
    const trap = cuttable(s, code).sort((x, y) => hitOf(y) - hitOf(x))[0]!;
    trap.contract!.prorated_per_year = hitOf(trap);
    trap.contract!.years_remaining = 4;
    expect(releasePenalty(trap)).toBeGreaterThan(hitOf(trap));
    const plan = planRoomFor(s, code, room(s, code) + 12) ?? [];
    expect(plan.map((p) => p.id)).not.toContain(trap.id);
  });
});

describe("cut day", () => {
  it("charges the penalty on every cut, and never touches a person's team", () => {
    const s = freshLeague(43);
    const human = Object.keys(s.teams)[1]!;
    s.teams[human]!.controlledBy = { kind: "human", gmId: "x" } as never;
    s.gms.push({ id: "x", teamCode: human, isHuman: true } as never);
    const before = new Map(Object.values(s.players).filter((p) => !p.retired && !p.free_agent).map((p) => [p.id, { team: p.nfl_team, penalty: releasePenalty(p), hit: hitOf(p) }]));
    const humanRoster = rosterOf(s, human).map((p) => p.id).sort();
    openCapRoomForFreeAgency(s);
    const cut = [...before].filter(([id]) => s.players[id]!.free_agent);
    expect(cut.length).toBeGreaterThan(0);
    for (const [, b] of cut) expect(b.hit - b.penalty).toBeGreaterThanOrEqual(3); // each really freed something worth the spot
    const charged = Object.values(s.teams).reduce((n, t) => n + t.cap.dead, 0);
    expect(charged).toBeCloseTo(cut.reduce((n, [, b]) => n + b.penalty, 0), 0);
    expect(rosterOf(s, human).map((p) => p.id).sort()).toEqual(humanRoster);
    expect(s.teams[human]!.cap.dead).toBe(0);
  });
});

describe("the reconciliation trim", () => {
  /** a team that has to shed cap: its limit is `over` $M under what it carries */
  function overTheCap(seed: number, over: number): { s: LeagueState; code: string } {
    const s = freshLeague(seed);
    const code = firstTeam(s);
    s.teams[code]!.cap.total = capUsedOf(s, code) - over;
    return { s, code };
  }

  it("charges a CPU team's cuts to its cap as dead money, and a person's team is left as it was", () => {
    const cpu = overTheCap(46, 8);
    const code = cpu.code;
    resetCpuCapShortfalls();
    const penalties = new Map(rosterOf(cpu.s, code).map((p) => [p.id, releasePenalty(p)]));
    trimRosters(cpu.s);
    const cut = [...penalties.keys()].filter((id) => cpu.s.players[id]!.free_agent);
    expect(cut.length).toBeGreaterThan(0);
    expect(cpuCapShortfalls).toBe(0);
    expect(cpu.s.teams[code]!.cap.dead).toBeCloseTo(cut.reduce((n, id) => n + penalties.get(id)!, 0), 0);
    expect(cpu.s.teams[code]!.cap.dead).toBeGreaterThan(0);

    const gm = overTheCap(46, 8);
    gm.s.teams[gm.code]!.controlledBy = { kind: "human", gmId: "g" } as never;
    gm.s.gms.push({ id: "g", teamCode: gm.code, isHuman: true } as never);
    trimRosters(gm.s);
    expect(gm.s.teams[gm.code]!.cap.dead).toBe(0);
  });

  it("counts the dead money a CPU team already carries: the same roster that fits under the cap alone has to shed once the books hold it", () => {
    const fits = freshLeague(48);
    const code = firstTeam(fits);
    fits.teams[code]!.cap.total = capUsedOf(fits, code) + 2;
    const before = rosterOf(fits, code).length;
    trimRosters(fits);
    expect(rosterOf(fits, code).length).toBe(before); // under the cap: nobody goes

    const burdened = freshLeague(48);
    burdened.teams[code]!.cap.total = capUsedOf(burdened, code) + 2;
    burdened.teams[code]!.cap.dead = 25; // last year's cuts still on the books
    trimRosters(burdened);
    expect(rosterOf(burdened, code).length).toBeLessThan(before);
  });

  it("does not cut a player whose release opens no room: the spot has to be refilled at the minimum, so it only trades him for dead money", () => {
    const { s, code } = overTheCap(46, 5);
    // every contract here is cheap to hold and dear to leave: $1.5M a year for four more, so a release saves $0.4M.
    // (Veterans: a young player on such a deal would go to the practice squad instead, which frees $1.3M and is its own test.)
    for (const p of rosterOf(s, code)) {
      p.years_pro = 6;
      p.contract!.cap_hit_by_year = [1.5, 1.5, 1.5, 1.5];
      p.contract!.years_remaining = 4;
      delete p.contract!.prorated_per_year;
    }
    s.teams[code]!.cap.total = capUsedOf(s, code) - 5;
    const before = rosterOf(s, code).map((p) => p.id).sort();
    resetCpuCapShortfalls();
    trimRosters(s);
    // nothing honest frees room, so nothing is released: not at a loss, and never for free
    expect(rosterOf(s, code).map((p) => p.id).sort()).toEqual(before);
    expect(s.teams[code]!.cap.dead).toBe(0);
    expect(cpuCapShortfalls).toBeGreaterThan(0);
  });

  it("never releases a CPU player for free: every release the trim makes is charged its penalty, at any overage", () => {
    for (const over of [10, 25, 45]) {
      const { s, code } = overTheCap(49, over);
      const penalties = new Map(rosterOf(s, code).map((p) => [p.id, releasePenalty(p)]));
      trimRosters(s);
      const cut = [...penalties.keys()].filter((id) => s.players[id]!.free_agent);
      expect(cut.length, `$${over}M over`).toBeGreaterThan(0);
      expect(s.teams[code]!.cap.dead, `$${over}M over`).toBeCloseTo(cut.reduce((n, id) => n + penalties.get(id)!, 0), 0);
    }
  });

  it("no release is ever free, in the situations that used to reach the emergency path: the dead money added is exactly the penalty of every player let go", () => {
    const setups: [string, () => { s: LeagueState; code: string }][] = [
      ["every contract dear to leave and nothing honest frees room", () => {
        const x = overTheCap(46, 5);
        for (const p of rosterOf(x.s, x.code)) {
          p.years_pro = 6;
          p.contract!.cap_hit_by_year = [1.5, 1.5, 1.5, 1.5];
          p.contract!.years_remaining = 4;
          delete p.contract!.prorated_per_year;
        }
        x.s.teams[x.code]!.cap.total = capUsedOf(x.s, x.code) - 5;
        return x;
      }],
      ["spots to refill and a star's contract the only honest cut", () => {
        const x = shortRosterJustUnderTheCap(52);
        Object.assign(sorted(x.s, x.code, "QB")[0]!.contract!, { cap_hit_by_year: [20], years_remaining: 1 });
        x.s.teams[x.code]!.cap.total = capUsedOf(x.s, x.code) + 1;
        return x;
      }],
      ["more dead money than the cap holds", () => {
        const x = overTheCap(50, 5);
        x.s.teams[x.code]!.cap.dead = x.s.teams[x.code]!.cap.total + 40;
        return x;
      }],
    ];
    for (const [label, build] of setups) {
      const { s, code } = build();
      const penalties = new Map(rosterOf(s, code).map((p) => [p.id, releasePenalty(p)]));
      const before = s.teams[code]!.cap.dead;
      trimRosters(s);
      const letGo = [...penalties.keys()].filter((id) => s.players[id]!.free_agent);
      expect(s.teams[code]!.cap.dead - before, label).toBeCloseTo(letGo.reduce((n, id) => n + penalties.get(id)!, 0), 0);
    }
  });

  it("credits a practice-squad move with what it really frees (his hit less the squad pay), so a team that can reach legality that way makes no further, paid releases (Codex review finding)", () => {
    const { s, code } = overTheCap(46, 1);
    minimumDeals(s, code);
    // fifteen young players on $1.5M: each squad move frees $1.3M, so fourteen of them cover the overage and the working room
    const young = bench(s, code).slice(0, 15);
    for (const p of young) {
      p.years_pro = 1;
      Object.assign(p.contract!, { cap_hit_by_year: [1.5], years_remaining: 1 });
    }
    s.teams[code]!.cap.total = capUsedOf(s, code) - 1;
    const before = rosterOf(s, code).map((p) => p.id);
    resetCpuCapShortfalls();
    trimRosters(s);
    expect(before.filter((id) => s.players[id]!.free_agent), "nobody is let go: the squad moves were enough").toEqual([]);
    expect(s.teams[code]!.cap.dead, "so no dead money is charged").toBe(0);
    expect(young.filter((p) => s.players[p.id]!.nfl_team.startsWith("PS:")).length, "the young players went to the squad").toBeGreaterThan(10);
    expect(cpuCapShortfalls).toBe(0);
  });

  it("prices a young player's cut as the squad move it will be, not as a paid release: a four-year $1.5M third quarterback goes to the squad and the team ends legal (Codex review finding)", () => {
    const { s, code } = overTheCap(46, 0);
    minimumDeals(s, code);
    const qb3 = sorted(s, code, "QB")[2]!;
    qb3.years_pro = 1;
    // as a paid release he would net only $0.4M (not worth the dead money); as a squad move he frees $1.3M with none
    Object.assign(qb3.contract!, { cap_hit_by_year: [1.5, 1.5, 1.5, 1.5], years_remaining: 4 });
    s.teams[code]!.cap.total = capUsedOf(s, code) - 0.2;
    resetCpuCapShortfalls();
    trimRosters(s);
    expect(s.players[qb3.id]!.nfl_team, "he is moved to the practice squad").toBe(`PS:${code}`);
    expect(cpuCapShortfalls, "and that was enough, so the team is not left over the cap").toBe(0);
    expect(s.teams[code]!.cap.dead, "with no dead money").toBe(0);
    expect(capUsedOf(s, code)).toBeLessThanOrEqual(s.teams[code]!.cap.total);
  });

  it("leaves a team that no honest release can make legal over the cap, counted, rather than freeing cap for it", () => {
    const { s, code } = overTheCap(50, 5);
    s.teams[code]!.cap.dead = s.teams[code]!.cap.total + 40; // more dead money than the cap holds
    const penalties = new Map(rosterOf(s, code).map((p) => [p.id, releasePenalty(p)]));
    const deadBefore = s.teams[code]!.cap.dead;
    resetCpuCapShortfalls();
    trimRosters(s);
    const cut = [...penalties.keys()].filter((id) => s.players[id]!.free_agent);
    expect(capUsedOf(s, code)).toBeGreaterThan(s.teams[code]!.cap.total);
    expect(cpuCapShortfalls).toBeGreaterThan(0);
    expect(s.teams[code]!.cap.dead).toBeCloseTo(deadBefore + cut.reduce((n, id) => n + penalties.get(id)!, 0), 0);
    // and the league carries on from there: the roster fill still runs and the team is not left empty
    fillRosterGaps(s, { lateMarket: true });
    expect(rosterOf(s, code).length).toBeGreaterThan(40);
  });

  it("makes a moderate overage legal without touching its best players at a position, and a large one only by paying for them", () => {
    const moderate = overTheCap(51, 10);
    const bestBefore = new Map<string, string>();
    for (const pos of new Set(rosterOf(moderate.s, moderate.code).map((p) => p.position))) {
      bestBefore.set(pos, rosterOf(moderate.s, moderate.code).filter((p) => p.position === pos).reduce((a, b) => (b.overall > a.overall ? b : a)).id);
    }
    trimRosters(moderate.s);
    expect(capUsedOf(moderate.s, moderate.code)).toBeLessThanOrEqual(moderate.s.teams[moderate.code]!.cap.total);
    for (const [pos, id] of bestBefore) expect(moderate.s.players[id]!.nfl_team, `best ${pos} kept`).toBe(moderate.code);
  });

  /** every contract at the minimum, so nothing but what a test sets is worth a cut */
  function minimumDeals(s: LeagueState, code: string): void {
    for (const p of rosterOf(s, code)) {
      p.contract!.cap_hit_by_year = [1, 1, 1, 1];
      p.contract!.years_remaining = 1;
      delete p.contract!.prorated_per_year;
    }
  }
  const sorted = (s: LeagueState, code: string, pos: string): Player[] => rosterOf(s, code).filter((p) => p.position === pos).sort((a, b) => b.overall - a.overall);

  it("tries the next tier when the paid backups free nothing: a replaceable starter whose release pays is cut, and nobody is cut for nothing (Codex review finding)", () => {
    const { s, code } = overTheCap(46, 5);
    minimumDeals(s, code);
    const qb3 = sorted(s, code, "QB")[2]!, wr2 = sorted(s, code, "WR")[1]!;
    // a paid backup whose release saves only $0.4M (he is not worth the dead money), and a replaceable starter whose release saves far more
    Object.assign(qb3.contract!, { cap_hit_by_year: [1.5, 1.5, 1.5, 1.5], years_remaining: 4 });
    Object.assign(wr2.contract!, { cap_hit_by_year: [20], years_remaining: 1 });
    s.teams[code]!.cap.total = capUsedOf(s, code) - 5;
    resetCpuCapShortfalls();
    trimRosters(s);
    expect(cpuCapShortfalls, "an honest release was available, so the team is made legal").toBe(0);
    expect(s.players[wr2.id]!.free_agent, "the starter whose release pays is the one who goes").toBe(true);
    expect(s.teams[code]!.cap.dead, "and he is charged like any release").toBeGreaterThan(0);
    expect(s.players[qb3.id]!.free_agent, "the backup whose release saves nothing stays").toBe(false);
  });

  /** a team three bodies short of a full roster, all on minimum deals, $1M under its raw cap: legal today, over it once the three spots are refilled */
  function shortRosterJustUnderTheCap(seed: number): { s: LeagueState; code: string } {
    const s = freshLeague(seed);
    const code = firstTeam(s);
    minimumDeals(s, code);
    const bench = rosterOf(s, code).filter((p) => p.position !== "QB").slice(-3);
    for (const p of bench) {
      p.free_agent = true;
      p.nfl_team = "FA";
      p.contract = null as never;
    }
    s.teams[code]!.cap.total = capUsedOf(s, code) + 1;
    return { s, code };
  }

  it("counts the minimum deals that refill its empty spots: a team $1M under the raw cap but three spots short is still over what it can carry (Codex review finding)", () => {
    const { s, code } = shortRosterJustUnderTheCap(52);
    resetCpuCapShortfalls();
    trimRosters(s);
    expect(cpuCapShortfalls, "nothing honest can cure it, and it is not left looking legal").toBeGreaterThan(0);
    expect(s.teams[code]!.cap.dead).toBe(0);
  });

  it("makes the honest release a star's contract requires when only the refill reserve puts the team over: it ends legal once the spots are refilled", () => {
    const { s, code } = shortRosterJustUnderTheCap(52);
    const qb = sorted(s, code, "QB")[0]!;
    Object.assign(qb.contract!, { cap_hit_by_year: [20], years_remaining: 1 });
    s.teams[code]!.cap.total = capUsedOf(s, code) + 1;
    resetCpuCapShortfalls();
    trimRosters(s);
    expect(s.players[qb.id]!.free_agent, "the one contract that pays is the one released, charged like any release").toBe(true);
    expect(s.teams[code]!.cap.dead).toBeGreaterThan(0);
    fillRosterGaps(s);
    expect(rosterOf(s, code).length).toBe(53);
    expect(capUsedOf(s, code)).toBeLessThanOrEqual(s.teams[code]!.cap.total + 1e-6);
  });

  it("an honest release leaves room for the minimum deals that refill its roster spots: the filled roster is under the cap (Codex review finding)", () => {
    const { s, code } = overTheCap(46, 5);
    minimumDeals(s, code);
    const wr2 = sorted(s, code, "WR")[1]!;
    Object.assign(wr2.contract!, { cap_hit_by_year: [20], years_remaining: 1 });
    s.teams[code]!.cap.total = capUsedOf(s, code) - 5;
    resetCpuCapShortfalls();
    fillRosterGaps(s);
    expect(cpuCapShortfalls).toBe(0);
    expect(rosterOf(s, code).length, "the vacancies are refilled").toBe(53);
    expect(capUsedOf(s, code), "and refilling does not put the team back over the cap").toBeLessThanOrEqual(s.teams[code]!.cap.total + 1e-6);
  });
});

describe("a CPU team's offers in the free-agency market", () => {
  function market(seed: number): { s: LeagueState; code: string } {
    const s = freshLeague(seed);
    s.stage = "freeAgency";
    for (const p of Object.values(s.players)) {
      if (!p.retired && !p.free_agent && p.contract && p.contract.years_remaining <= 0) {
        p.free_agent = true;
        p.nfl_team = "FA";
        p.contract = null as never;
      }
    }
    recomputeTeamRatings(s);
    Object.assign(s, { freeAgencyEvent: null });
    beginFreeAgencyEvent(s);
    return { s, code: s.freeAgencyEvent!.order[0]! };
  }

  it("bids only what its cap room covers: a team with none passes, the same team with room does not", () => {
    const { s, code } = market(47);
    expect(offerRoomFor(s, code)).toBeGreaterThan(0);
    expect(chooseFaMove(s, code).kind).toBe("offer");
    s.teams[code]!.cap.total = capUsedOf(s, code); // exactly nothing left
    expect(offerRoomFor(s, code)).toBeLessThanOrEqual(0);
    expect(chooseFaMove(s, code).kind).toBe("pass");
  });

  it("counts what its live offers would cost, so it cannot promise the same room twice", () => {
    const { s, code } = market(47);
    const room = offerRoomFor(s, code);
    const move = chooseFaMove(s, code);
    expect(move.kind).toBe("offer");
    s.freeAgencyEvent!.offers[(move as { playerId: string }).playerId] = [{ teamCode: code, salary: 7, years: 3, round: 1, sequence: 0 }];
    expect(offerRoomFor(s, code)).toBeCloseTo(room - 7, 1);
  });

  it("leaves a person's staff and their cap rules alone: the market suspends the cap for a GM", () => {
    const { s, code } = market(47);
    s.gms.push({ id: "g", teamCode: code, isHuman: true } as never);
    s.teams[code]!.cap.total = capUsedOf(s, code);
    expect(chooseFaMove(s, code).kind).toBe("offer");
  });

  it("offers a length that follows the player, with each club reading him a little differently", () => {
    const { s, code } = market(47);
    const move = chooseFaMove(s, code) as { kind: "offer"; playerId: string; salary: number; years: number };
    const p = s.players[move.playerId]!;
    const lean = deterministicNoiseUnit(code, s.season, "fa_years", p.id);
    expect(move.years).toBe(contractTermsFor(p, move.salary, [0.5, 0.5, 0.5], lean).years);
    expect(move.years).toBeGreaterThanOrEqual(1);
    expect(move.years).toBeLessThanOrEqual(5);
  });
});

describe("a free agent nobody can afford", () => {
  it("is not handed to a team with no room: no team qualifies, and an ordinary player is left on the market", () => {
    const s = freshLeague(44);
    for (const t of Object.values(s.teams)) t.cap.used = t.cap.total;
    expect(affordableTeams(s, 5)).toEqual([]);
    const ordinary = { ...Object.values(s.players)[0]!, overall: 74, position: "WR" as const } as Player;
    expect(aiOfferForPlayer(() => 0.5, s, ordinary)).toBeNull();
  });

  it("lets a star's bidders be the teams that can really make room, and only those", () => {
    const s = freshLeague(44);
    for (const t of Object.values(s.teams)) t.cap.used = t.cap.total;
    const star = { ...Object.values(s.players)[0]!, overall: 94, position: "WR" as const } as Player;
    // a third of the league is so far under water that no run of cuts gets it out
    const stuck = aiControlledTeams(s).filter((_, i) => i % 3 === 0);
    for (const c of stuck) s.teams[c]!.cap.dead = s.teams[c]!.cap.total + 500;
    const able = aiControlledTeams(s).filter((c) => planRoomFor(s, c, 20) !== null);
    expect(able.length).toBeGreaterThan(0);
    for (const c of stuck) expect(planRoomFor(s, c, 20)).toBeNull();
    for (let i = 0; i < 30; i++) {
      const offer = aiOfferForPlayer(() => (i + 1) / 37, s, star);
      expect(offer).not.toBeNull();
      expect(planRoomFor(s, offer!.teamCode, offer!.baseSalary)).not.toBeNull();
    }
  });
});

describe("a whole free-agency window", () => {
  it("never leaves a team further over the cap than it began, and a cut for room is always charged", () => {
    const s = freshLeague(45);
    s.stage = "offseasonFreeAgency";
    const deadBefore = new Map(Object.entries(s.teams).map(([c, t]) => [c, t.cap.dead]));
    beginBidding(s, "players");
    const start = new Map(Object.keys(s.teams).map((c) => [c, room(s, c)]));
    for (let day = 0; day < 5; day++) advanceBiddingDayOn(s, "players");
    for (const code of Object.keys(s.teams)) {
      expect(room(s, code), code).toBeGreaterThanOrEqual(Math.min(0, start.get(code)!) - 0.05);
      // whatever dead money a team holds, every release it made is in it
      expect(s.teams[code]!.cap.dead).toBeGreaterThanOrEqual(deadBefore.get(code)!);
      recomputeTeamRatings(s);
      expect(room(s, code)).toBeCloseTo(s.teams[code]!.cap.total - s.teams[code]!.cap.used, 1);
    }
  });
});

describe("contract terms follow the player", () => {
  const mid = [0.5, 0.5, 0.5] as const;
  const player = (age: number, overall: number, decline = 30) => ({ age, overall, decline_age_threshold: decline });

  it("gives a young starter a longer deal than a veteran past his decline, at the same rating", () => {
    expect(contractTermsFor(player(24, 82, 30), 12, mid).years).toBeGreaterThan(contractTermsFor(player(33, 82, 30), 12, mid).years);
  });
  it("gives a better player more years and more guaranteed than a fringe one, at the same age", () => {
    const star = contractTermsFor(player(26, 92), 12, mid);
    const fringe = contractTermsFor(player(26, 64), 12, mid);
    expect(star.years).toBeGreaterThan(fringe.years);
    expect(star.guaranteed / (star.years * 12)).toBeGreaterThan(fringe.guaranteed / (fringe.years * 12));
  });
  it("guarantees less of an older player's deal, and gives him a smaller signing bonus", () => {
    const young = contractTermsFor(player(25, 80), 12, mid);
    const old = contractTermsFor(player(33, 80), 12, mid);
    expect(old.guaranteed / (old.years * 12)).toBeLessThan(young.guaranteed / (young.years * 12));
    expect(old.signingBonus).toBeLessThan(young.signingBonus);
  });
  it("bans nothing: an old star can still be given several years, by a team that wants him that much", () => {
    const longest = Math.max(...[0, 0.25, 0.5, 0.75, 1].flatMap((v) => [-1, 0, 1].map((team) => contractTermsFor(player(33, 93, 32), 20, [v, 0.5, 0.5], team).years)));
    expect(longest).toBeGreaterThanOrEqual(3);
  });
  it("varies between teams and draws: the same player does not read the same to everyone", () => {
    const years = new Set([-1, -0.5, 0, 0.5, 1].flatMap((team) => [0, 0.5, 1].map((v) => contractTermsFor(player(28, 78), 10, [v, 0.5, 0.5], team).years)));
    expect(years.size).toBeGreaterThan(1);
  });
  it("stays inside the league's limits: one to five years, a bonus no bigger than a year's pay, a guarantee no bigger than the deal", () => {
    for (let age = 21; age <= 38; age++) {
      for (const overall of [50, 65, 75, 85, 97]) {
        for (const v of [0, 0.5, 1] as const) {
          const t = contractTermsFor(player(age, overall), 10, [v, v, v], v * 2 - 1);
          expect(t.years).toBeGreaterThanOrEqual(1);
          expect(t.years).toBeLessThanOrEqual(5);
          expect(t.signingBonus).toBeLessThanOrEqual(10);
          expect(t.guaranteed).toBeLessThanOrEqual(10 * t.years);
        }
      }
    }
  });
  it("is deterministic", () => {
    expect(contractTermsFor(player(29, 80), 12, [0.3, 0.6, 0.9], 0.2)).toEqual(contractTermsFor(player(29, 80), 12, [0.3, 0.6, 0.9], 0.2));
  });
});
