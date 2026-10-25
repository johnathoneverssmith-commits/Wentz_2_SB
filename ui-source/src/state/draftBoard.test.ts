import { describe, expect, it } from "vitest";

import type { DraftProspect, LeagueState, Position } from "@/domain";
import { projectionLabel } from "@/domain";
import { SPECIALIST_ROOKIE_OFFSET } from "@/sim/draft-outcomes";
import { AI_DIFFICULTY_LEVELS, difficultyProfile, difficultyProfileAt } from "./aiDifficulty.ts";
import { ROOKIE_PREMIUM_SCALE, POSITION_VALUE, effectiveRating, expectedRatings, freeAgentAlternatives, positionPremium, rookieValue, slotNeedWeight, type MarketPlayer, type MarketTeam } from "./draftBoard.ts";
import { strategyOf } from "./aiGms.ts";
import { applyPick, beginDraft, bestAvailable, draftValue, planAutopicks, readFreeAgentMarket, readRookieBoard, runAiPicks } from "./rules.ts";
import { DEFAULT_CONFIG, createLeague, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";

/**
 * How a CPU GM reads a rookie board (`draftBoard.ts`): prospects on the league's
 * rating scale from public data only, incumbents by what they will be next
 * season, need counted slot by slot, and a diminishing return on a repeated
 * position. The league-level tests run whole drafts through the same functions
 * the single-player store and the online server call.
 */

const OFFENSE = new Set<Position>(["QB", "RB", "WR", "TE", "OT", "OG", "C"]);

function prospect(over: Partial<DraftProspect> & { id: string; slot: number }): DraftProspect {
  const { slot, ...rest } = over;
  return {
    name: rest.id,
    position: "WR",
    school: "State",
    age: 22,
    heightIn: 72,
    weightLb: 210,
    fortyTime: 4.5,
    classYear: "Senior",
    collegeOverall: Math.round(92 - slot * 0.14),
    projectedRound: Math.min(7, Math.ceil(slot / 32)),
    projectedRange: projectionLabel(slot),
    scoutingNote: "",
    trueOverall: 70,
    ...rest,
  } as DraftProspect;
}

/** A class laid out slot by slot, college grade following the projection, as the generator does. */
const board = (n = 96): DraftProspect[] => Array.from({ length: n }, (_, i) => prospect({ id: `p${i + 1}`, slot: i + 1 }));

describe("expected rating: a prospect read from public data, on the league's scale", () => {
  it("places him by the projected range, so a Top 10 prospect outranks a fifth-rounder with the same college grade", () => {
    const klass = [...board(), prospect({ id: "top", slot: 4, collegeOverall: 88 }), prospect({ id: "late", slot: 140, collegeOverall: 88 })];
    const r = expectedRatings(klass, 1);
    expect(r.get("top")! - r.get("late")!).toBeGreaterThan(8);
  });

  it("is not moved by the headline college grade at full accuracy", () => {
    const klass = [...board(), prospect({ id: "hi", slot: 40, collegeOverall: 96 }), prospect({ id: "lo", slot: 40, collegeOverall: 66 })];
    const r = expectedRatings(klass, 1);
    expect(Math.abs(r.get("hi")! - r.get("lo")!)).toBeLessThan(2);
  });

  it("is on the league's scale: first-rounders project to the low-to-mid 70s, not the college grade's 90s", () => {
    const s = freshLeague(11);
    const r = expectedRatings(s.draftClass, 1);
    const firstRound = [...s.draftClass].sort((a, b) => b.collegeOverall - a.collegeOverall).slice(0, 32);
    const mean = firstRound.reduce((t, p) => t + r.get(p.id)!, 0) / firstRound.length;
    expect(mean).toBeGreaterThan(66);
    expect(mean).toBeLessThan(79);
    for (const v of r.values()) expect(v).toBeGreaterThanOrEqual(40);
  });

  it("never reads the hidden rating: scrambling every true rating changes nothing", () => {
    const s = freshLeague(12);
    const scrambled = s.draftClass.map((p, i) => ({ ...p, trueOverall: i % 2 ? 41 : 99 }));
    for (const accuracy of [0.5, 0.7, 0.9, 1]) {
      expect([...expectedRatings(scrambled, accuracy)]).toEqual([...expectedRatings(s.draftClass, accuracy)]);
    }
  });

  it("rates a specialist on his own scale, the offset above a position player at the same slot", () => {
    const klass = [...board(), prospect({ id: "wr", slot: 100 }), prospect({ id: "k", slot: 100, position: "K" })];
    const r = expectedRatings(klass, 1);
    expect(Math.round(r.get("k")! - r.get("wr")!)).toBe(SPECIALIST_ROOKIE_OFFSET);
  });

  it("reads less of the board at a lower accuracy, but still ranks the class the same way (a blurrier read, not a broken one)", () => {
    const s = freshLeague(13);
    const hard = expectedRatings(s.draftClass, 1);
    const easy = expectedRatings(s.draftClass, 0.5);
    const ids = s.draftClass.map((p) => p.id);
    const rank = (m: Map<string, number>) => new Map([...ids].sort((a, b) => m.get(b)! - m.get(a)! || (a < b ? -1 : 1)).map((id, i) => [id, i]));
    const a = rank(hard), b = rank(easy);
    const n = ids.length;
    const d2 = ids.reduce((t, id) => t + (a.get(id)! - b.get(id)!) ** 2, 0);
    const spearman = 1 - (6 * d2) / (n * (n * n - 1));
    expect(spearman).toBeGreaterThan(0.9);
    expect(spearman).toBeLessThan(1);
  });
});

describe("incumbents: what a player will be next season", () => {
  const base = { position: "WR" as Position, overall: 80, age: 26, yearsLeft: 3 };
  it("counts age: an older player is worth less next season than a prime one of the same rating", () => {
    expect(effectiveRating({ ...base, age: 33 }, 1)).toBeLessThan(effectiveRating({ ...base, age: 26 }, 1));
  });
  it("fades running backs earlier than quarterbacks", () => {
    const rb = effectiveRating({ ...base, position: "RB", age: 30 }, 1);
    const qb = effectiveRating({ ...base, position: "QB", age: 30 }, 1);
    expect(rb).toBeLessThan(qb);
  });
  it("counts the contract: one that ends inside the horizon is worth less", () => {
    expect(effectiveRating({ ...base, yearsLeft: 0 }, 1)).toBeLessThan(effectiveRating({ ...base, yearsLeft: 3 }, 1));
  });
  it("reads the future only as much as the GM's long-term weight says (zero is the rating today)", () => {
    expect(effectiveRating({ ...base, age: 34, yearsLeft: 0 }, 0)).toBe(80);
    const full = effectiveRating({ ...base, age: 34, yearsLeft: 0 }, 1);
    const half = effectiveRating({ ...base, age: 34, yearsLeft: 0 }, 0.45);
    expect(full).toBeLessThan(half);
    expect(half).toBeLessThan(80);
  });
});

describe("what a prospect adds to a team", () => {
  const needy = { needAwareness: 1 };
  const value = (over: Partial<Parameters<typeof rookieValue>[0]>) => rookieValue({ expected: 72, position: "WR", carried: [], needAwareness: 1, ...over });

  it("counts every starting slot, not just the best player (an elite WR1 over holes at WR2 and WR3 is a need)", () => {
    const holes = value({ carried: [90, 62, 60, 58, 55, 50] });
    const solid = value({ carried: [90, 82, 80, 58, 55, 50] });
    expect(holes - solid).toBeGreaterThan(8);
  });
  it("wants the position most when nobody is there", () => {
    expect(value({ position: "QB", carried: [] })).toBeGreaterThan(value({ position: "QB", carried: [70, 66, 60] }));
  });
  it("values a starter at an elite, settled position less than the same prospect at a weak one", () => {
    expect(value({ position: "RB", carried: [93, 60, 58, 55] })).toBeLessThan(value({ position: "RB", carried: [64, 60, 58, 55] }));
  });
  it("penalises a pick who would be the first cut at a full position", () => {
    const full = value({ expected: 60, position: "QB", carried: [85, 80, 78] });
    const room = value({ expected: 60, position: "QB", carried: [85, 80] });
    expect(room - full).toBeGreaterThanOrEqual(24);
  });
  it("makes each earlier pick at a position count against the next, faster where there are few roster spots", () => {
    const qb = (n: number) => value({ position: "QB", carried: [70, 65], draftedHere: n });
    expect(qb(0)).toBeGreaterThan(qb(1));
    expect(qb(1)).toBeGreaterThan(qb(2));
    const wr = (n: number) => value({ position: "WR", carried: [70, 65, 60, 58, 55, 50], draftedHere: n });
    expect(qb(0) - qb(2)).toBeGreaterThan(wr(0) - wr(2));
  });
  it("does not make a specialist worth more than the same slot at another position (his scale is only for comparing him with his own kicker)", () => {
    // the rating scale offset is not value: take each position's own premium out and the same slot is worth the same
    const bare = (position: Position, expected: number) => value({ position, expected, carried: [], needAwareness: 0 }) - ROOKIE_PREMIUM_SCALE * positionPremium(position);
    expect(bare("K", 70 + SPECIALIST_ROOKIE_OFFSET)).toBeCloseTo(bare("WR", 70), 9);
  });
  it("scales need with the GM's need-awareness (at zero it is the prospect's rating and his position's premium)", () => {
    const hole = { position: "QB" as Position, carried: [55] };
    expect(value({ ...hole, needAwareness: 0 })).toBeLessThan(value({ ...hole, ...needy }));
    expect(value({ ...hole, needAwareness: 0 })).toBeCloseTo(72 + ROOKIE_PREMIUM_SCALE * positionPremium("QB"), 9);
  });
});

describe("what a position is worth in a rookie pick", () => {
  it("follows the market's hierarchy, tempered by the engine's: quarterback, then edge, receiver, back, tight end, outside linebacker, punter", () => {
    const order: Position[] = ["QB", "EDGE", "WR", "RB", "TE", "OLB", "P"];
    for (let i = 1; i < order.length; i++) expect(positionPremium(order[i - 1]!), `${order[i - 1]} above ${order[i]}`).toBeGreaterThan(positionPremium(order[i]!));
  });
  it("is compressed, so the quarterback cannot outweigh a whole rookie projection", () => {
    for (const p of Object.keys(POSITION_VALUE) as Position[]) expect(Math.abs(positionPremium(p))).toBeLessThan(5);
    // the engine alone would price a quarterback at +10 and a running back at +7 over the same slot
    expect(positionPremium("QB") * ROOKIE_PREMIUM_SCALE).toBeLessThan(5);
  });
  it("blends both views: a running back is worth more to the engine than to the market, and the premium lands between them", () => {
    const market = 9 * Math.log(0.78 / 0.9); // about -1.3: the market prices a back low
    expect(positionPremium("RB")).toBeGreaterThan(market + 1);
    expect(positionPremium("RB")).toBeLessThan(POSITION_VALUE.RB - 3); // and the engine's +7, tempered to under +1
  });
  it("orders equal prospects by position: the same slot is worth more at quarterback than at tight end", () => {
    const talent = (position: Position) => rookieValue({ expected: 70, position, carried: [], needAwareness: 0 });
    expect(talent("QB")).toBeGreaterThan(talent("WR"));
    expect(talent("WR")).toBeGreaterThan(talent("TE"));
  });
  it("leaves the fantasy draft's own table alone", () => {
    expect(draftValue(80, "QB")).toBe(90);
    expect(draftValue(80, "RB")).toBe(87);
    expect(draftValue(80, "OLB")).toBe(72);
    expect(draftValue(80, "P")).toBe(66);
  });
});

describe("where a pick falls in the draft", () => {
  it("counts need for little at the top, normally in the middle rounds and more late", () => {
    expect(slotNeedWeight(0)).toBeCloseTo(0.5, 2);
    expect(slotNeedWeight(0)).toBeLessThan(slotNeedWeight(30));
    expect(slotNeedWeight(30)).toBeLessThan(slotNeedWeight(100));
    expect(slotNeedWeight(100)).toBeLessThan(slotNeedWeight(223));
    expect(slotNeedWeight(100)).toBeGreaterThan(1);
    expect(slotNeedWeight(223)).toBeLessThan(1.3);
  });
  it("makes the same hole worth more at pick 150 than at pick 3 (best player available early)", () => {
    const hole = (pickIndex: number) => rookieValue({ expected: 72, position: "OT", carried: [60], needAwareness: 1, pickIndex });
    const settled = (pickIndex: number) => rookieValue({ expected: 72, position: "OT", carried: [85, 84], needAwareness: 1, pickIndex });
    expect(hole(150) - settled(150)).toBeGreaterThan(hole(3) - settled(3));
  });
});

describe("free agents as the alternative to drafting for a hole", () => {
  const team = (code: string, capRoom: number, weakest: Partial<Record<Position, number>> = {}): MarketTeam => ({ code, capRoom, weakest });
  const fa = (position: Position, overall: number, asking = 2, age = 27): MarketPlayer => ({ position, overall, age, asking });

  it("gives the neediest team the best free agent and nobody else the same one", () => {
    const m = freeAgentAlternatives([team("A", 40, { K: 70 }), team("B", 40), team("C", 40, { K: 60 })], [fa("K", 85)]);
    expect(m.get("B")?.get("K")).toBeGreaterThan(80); // no kicker at all: first served
    expect(m.get("A")?.get("K")).toBeUndefined();
    expect(m.get("C")?.get("K")).toBeUndefined();
  });
  it("cannot sign the same player for everyone: five teams without a kicker and two free agents leave three with nothing", () => {
    const teams = ["A", "B", "C", "D", "E"].map((c) => team(c, 40));
    const m = freeAgentAlternatives(teams, [fa("K", 85), fa("K", 80)]);
    expect(teams.filter((t) => m.get(t.code)?.has("K")).length).toBe(2);
  });
  it("spends a team's cap room down across positions: one team cannot sign at every position what it could afford at one", () => {
    // $20M of room and four $7M free agents: one signing leaves $13M, and a second $7M is more than half of that.
    // Served position by position, each would have been judged against the full $20M and all four assumed signed ($28M).
    const need = { K: 60, P: 60, WR: 60, OT: 60 } as const;
    const four = [fa("K", 85, 7), fa("P", 85, 7), fa("WR", 85, 7), fa("OT", 85, 7)];
    expect(freeAgentAlternatives([team("A", 20, need)], four).get("A")?.size).toBe(1);
    // room that really does cover several signings is not held back: $4M each against $20M all fit
    const cheap = [fa("K", 85, 4), fa("P", 85, 4), fa("WR", 85, 4), fa("OT", 85, 4)];
    expect(freeAgentAlternatives([team("A", 20, need)], cheap).get("A")?.size).toBe(4);
  });
  it("serves the neediest slot in the league first, whatever its position", () => {
    // one team, room for one signing, two holes: the worse hole gets the free agent
    const m = freeAgentAlternatives([team("A", 9, { K: 70, WR: 40 })], [fa("K", 85, 4), fa("WR", 85, 4)]);
    expect(m.get("A")?.has("WR")).toBe(true);
    expect(m.get("A")?.has("K")).toBe(false);
  });
  it("counts only what a team can afford (no more than half its cap room on one player)", () => {
    const m = freeAgentAlternatives([team("poor", 6), team("rich", 60)], [fa("OT", 88, 14)]);
    expect(m.get("poor")?.get("OT")).toBeUndefined();
    expect(m.get("rich")?.get("OT")).toBeGreaterThan(80);
  });
  it("is no alternative unless the free agent actually upgrades the weakest starter", () => {
    const m = freeAgentAlternatives([team("A", 40, { WR: 80 })], [fa("WR", 81)]);
    expect(m.get("A")?.get("WR")).toBeUndefined();
  });
  it("sees a free agent as he will be next season: an old one is worth less than his rating", () => {
    const m = freeAgentAlternatives([team("A", 40)], [fa("WR", 80, 2, 36)]);
    expect(m.get("A")?.get("WR")).toBeLessThan(80);
  });
  it("makes a hole the market can fill a smaller need, and more so for a GM who plans around the market", () => {
    const hole = { expected: 79, position: "K" as Position, carried: [] as number[], needAwareness: 1, pickIndex: 70 };
    const none = rookieValue({ ...hole });
    const expert = rookieValue({ ...hole, alternative: 82, capPlanningWeight: 1 });
    const casual = rookieValue({ ...hole, alternative: 82, capPlanningWeight: 0.5 });
    expect(expert).toBeLessThan(casual);
    expect(casual).toBeLessThan(none);
  });
  it("reads the real market from the league: a team with no kicker is offered a free agent, unless it cannot afford one", () => {
    const s = freshLeague(41);
    const codes = Object.keys(s.teams);
    const t = codes[0]!;
    const kickers = Object.values(s.players).filter((p) => p.position === "K" && !p.retired);
    for (const k of kickers.filter((p) => p.nfl_team === t)) k.retired = true; // the team has none
    const donor = kickers.find((p) => p.nfl_team !== t && !p.retired)!;
    donor.free_agent = true; // one real kicker on the market
    donor.nfl_team = "FA";
    donor.contract = undefined as unknown as typeof donor.contract; // a free agent has no deal
    const offered = readFreeAgentMarket(s).get(t)?.get("K");
    expect(offered, "a kicker is available to a team that has none").toBeGreaterThan(50);
    // ... and it is what that team's board is given to weigh the hole against
    expect(readRookieBoard(s, t, difficultyProfile("expert")).alternatives.get("K")).toBe(offered);
    s.teams[t]!.cap.used = s.teams[t]!.cap.total - 0.2; // no room: nobody is affordable
    expect(readFreeAgentMarket(s).get(t)?.get("K")).toBeUndefined();
  });
});

describe("difficulty scales how much of the board a GM reads", () => {
  it("rises with the level, full at Expert and Master", () => {
    const acc = AI_DIFFICULTY_LEVELS.map((l) => difficultyProfile(l).scoutingAccuracy);
    expect(acc).toEqual([...acc].sort((a, b) => a - b));
    expect(difficultyProfile("expert").scoutingAccuracy).toBe(1);
    expect(difficultyProfile("master").scoutingAccuracy).toBe(1);
    expect(difficultyProfile("casual").scoutingAccuracy).toBeGreaterThanOrEqual(0.5);
  });
  it("shows in what a GM reads: an easier GM sees the board less precisely than an expert, on the same scale", () => {
    const s = freshLeague(31);
    const code = Object.keys(s.teams)[0]!;
    const expert = readRookieBoard(s, code, difficultyProfile("expert")).expected;
    const casual = readRookieBoard(s, code, difficultyProfile("casual")).expected;
    expect([...expert]).toEqual([...expectedRatings(s.draftClass, 1)]);
    expect([...casual]).toEqual([...expectedRatings(s.draftClass, difficultyProfile("casual").scoutingAccuracy)]);
    expect([...casual]).not.toEqual([...expert]);
    // still the league's scale: the two reads differ by a few points, not by a whole scale
    const worst = Math.max(...s.draftClass.map((p) => Math.abs(casual.get(p.id)! - expert.get(p.id)!)));
    expect(worst).toBeLessThan(10);
  });
  it("blends for a GM between levels", () => {
    const mid = difficultyProfileAt(1.5).scoutingAccuracy;
    expect(mid).toBeGreaterThan(difficultyProfile("standard").scoutingAccuracy);
    expect(mid).toBeLessThan(difficultyProfile("competitive").scoutingAccuracy);
  });
});

/** A league with rosters, the way the online tests build one. */
const built = new Map<number, LeagueState>();
function freshLeague(seed: number, over: Partial<typeof DEFAULT_CONFIG> = {}): LeagueState {
  // building a league is the slow part: build each seed once and hand out copies
  let base = built.get(seed);
  if (!base) {
    base = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(base);
    recomputeTeamRatings(base);
    for (const g of base.gms) g.isHuman = false;
    base.stage = "offseasonDraft";
    built.set(seed, base);
  }
  const s = structuredClone(base);
  s.config = { ...s.config, ...over };
  return s;
}

function draftAll(s: LeagueState): string[] {
  beginDraft(s, "rookie");
  runAiPicks(s);
  expect(s.draft!.currentPickIndex).toBe(s.draft!.pickOrder.length);
  return s.draft!.results.map((r) => r.selectedId!);
}

describe("a whole rookie draft", () => {
  const baseline = draftAll(freshLeague(21));

  it("is deterministic: the same league drafts the same board again, however its players are keyed", () => {
    const rekeyed = freshLeague(21);
    rekeyed.players = Object.fromEntries(Object.entries(rekeyed.players).reverse());
    expect(draftAll(rekeyed)).toEqual(baseline);
  });

  it("never uses a prospect's hidden rating: scrambling every true rating gives the same draft", () => {
    const s = freshLeague(21);
    s.draftClass = s.draftClass.map((p, i) => ({ ...p, trueOverall: 99 - ((i * 7) % 58) }));
    expect(draftAll(s)).toEqual(baseline);
  });

  it("gives the human's suggestion and the CPU's pick the same answer, pick after pick", () => {
    const s = freshLeague(23);
    beginDraft(s, "rookie");
    for (let i = 0; i < 48; i++) {
      const suggested = bestAvailable(s);
      expect(planAutopicks(s)[0]).toBe(suggested);
      applyPick(s, suggested!);
    }
  });

  it("leaves picks already made alone: a plan covers only what remains", () => {
    const s = freshLeague(24);
    beginDraft(s, "rookie");
    for (let i = 0; i < 40; i++) applyPick(s, bestAvailable(s)!);
    const made = s.draft!.results.map((r) => r.selectedId);
    const plan = planAutopicks(s);
    expect(plan).toHaveLength(s.draft!.pickOrder.length - 40);
    expect(new Set([...made, ...plan]).size).toBe(made.length + plan.length);
    expect(s.draft!.results.map((r) => r.selectedId)).toEqual(made);
  });

  it("keeps every GM strategy's character: an offense-heavy GM and a defense-heavy one draft differently", () => {
    const share = (strategy: "offense_heavy" | "defense_heavy"): number => {
      const s = freshLeague(25);
      for (const g of s.aiGms ?? []) g.strategy = strategy;
      const ids = new Set(draftAll(s).slice(0, 96));
      const picks = s.draftClass.filter((p) => ids.has(p.id));
      return picks.filter((p) => OFFENSE.has(p.position)).length / picks.length;
    };
    // same league, same rosters: only the strategy differs. (On rosters the strategies themselves built in a fantasy draft the
    // gap is larger, but those rosters then also pull the other way through need.)
    expect(share("offense_heavy") - share("defense_heavy")).toBeGreaterThan(0.1);
  });

  it("does not reverse a strategy through the roster it built: offense-leaning GMs draft more offense than defense-heavy ones", () => {
    // Rosters built by a fantasy draft, strategy and all: an offense-heavy GM's team is stacked on offense, and need pulls its
    // rookie picks to defense. Left at the old 0.75, the strategy lost that tug of war and the two groups swapped (22% offense
    // for offense-heavy against 64% for defense-heavy).
    let offense = 0, offensePicks = 0, defense = 0, defensePicks = 0;
    for (const seed of [25, 26]) {
      const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
      for (const g of s.gms) g.isHuman = false;
      s.stage = "fantasyDraft";
      beginDraft(s, "fantasy");
      runAiPicks(s);
      s.draft = null;
      s.stage = "offseasonDraft";
      beginDraft(s, "rookie");
      runAiPicks(s);
      const byId = new Map(s.draftClass.map((p) => [p.id, p]));
      for (const r of s.draft!.results.slice(0, 96)) {
        const strategy = strategyOf(s, r.teamCode);
        const isOffense = OFFENSE.has(byId.get(r.selectedId!)!.position);
        if (strategy === "offense_heavy" || strategy === "pass_heavy" || strategy === "run_heavy") { offensePicks++; offense += Number(isOffense); }
        else if (strategy === "defense_heavy") { defensePicks++; defense += Number(isOffense); }
      }
    }
    expect(offensePicks).toBeGreaterThan(0);
    expect(defensePicks).toBeGreaterThan(0);
    expect(offense / offensePicks).toBeGreaterThan(defense / defensePicks);
  });

  it("is still credible at the easiest difficulty: its first-round picks are first- or second-round projections", () => {
    for (const difficulty of ["casual", "expert"] as const) {
      const s = freshLeague(26, { difficulty });
      const ids = draftAll(s).slice(0, 32);
      const byId = new Map(s.draftClass.map((p) => [p.id, p]));
      const credible = ids.filter((id) => byId.get(id)!.projectedRound <= 2).length / 32;
      expect(credible, difficulty).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("does not stack: no team takes three quarterbacks, and picks beyond half a position's roster spots stay rare", () => {
    // roster spots by position (the template's counts); half of them, at least one, is a reasonable draft's worth
    const SPOTS: Record<string, number> = { QB: 3, RB: 4, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, EDGE: 5, DT: 5, ILB: 5, CB: 6, S: 4, K: 1, P: 1, OLB: 0 };
    let excess = 0;
    let teams = 0;
    for (const seed of [27, 28]) {
      const s = freshLeague(seed);
      const ids = draftAll(s);
      const byId = new Map(s.draftClass.map((p) => [p.id, p]));
      const perTeam = new Map<string, Map<string, number>>();
      s.draft!.results.forEach((r, i) => {
        const pos = byId.get(ids[i]!)!.position;
        const m = perTeam.get(r.teamCode) ?? new Map<string, number>();
        m.set(pos, (m.get(pos) ?? 0) + 1);
        perTeam.set(r.teamCode, m);
      });
      for (const [team, m] of perTeam) {
        expect(m.get("QB") ?? 0, `${seed} ${team} quarterbacks`).toBeLessThan(3);
        for (const [pos, n] of m) excess += Math.max(0, n - Math.max(1, Math.round((SPOTS[pos] ?? 1) / 2)));
        teams++;
      }
    }
    // the old logic averaged 0.09 to 0.17 excess picks a team on the same measure, this one about 0.03, and without
    // the repeat penalty it is 0.17 again
    expect(excess / teams).toBeLessThan(0.08);
  });
});
