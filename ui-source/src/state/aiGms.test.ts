import { describe, expect, it } from "vitest";

import type { LeagueState, SeasonOutcome } from "@/domain";
import { difficultyProfile, difficultyProfileAt } from "./aiDifficulty";
import {
  aiGmOf,
  aiMovesOf,
  aiSecurity,
  chooseGmStrategy,
  difficultyFor,
  effectiveLevel,
  gmIdentity,
  runAiFirings,
  strategyOf,
  syncAiGms,
} from "./aiGms";
import { AI_SEASON_STRATEGIES } from "./aiStrategy";
import { createLeague } from "./seed";

const league = (seed = 11): LeagueState => createLeague(seed);

const bad = (season: number, teamCode: string, gmId: string): SeasonOutcome => ({
  season,
  gmId,
  teamCode,
  madePlayoffs: false,
  seed: 0,
  furthestRound: "none",
  wonSuperBowl: false,
  regularSeasonRecord: { wins: 2, losses: 15, ties: 0 },
  eliminationMargin: null,
  pointDifferential: -180,
  rivalsEliminated: [],
});

describe("CPU general managers", () => {
  it("a new league has a named GM for every CPU team, and more GMs than teams", () => {
    const s = league();
    const teams = Object.keys(s.teams).filter((c) => s.teams[c]!.controlledBy.kind === "ai");
    for (const c of teams) expect(aiGmOf(s, c), c).toBeDefined();
    expect(s.aiGms!.length).toBeGreaterThan(teams.length);
    expect(new Set(s.aiGms!.map((g) => g.name)).size).toBe(s.aiGms!.length);
    // never two GMs on one team
    const seated = s.aiGms!.filter((g) => g.teamCode).map((g) => g.teamCode);
    expect(new Set(seated).size).toBe(seated.length);
  });

  it("philosophies are spread across the league, not 32 copies of one idea", () => {
    const s = league(4);
    const byStrategy = new Map<string, number>();
    for (const g of s.aiGms!.filter((x) => x.teamCode)) byStrategy.set(g.strategy, (byStrategy.get(g.strategy) ?? 0) + 1);
    expect(byStrategy.size).toBe(AI_SEASON_STRATEGIES.length);
    for (const n of byStrategy.values()) expect(n).toBeLessThanOrEqual(6);
  });

  it("a person taking a team sends that team's GM to the pool, and the league keeps its count", () => {
    const s = league();
    const before = s.aiGms!.length;
    const was = aiGmOf(s, "GB")!;
    s.teams.GB!.controlledBy = { kind: "human", gmId: "gm_you" };
    s.gms[0]!.teamCode = "GB";
    syncAiGms(s);
    expect(aiGmOf(s, "GB")).toBeUndefined();
    expect(s.aiGms!.find((g) => g.id === was.id)!.teamCode).toBeNull();
    expect(s.aiGms!.length).toBeGreaterThanOrEqual(before);
    expect(s.aiGms!.filter((g) => g.teamCode === null).length).toBeGreaterThan(0);
  });

  it("skill is a bell curve around the difficulty, and the best of a level reach toward the next", () => {
    const skills = Array.from({ length: 12 }, (_, i) => league(100 + i).aiGms!.map((g) => g.skill)).flat();
    const mean = skills.reduce((a, b) => a + b, 0) / skills.length;
    const sd = Math.sqrt(skills.reduce((a, b) => a + (b - mean) ** 2, 0) / skills.length);
    expect(Math.abs(mean)).toBeLessThan(0.25);
    expect(sd).toBeGreaterThan(0.75);
    expect(sd).toBeLessThan(1.25);
    expect(Math.max(...skills)).toBeGreaterThan(1.6);
    expect(Math.min(...skills)).toBeLessThan(-1.6);
    // on the scale (casual 0 .. master 4): the best Competitive GM is nearer Expert than Competitive's own level
    expect(effectiveLevel("competitive", 2.1)).toBeGreaterThan(2.5);
    expect(effectiveLevel("competitive", -2.1)).toBeLessThan(1.5);
    expect(effectiveLevel("competitive", 0)).toBe(2);
    // nobody is better than the top level or worse than the bottom one
    expect(effectiveLevel("master", 2.2)).toBe(4);
    expect(effectiveLevel("casual", -2.2)).toBe(0);
  });

  it("a GM between two levels plays between them", () => {
    const comp = difficultyProfile("competitive");
    const expert = difficultyProfile("expert");
    const mid = difficultyProfileAt(2.5);
    expect(mid.evaluationNoise).toBeLessThan(comp.evaluationNoise);
    expect(mid.evaluationNoise).toBeGreaterThan(expert.evaluationNoise);
    expect(difficultyProfileAt(2).evaluationNoise).toBe(comp.evaluationNoise);
    expect(difficultyProfileAt(3)).toEqual(expert);
    expect(difficultyProfileAt(4)).toEqual(difficultyProfile("master"));
    // search depth grows with skill
    expect(difficultyProfileAt(1.5).candidateDepth).toBeGreaterThan(difficultyProfile("standard").candidateDepth);
  });

  it("in one league the GMs of one difficulty do not all play alike", () => {
    const s = league(21);
    s.config.difficulty = "competitive";
    const noise = new Set(s.aiGms!.filter((g) => g.teamCode).map((g) => difficultyFor(s, g.teamCode!).evaluationNoise.toFixed(3)));
    expect(noise.size).toBeGreaterThan(10);
  });

  it("a person's own team plays at Expert and keeps the identity they chose", () => {
    const s = league();
    s.gms[0]!.teamCode = "KC";
    s.teams.KC!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
    expect(strategyOf(s, "KC")).toBe("balanced");
    expect(chooseGmStrategy(s, s.gms[0]!.id, "trenches_first").ok).toBe(true);
    expect(strategyOf(s, "KC")).toBe("trenches_first");
    expect(difficultyFor(s, "KC")).toEqual(difficultyProfile("expert"));
    expect(chooseGmStrategy(s, s.gms[0]!.id, "nonsense").ok).toBe(false);
    // other people see "human GM" and no identity
    expect(gmIdentity(s, "KC")).toMatchObject({ isHuman: true, strategy: null });
    expect(gmIdentity(s, "GB")).toMatchObject({ isHuman: false });
    // locked while the league is running, open again at the owners' review each offseason
    s.stage = "fantasyDraft";
    expect(chooseGmStrategy(s, s.gms[0]!.id, "run_heavy").ok).toBe(false);
    s.stage = "regularSeason";
    expect(chooseGmStrategy(s, s.gms[0]!.id, "run_heavy").ok).toBe(false);
    s.stage = "offseasonHotSeat";
    expect(chooseGmStrategy(s, s.gms[0]!.id, "run_heavy").ok).toBe(true);
    expect(strategyOf(s, "KC")).toBe("run_heavy");
  });

  it("fires a CPU GM after three terrible seasons, to the pool, and hires a different mind who has not just worked", () => {
    const s = league(31);
    const gm = aiGmOf(s, "NYJ")!;
    s.season = 2029;
    gm.hiredSeason = 2027;
    gm.seasons = [bad(2027, "NYJ", gm.id), bad(2028, "NYJ", gm.id), bad(2029, "NYJ", gm.id)];
    expect(aiSecurity(gm)!.level).toBe("fired");
    // one pool GM was fired last year; the rest have rested
    const pool = s.aiGms!.filter((g) => !g.teamCode);
    pool[0]!.lastEmployedSeason = 2029;
    const total = s.aiGms!.length;
    const moves = runAiFirings(s);
    const fired = moves.filter((m) => m.kind === "fired");
    expect(fired.map((m) => m.teamCode)).toContain("NYJ");
    const hire = moves.find((m) => m.kind === "hired" && m.teamCode === "NYJ")!;
    expect(hire.strategy).not.toBe(gm.strategy);
    expect(hire.gmId).not.toBe(pool[0]!.id);
    expect(aiGmOf(s, "NYJ")!.id).toBe(hire.gmId);
    // the fired GM waits in the pool, still counted, with the year they last worked
    const was = s.aiGms!.find((g) => g.id === gm.id)!;
    expect(was.teamCode).toBeNull();
    expect(was.lastEmployedSeason).toBe(2029);
    expect(s.aiGms!.length).toBe(total);
    expect(s.aiGms!.filter((g) => !g.teamCode).length).toBeGreaterThan(0);
    // once a season
    expect(runAiFirings(s)).toEqual([]);
    expect(aiMovesOf(s, 2029).length).toBe(moves.length);
  });

  it("does not fire a GM in their first two seasons, however bad", () => {
    const s = league(32);
    const gm = aiGmOf(s, "NYG")!;
    s.season = 2028;
    gm.hiredSeason = 2027;
    gm.seasons = [bad(2027, "NYG", gm.id), bad(2028, "NYG", gm.id)];
    expect(aiSecurity(gm)!.level).not.toBe("fired");
    expect(runAiFirings(s).filter((m) => m.kind === "fired" && m.teamCode === "NYG")).toEqual([]);
  });
});
