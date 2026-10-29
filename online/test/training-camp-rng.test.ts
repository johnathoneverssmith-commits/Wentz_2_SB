import { describe, expect, it } from "vitest";

import { DEVELOPMENT_ROLES, type LeagueState } from "@/domain";
import { Rng } from "@/sim/rng.ts";
import { developmentRoll, roundBy } from "@/state/coachEffects.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import { openTrainingCamp, runTrainingCamp } from "@/state/trainingCamp.ts";

/**
 * The probabilistic rounding in camp must not take its roll from anything shared.
 * Each player's aging draws come from his own stream (season and id); the coach and
 * focus rolls are two more streams of his own (`developmentRoll`). So a player's camp
 * is a function of himself, his staff and the season, and nobody else's.
 */
const base = createLeague(9, { ...DEFAULT_CONFIG, fantasyDraft: false });
const copy = (): LeagueState => JSON.parse(JSON.stringify(base)) as LeagueState;

function staff(s: LeagueState, dev: number, hc: number, onlyTeam?: string): void {
  const codes = Object.keys(s.teams);
  const byRole: Record<string, LeagueState["coaches"][string][]> = {};
  for (const c of Object.values(s.coaches)) if ((DEVELOPMENT_ROLES as readonly string[]).includes(c.role)) (byRole[c.role] ??= []).push(c);
  for (const list of Object.values(byRole)) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    list.forEach((c, i) => {
      if (i < codes.length) c.team = codes[i]!;
      if (!onlyTeam || c.team === onlyTeam) c.overall = dev;
    });
  }
  for (const c of Object.values(s.coaches)) if (c.role === "HC" && c.team && (!onlyTeam || c.team === onlyTeam)) { c.gameManagement = hc; c.discipline = hc; }
}
const camp = (s: LeagueState, order?: string[], focus: "none" | "ol-db" = "none"): Record<string, number> => {
  s.trainingCamp = null;
  const before = Object.fromEntries(Object.values(s.players).map((p) => [p.id, p.overall]));
  for (const t of order ?? Object.keys(s.teams)) {
    runTrainingCamp(s, t, { offensiveFocus: focus === "ol-db" ? "OL" : null, defensiveFocus: focus === "ol-db" ? "DB" : null, submitted: true });
  }
  return Object.fromEntries(Object.values(s.players).filter((p) => p.nfl_team !== "FA").map((p) => [p.id, p.overall - before[p.id]!]));
};
const onTeam = (s: LeagueState, team: string): string[] => Object.values(s.players).filter((p) => p.nfl_team === team).map((p) => p.id);

describe("training camp randomness is per player", () => {
  it("repeats exactly with the same state, with and without focus", () => {
    const a = copy(), b = copy();
    staff(a, 88, 80); staff(b, 88, 80);
    expect(camp(b, undefined, "ol-db")).toEqual(camp(a, undefined, "ol-db"));
    const c = copy(), d = copy();
    staff(c, 88, 80); staff(d, 88, 80);
    expect(camp(d)).toEqual(camp(c));
  });

  it("does not depend on the order teams run, or on how the players are stored", () => {
    const a = copy(), b = copy();
    staff(a, 90, 85); staff(b, 90, 85);
    b.players = Object.fromEntries(Object.entries(b.players).reverse());
    const reversedTeams = Object.keys(b.teams).reverse();
    expect(camp(b, reversedTeams, "ol-db")).toEqual(camp(a, undefined, "ol-db"));
  });

  it("changing one team's staff changes only that team's players", () => {
    const a = copy(), b = copy();
    staff(a, 72, 72);
    staff(b, 72, 72);
    staff(b, 99, 99, "KC");
    const da = camp(a, undefined, "ol-db"), db = camp(b, undefined, "ol-db");
    const kc = new Set(onTeam(a, "KC"));
    let changed = 0;
    for (const id of Object.keys(da)) {
      if (kc.has(id)) { if (da[id] !== db[id]) changed++; } else expect(db[id], id).toBe(da[id]);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("neutral staffs leave the aging model's own draws untouched: the camp equals the same camp with the rolls removed", () => {
    // at a neutral multiplier every scaled value is a whole number, so no roll can move it
    const a = copy(), b = copy();
    staff(a, 72, 72); staff(b, 72, 72);
    for (const c of Object.values(b.coaches)) if ((DEVELOPMENT_ROLES as readonly string[]).includes(c.role)) c.team = null;
    expect(camp(a)).toEqual(camp(b));
  });

  it("runs the stage opening (the path the local store and the online server both use) identically from a fresh state and a reloaded one", () => {
    const a = copy();
    staff(a, 85, 78);
    const b = JSON.parse(JSON.stringify(a)) as LeagueState;
    for (const x of [a, b]) { x.trainingCamp = null; openTrainingCamp(x, new Set()); }
    const ratings = (x: LeagueState): Record<string, number> => Object.fromEntries(Object.values(x.players).map((p) => [p.id, p.overall]));
    expect(ratings(b)).toEqual(ratings(a));
    expect(b.trainingCamp?.results).toEqual(a.trainingCamp?.results);
  });
});

describe("the rolls themselves", () => {
  it("are fixed by season, player and adjustment alone, in [0, 1)", () => {
    expect(developmentRoll(2030, "p_1", "coach")).toBe(developmentRoll(2030, "p_1", "coach"));
    expect(developmentRoll(2030, "p_1", "coach")).not.toBe(developmentRoll(2030, "p_1", "focus"));
    expect(developmentRoll(2030, "p_1", "coach")).not.toBe(developmentRoll(2031, "p_1", "coach"));
    expect(developmentRoll(2030, "p_1", "coach")).not.toBe(developmentRoll(2030, "p_2", "coach"));
    for (let i = 0; i < 500; i++) {
      const r = developmentRoll(2030, `p_${i}`, "coach");
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
  it("are uniform enough that rounding keeps its expected value across a roster", () => {
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += roundBy(1.3, developmentRoll(2030, `p_${i}`, "coach"));
    expect(sum / 4000).toBeCloseTo(1.3, 1);
  });
  it("negative control: a roll taken from one shared stream does depend on iteration order", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p_${i}`);
    const sharedRolls = (order: string[]): Record<string, number> => {
      const rng = new Rng(1234);
      return Object.fromEntries(order.map((id) => [id, rng.random()]));
    };
    expect(sharedRolls([...ids].reverse())).not.toEqual(sharedRolls(ids));
    const own = (order: string[]): Record<string, number> => Object.fromEntries(order.map((id) => [id, developmentRoll(2030, id, "coach")]));
    expect(own([...ids].reverse())).toEqual(own(ids));
  });
});
