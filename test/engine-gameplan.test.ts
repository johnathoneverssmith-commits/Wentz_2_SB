import { describe, expect, it } from "vitest";

import { cleanPlan, DEFAULT_PLAN, type GamePlan, isDefaultPlan } from "../src/engine/gameplan.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const teams = teamList();

/** League-style averages for the plan's team over a spread of opponents, with the opponent on the default plan. */
function measure(plan: Partial<GamePlan> | undefined, games = 90) {
  const t = { att: 0, rush: 0, sack: 0, ypc: 0, ruY: 0, fourthGo: 0, fourthPunt: 0, fg: 0, pts: 0, g: 0, drives: 0 };
  for (let i = 0; i < games; i++) {
    const h = teams[i % 32]!;
    const a = teams[(i * 5 + 3) % 32]!;
    if (h === a) continue;
    const g = simulateGame(9000 + i, h, a, {
      homeRoster: roster(h),
      awayRoster: roster(a),
      overtime: "nfl",
      ...(plan ? { homePlan: cleanPlan(plan) } : {}),
    });
    const s = g.teams[0]!.s as Record<string, number>;
    t.att += s.pass_att ?? 0;
    t.rush += s.rush_att ?? 0;
    t.sack += s.sack ?? 0;
    t.ruY += s.rush_yards ?? 0;
    t.fourthGo += (s.fourth_conv ?? 0) + (s.fourth_att ?? 0);
    t.fourthPunt += s.punt ?? 0;
    t.fg += s.fg_att ?? 0;
    t.pts += g.score[0];
    t.drives += s.drives ?? 0;
    t.g++;
  }
  return {
    sacksPerGame: t.sack / t.g,
    passRate: t.att / (t.att + t.rush),
    sackRate: t.sack / (t.att + t.sack),
    ypc: t.ruY / t.rush,
    goPerGame: t.fourthGo / t.g,
    punts: t.fourthPunt / t.g,
    fg: t.fg / t.g,
    pts: t.pts / t.g,
  };
}

describe("game plans", () => {
  it("the default plan is the engine as validated: identical games, plan or no plan", () => {
    for (let i = 0; i < 6; i++) {
      const h = teams[i]!;
      const a = teams[i + 9]!;
      const base = { homeRoster: roster(h), awayRoster: roster(a), overtime: "nfl" as const, injuries: true };
      const none = simulateGame(i, h, a, base);
      const explicit = simulateGame(i, h, a, { ...base, homePlan: { ...DEFAULT_PLAN }, awayPlan: cleanPlan({}) });
      expect(explicit.score).toEqual(none.score);
    }
  });

  it("cleans anything: clamps every dial and makes the personnel mix sum to 100", () => {
    const p = cleanPlan({ passRate: 99, fourthOwn: -500, blitz: Number.NaN as never, p11: 10, p12: 10, p13: 10, rbCommittee: 90 });
    expect(p.passRate).toBe(15);
    expect(p.fourthOwn).toBe(-100);
    expect(p.blitz).toBe(0);
    expect(p.rbCommittee).toBe(50);
    expect(p.p11 + p.p12 + p.p13).toBe(100);
    expect(isDefaultPlan(cleanPlan({}))).toBe(true);
    expect(isDefaultPlan(cleanPlan({ blitz: 10 }))).toBe(false);
  });

  it("pass rate: more throws, and the price is more sacks taken", () => {
    const base = measure(undefined);
    const pass = measure({ passRate: 15 });
    const run = measure({ passRate: -15 });
    expect(pass.passRate).toBeGreaterThan(base.passRate + 0.05);
    expect(run.passRate).toBeLessThan(base.passRate - 0.05);
    // the rate per dropback is the line's; the number a game is not
    expect(pass.sacksPerGame).toBeGreaterThan(run.sacksPerGame);
  }, 240_000);

  it("fourth down: each zone's dial changes how often a team goes, and the red zone one changes field goals", () => {
    const base = measure(undefined);
    const all = measure({ fourthRedZone: 100, fourthOpp: 100, fourthOwn: 100 });
    const never = measure({ fourthRedZone: -100, fourthOpp: -100, fourthOwn: -100 });
    expect(all.goPerGame).toBeGreaterThan(base.goPerGame + 0.4);
    expect(never.goPerGame).toBeLessThan(base.goPerGame);
    const rz = measure({ fourthRedZone: 100 });
    expect(rz.fg).toBeLessThan(base.fg);
  }, 240_000);

  it("blitz: more sacks against the offence it is sent at", () => {
    // the plan is the *defence's*, so run it as the away team's
    const sack = (blitz: number) => {
      let sk = 0, att = 0;
      for (let i = 0; i < 90; i++) {
        const h = teams[i % 32]!, a = teams[(i * 5 + 3) % 32]!;
        if (h === a) continue;
        const g = simulateGame(9000 + i, h, a, { homeRoster: roster(h), awayRoster: roster(a), overtime: "nfl", awayPlan: cleanPlan({ blitz }) });
        const s = g.teams[0]!.s as Record<string, number>;
        sk += s.sack ?? 0;
        att += s.pass_att ?? 0;
      }
      return sk / (att + sk);
    };
    expect(sack(100)).toBeGreaterThan(sack(0) + 0.015);
    expect(sack(-100)).toBeLessThan(sack(0));
  }, 240_000);

  it("personnel: heavier sets run for more yards a carry and run more", () => {
    const base = measure(undefined);
    const heavy = measure({ p11: 20, p12: 50, p13: 30 });
    expect(heavy.ypc).toBeGreaterThan(base.ypc);
    expect(heavy.passRate).toBeLessThan(base.passRate);
  }, 240_000);

  it("running backs: a committee and a workhorse play differently", () => {
    const workhorse = measure({ rbCommittee: 0 });
    const split = measure({ rbCommittee: 50 });
    // not the same game: the dial does something
    expect(Math.abs(workhorse.ypc - split.ypc)).toBeGreaterThan(0.01);
  }, 240_000);
});
