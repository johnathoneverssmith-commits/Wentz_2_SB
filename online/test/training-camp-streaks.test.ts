import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { redactTrainingCamp } from "../src/campView.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import {
  beginTrainingCamp,
  focusGroupValue,
  focusStreak,
  openTrainingCamp,
  REPEAT_DECAY,
  runCpuTrainingCamps,
  runTrainingCamp,
  type OffensiveFocus,
  type DefensiveFocus,
} from "@/state/trainingCamp.ts";
import { DEVELOPMENT_ROLES, COACH_POSITION_GROUPS } from "@/domain";

/**
 * PD-3: repeating a camp focus pays 20% less each consecutive time. The repeat history lives inside the camp state
 * and is carried over when the next season's camp opens; it belongs to the team, not to whoever is its GM.
 */
const base = createLeague(9, { ...DEFAULT_CONFIG, fantasyDraft: false });
const copy = (): LeagueState => JSON.parse(JSON.stringify(base)) as LeagueState;
const teams = (s: LeagueState): string[] => Object.keys(s.teams);

function staffed(s: LeagueState): void {
  const codes = teams(s);
  const byRole: Record<string, LeagueState["coaches"][string][]> = {};
  for (const c of Object.values(s.coaches)) if ((DEVELOPMENT_ROLES as readonly string[]).includes(c.role)) (byRole[c.role] ??= []).push(c);
  for (const list of Object.values(byRole)) list.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((c, i) => { if (i < codes.length) c.team = codes[i]!; c.overall = 72; });
  for (const c of Object.values(s.coaches)) {
    if (c.role === "HC" && c.team) { c.gameManagement = 72; c.discipline = 72; }
    if ((c.role === "OC" || c.role === "DC") && c.team) c.playCallIq = 72;
  }
}
const fresh = (): LeagueState => { const s = copy(); staffed(s); return s; };
const run = (s: LeagueState, o: OffensiveFocus, d: DefensiveFocus): void => {
  for (const t of teams(s)) runTrainingCamp(s, t, { offensiveFocus: o, defensiveFocus: d, submitted: true });
};
/** A season goes by: everyone a year older, the next camp opens. */
function nextSeason(s: LeagueState, years = 1): void {
  s.season += years;
  for (const p of Object.values(s.players)) if (!p.retired) p.age += years;
  beginTrainingCamp(s);
}
const groupGain = (s: LeagueState, before: Record<string, number>, group: string): number =>
  Object.values(s.players).filter((p) => p.nfl_team !== "FA" && (COACH_POSITION_GROUPS as Record<string, readonly string[]>)[group]!.includes(p.position)).reduce((a, p) => a + (p.overall - (before[p.id] ?? p.overall)), 0);
const ratings = (s: LeagueState): Record<string, number> => Object.fromEntries(Object.values(s.players).map((p) => [p.id, p.overall]));

describe("repeat streaks", () => {
  it("count consecutive repeats of each side independently", () => {
    const s = fresh();
    s.trainingCamp = null;
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    expect(s.trainingCamp!.plans.KC).toMatchObject({ offensiveStreak: 0, defensiveStreak: 0 });
    nextSeason(s);
    for (const t of teams(s)) runTrainingCamp(s, t, { offensiveFocus: "OL", defensiveFocus: "DL", submitted: true });
    expect(s.trainingCamp!.plans.KC).toMatchObject({ offensiveStreak: 1, defensiveStreak: 0 });
    nextSeason(s);
    for (const t of teams(s)) runTrainingCamp(s, t, { offensiveFocus: "OL", defensiveFocus: "DL", submitted: true });
    expect(s.trainingCamp!.plans.KC).toMatchObject({ offensiveStreak: 2, defensiveStreak: 1 });
  });

  it("start over when a team switches, and again after a switch back", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    nextSeason(s);
    run(s, "QB", "DB");
    expect(s.trainingCamp!.plans.KC).toMatchObject({ offensiveStreak: 0, defensiveStreak: 1 });
    nextSeason(s);
    run(s, "OL", "DB");
    expect(s.trainingCamp!.plans.KC).toMatchObject({ offensiveStreak: 0, defensiveStreak: 2 });
  });

  it("start over after a skipped season, and with no camp history at all", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    nextSeason(s, 2); // no camp in between
    expect(s.trainingCamp!.prior).toBeUndefined();
    run(s, "OL", "DB");
    expect(s.trainingCamp!.plans.KC).toMatchObject({ offensiveStreak: 0, defensiveStreak: 0 });
    // a team that did not run last year starts over even if the others carry on
    const t = fresh();
    beginTrainingCamp(t);
    for (const code of teams(t).filter((c) => c !== "KC")) runTrainingCamp(t, code, { offensiveFocus: "OL", defensiveFocus: "DB", submitted: true });
    nextSeason(t);
    expect(focusStreak(t, "KC", "offense", "OL")).toBe(0);
    expect(focusStreak(t, "BUF", "offense", "OL")).toBe(1);
  });

  it("read as zero in a save from before streaks were kept, and in one before the camp had a season", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    for (const plan of Object.values(s.trainingCamp!.plans)) { delete plan.offensiveStreak; delete plan.defensiveStreak; }
    nextSeason(s);
    expect(focusStreak(s, "KC", "offense", "OL")).toBe(1); // the old plan counts as streak 0, this is its first repeat
    const old = fresh();
    old.trainingCamp = { plans: { KC: { offensiveFocus: "OL", defensiveFocus: "DB", submitted: true } }, results: {} } as unknown as LeagueState["trainingCamp"]; // no season key
    old.season += 1;
    beginTrainingCamp(old);
    expect(old.trainingCamp!.prior).toBeUndefined();
    expect(focusStreak(old, "KC", "offense", "OL")).toBe(0);
  });

  it("belong to the team: a new GM in the seat inherits the history", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    nextSeason(s);
    const gm = s.gms.find((g) => g.teamCode === "KC") ?? s.gms[0]!;
    const before = focusStreak(s, "KC", "offense", "OL");
    gm.id = "gm_someone_new"; // the seat changes hands
    expect(focusStreak(s, "KC", "offense", "OL")).toBe(before);
    expect(before).toBe(1);
  });

  it("survive save and reload, and a retry of the same plan gives the same camp", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    nextSeason(s);
    const r = JSON.parse(JSON.stringify(s)) as LeagueState;
    run(s, "OL", "DB");
    run(r, "OL", "DB");
    expect(ratings(r)).toEqual(ratings(s));
    expect(r.trainingCamp!.plans.KC).toEqual(s.trainingCamp!.plans.KC);
    const again = JSON.parse(JSON.stringify(r)) as LeagueState;
    again.trainingCamp = { ...again.trainingCamp!, plans: {}, results: {} }; // the camp is rerun from the same prior
    expect(focusStreak(again, "KC", "offense", "OL")).toBe(focusStreak(s, "KC", "offense", "OL"));
  });

  it("make a repeated focus pay less than the same focus a first time (and still something)", () => {
    // one league, one year on: the same ratings run once with last year's OL+DB on record and once with no record
    const repeat = fresh();
    beginTrainingCamp(repeat);
    run(repeat, "OL", "DB");
    nextSeason(repeat);
    const start = ratings(repeat);
    const first = JSON.parse(JSON.stringify(repeat)) as LeagueState;
    delete first.trainingCamp!.prior;
    run(repeat, "OL", "DB");
    run(first, "OL", "DB");
    const gain = (x: LeagueState): number => groupGain(x, start, "OL") + groupGain(x, start, "DB");
    expect(gain(repeat)).toBeLessThan(gain(first));
    expect(gain(repeat)).toBeGreaterThan(gain(first) * 0.4);
    expect(REPEAT_DECAY).toBe(0.8);
  });
});

