import { describe, expect, it } from "vitest";

import type { DraftProspect, LeagueState, Position } from "@/domain";
import { projectionLabel } from "@/domain";
import { SPECIALIST_ROOKIE_OFFSET } from "@/sim/draft-outcomes";
import { AI_DIFFICULTY_LEVELS, difficultyProfile, difficultyProfileAt } from "./aiDifficulty.ts";
import { effectiveRating, expectedRatings, rookieValue } from "./draftBoard.ts";
import { strategyOf } from "./aiGms.ts";
import { applyPick, beginDraft, bestAvailable, planAutopicks, readRookieBoard, runAiPicks } from "./rules.ts";
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
    const talent = (position: Position, expected: number) => value({ position, expected, carried: [], needAwareness: 0 });
    expect(talent("K", 70 + SPECIALIST_ROOKIE_OFFSET)).toBe(talent("WR", 70));
  });
  it("scales need with the GM's need-awareness (at zero it is the prospect's own rating)", () => {
    const hole = { position: "QB" as Position, carried: [55] };
    expect(value({ ...hole, needAwareness: 0 })).toBeLessThan(value({ ...hole, ...needy }));
    expect(value({ ...hole, needAwareness: 0 })).toBe(72 - 0.2 * 0 - 0);
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