describe("online view", () => {
  it("shows a GM only their own team's plan, results and repeat history", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    nextSeason(s);
    run(s, "OL", "DB");
    const view = redactTrainingCamp(s.trainingCamp!, "KC");
    expect(Object.keys(view.plans)).toEqual(["KC"]);
    expect(Object.keys(view.results)).toEqual(["KC"]);
    expect(Object.keys(view.prior ?? {})).toEqual(["KC"]);
    expect(JSON.stringify(view)).not.toContain('"BUF"');
  });
  it("shows a commissioner or an unseated viewer no prior choices at all, and never mutates the league's camp", () => {
    const s = fresh();
    beginTrainingCamp(s);
    run(s, "OL", "DB");
    nextSeason(s);
    const before = JSON.stringify(s.trainingCamp);
    const view = redactTrainingCamp(s.trainingCamp!, undefined);
    expect(view.prior).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("KC");
    expect(JSON.stringify(s.trainingCamp)).toBe(before);
  });
});

describe("the CPU focus rule", () => {
  const cpuRepeats = (withHistory: boolean): number => {
    const s = fresh();
    s.trainingCamp = null;
    openTrainingCamp(s, new Set());
    const first = Object.fromEntries(teams(s).map((t) => [t, s.trainingCamp!.plans[t]!]));
    for (const p of Object.values(s.players)) if (!p.retired) p.age += 1;
    s.season += 1;
    beginTrainingCamp(s);
    if (!withHistory) delete s.trainingCamp!.prior;
    runCpuTrainingCamps(s, new Set());
    return teams(s).filter((t) => s.trainingCamp!.plans[t]!.offensiveFocus === first[t]!.offensiveFocus && s.trainingCamp!.plans[t]!.defensiveFocus === first[t]!.defensiveFocus).length;
  };
  it("is deterministic and independent of team order", () => {
    const run1 = (reverse: boolean): string => {
      const s = fresh();
      s.trainingCamp = null;
      beginTrainingCamp(s);
      if (reverse) s.teams = Object.fromEntries(Object.entries(s.teams).reverse());
      runCpuTrainingCamps(s, new Set());
      return JSON.stringify(Object.fromEntries(teams(s).sort().map((t) => [t, [s.trainingCamp!.plans[t]!.offensiveFocus, s.trainingCamp!.plans[t]!.defensiveFocus]])));
    };
    expect(run1(true)).toBe(run1(false));
    expect(run1(false)).toBe(run1(false));
  });
  it("values only players it can develop: a group with no starters is worth nothing, a young starter more than a prime one", () => {
    const s = fresh();
    const kc = Object.values(s.players).filter((p) => p.nfl_team === "KC");
    for (const p of kc.filter((p) => p.position === "RB")) p.nfl_team = "FA";
    expect(focusGroupValue(s, "KC", "RB")).toBe(0);
    expect(focusGroupValue(s, "KC", "OL")).toBeGreaterThan(0);
  });
  it("moves off a focus it held before more often than it would with no history (negative control: history removed)", () => {
    expect(cpuRepeats(true)).toBeLessThan(cpuRepeats(false));
  });
  it("does not pick one group for everybody", () => {
    const s = fresh();
    s.trainingCamp = null;
    openTrainingCamp(s, new Set());
    const off = new Set(teams(s).map((t) => s.trainingCamp!.plans[t]!.offensiveFocus));
    const def = new Set(teams(s).map((t) => s.trainingCamp!.plans[t]!.defensiveFocus));
    expect(off.size).toBeGreaterThanOrEqual(3);
    expect(def.size).toBeGreaterThanOrEqual(2);
  });
});
