import { describe, expect, it } from "vitest";

import { loadPlayerPool } from "../src/data/players.js";
import {
  cleanPlan,
  DEFAULT_PLAN,
  type DecisionRecord,
  FIELD_GOAL_LIMIT,
  fourthDelta,
  fourthSane,
  type GamePlan,
  kickoffEffect,
  nonsense,
  qbRunEffect,
  returnEffect,
  rookieDevelopment,
  twoPointChart,
  twoPointProb,
} from "../src/engine/gameplan.js";
import { Roster, roster, withRookiePlaytime } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { qbMobilityZ } from "../src/engine/synergy.js";
import type { Player } from "../src/schema/player.js";

const plan = (p: Partial<GamePlan>): GamePlan => cleanPlan(p);

describe("the new dials are clamped and default to the engine as it was", () => {
  it("fills in every new dial at zero and clamps wild ones", () => {
    const p = cleanPlan({ qbRun: 900, twoPoint: -900, fourthShort: Number.NaN as never, kickoff: 101, returns: -101, rookies: 55.4 });
    expect(p.qbRun).toBe(100);
    expect(p.twoPoint).toBe(-100);
    expect(p.fourthShort).toBe(0);
    expect(p.kickoff).toBe(100);
    expect(p.returns).toBe(-100);
    expect(p.rookies).toBe(55);
    // an old saved plan, with none of them, is the standard plan on them
    const old = cleanPlan({ passRate: 3 });
    for (const k of ["qbRun", "twoPoint", "fourthShort", "fourthLong", "kickoff", "returns", "rookies"] as const) expect(old[k]).toBe(DEFAULT_PLAN[k]);
  });
});

describe("fourth and short, fourth and long", () => {
  it("add to the zone dial by distance, and only where they apply", () => {
    const p = plan({ fourthShort: 100, fourthLong: -100 });
    expect(fourthDelta(p, 40, 1)).toBeGreaterThan(fourthDelta(p, 40, 3));
    expect(fourthDelta(p, 40, 6)).toBe(0); // neither
    expect(fourthDelta(p, 40, 10)).toBeLessThan(0);
    // without a distance, the zone dials alone (the old signature)
    expect(fourthDelta(p, 40)).toBe(0);
  });
});

describe("the guards", () => {
  const late = { qtr: 4, gsr: 300, diff: -4 };
  const mid = { qtr: 2, gsr: 1500, diff: 0 };
  it("never push a team into going for it from where nobody would", () => {
    expect(fourthSane(1.8, { ydstogo: 17, yardline100: 60, ...mid })).toBe(0);
    expect(fourthSane(1.8, { ydstogo: 12, yardline100: 70, ...mid })).toBe(0);
    expect(fourthSane(1.8, { ydstogo: 2, yardline100: 85, ...mid })).toBe(0); // inside its own 15
    expect(fourthSane(1.8, { ydstogo: 6, yardline100: 72, ...mid })).toBe(0); // own 28, six to go
    expect(fourthSane(1.8, { ydstogo: 2, yardline100: 40, ...mid })).toBe(1.8);
  });
  it("never punt a team that is behind late and has to score", () => {
    expect(fourthSane(-1.8, { ydstogo: 5, yardline100: 45, ...late })).toBe(0);
    expect(fourthSane(-1.8, { ydstogo: 5, yardline100: 45, ...mid })).toBe(-1.8);
    expect(fourthSane(-1.8, { ydstogo: 5, yardline100: 45, qtr: 4, gsr: 300, diff: 7 })).toBe(-1.8); // ahead: punt away
  });
  it("two-point tries follow the chart, never a runaway lead, and the clock in the end", () => {
    const aggressive = plan({ twoPoint: 100 });
    const timid = plan({ twoPoint: -100 });
    expect(twoPointProb(null, { diff: -2, qtr: 4, gsr: 200 })).toBe(0); // the standard plan kicks
    expect(twoPointProb(plan({}), { diff: -2, qtr: 4, gsr: 200 })).toBe(0);
    expect(twoPointChart(-2, 4, 200)).toBe(true);
    expect(twoPointChart(-2, 1, 3000)).toBe(false);
    // never with a big lead, at any setting
    expect(twoPointProb(aggressive, { diff: 18, qtr: 4, gsr: 500 })).toBe(0);
    // trailing by two late, even the timid go
    expect(twoPointProb(timid, { diff: -2, qtr: 4, gsr: 400 })).toBe(1);
    expect(twoPointProb(timid, { diff: -5, qtr: 4, gsr: 400 })).toBe(0);
    // the last two minutes belong to the chart
    expect(twoPointProb(aggressive, { diff: 3, qtr: 4, gsr: 100 })).toBe(0);
    expect(twoPointProb(aggressive, { diff: -2, qtr: 4, gsr: 100 })).toBe(1);
    // aggressive in the first quarter is only a little, and only close
    expect(twoPointProb(aggressive, { diff: 0, qtr: 1, gsr: 3300 })).toBeLessThan(0.35);
    expect(twoPointProb(aggressive, { diff: 14, qtr: 1, gsr: 3300 })).toBe(0);
  });
  it("the judge calls out the decisions no coach would make", () => {
    const fourth = (o: Partial<Extract<DecisionRecord, { kind: "fourth" }>>): DecisionRecord => ({ kind: "fourth", act: "GO", ydstogo: 3, yardline100: 40, qtr: 2, gsr: 1500, diff: 0, ...o });
    expect(nonsense(fourth({}))).toBeNull();
    expect(nonsense(fourth({ ydstogo: 17 }))).not.toBeNull();
    expect(nonsense(fourth({ ydstogo: 17, qtr: 4, gsr: 200, diff: -7 }))).toBeNull(); // desperate is not nonsense
    expect(nonsense(fourth({ act: "FG", yardline100: 50 }))).not.toBeNull(); // 68 yards
    expect(nonsense(fourth({ act: "FG", yardline100: 40 }))).toBeNull();
    expect(nonsense({ kind: "two", go: false, diff: -2, qtr: 4, gsr: 60 })).not.toBeNull();
    expect(nonsense({ kind: "two", go: true, diff: 21, qtr: 4, gsr: 600 })).not.toBeNull();
    expect(nonsense({ kind: "fair_catch", qtr: 4, gsr: 90, diff: -3 })).not.toBeNull();
    expect(FIELD_GOAL_LIMIT).toBe(62);
  });
});

describe("what each dial is worth, and to whom", () => {
  it("quarterback runs pay a mobile quarterback and cost an immobile one", () => {
    const run = plan({ qbRun: 100 });
    const lamar = qbRunEffect(run, 1.8);
    const cousins = qbRunEffect(run, -1.6);
    expect(lamar.scrambleYards).toBeGreaterThan(1.2);
    expect(cousins.scrambleYards).toBeLessThan(-2);
    expect(lamar.sack).toBeLessThan(0);
    expect(cousins.sack).toBeGreaterThan(0);
    expect(lamar.keeperYards).toBeGreaterThan(0);
    expect(cousins.keeperYards).toBeLessThan(0);
    // and the pocket is the same trade the other way: the mobile one gives up his escape
    expect(qbRunEffect(plan({ qbRun: -100 }), 1.8).sack).toBeGreaterThan(0);
    expect(qbRunEffect(plan({ qbRun: -100 }), -1.6).sack).toBeLessThan(0);
  });
  it("the kick dials trade touchbacks for pressure, and returns trade safety for danger", () => {
    expect(kickoffEffect(100, 0).touchback).toBeGreaterThan(0);
    expect(kickoffEffect(-100, 0).touchback).toBeLessThan(0);
    // pinning them is better with a leg and worse with a weak one
    expect(kickoffEffect(-100, 1.5).spotShift).toBeLessThan(0);
    expect(kickoffEffect(-100, -2).spotShift).toBeGreaterThan(0);
    // returning everything pays with a dangerous returner and costs with a slow one
    expect(returnEffect(100, 1.5).returnYards).toBeGreaterThan(0);
    expect(returnEffect(100, -1).returnYards).toBeLessThan(0);
    expect(returnEffect(-100, 0).fairCatch).toBeGreaterThan(0);
  });
  it("rookies who play develop; rookies who sit develop less", () => {
    const kid = { years_pro: 0, overall: 70, potential: 82 };
    expect(rookieDevelopment(100, kid)).toBeGreaterThan(0);
    expect(rookieDevelopment(-100, kid)).toBeLessThan(0);
    expect(rookieDevelopment(100, { ...kid, years_pro: 4 })).toBe(0);
    expect(rookieDevelopment(0, kid)).toBe(0);
    // already at his ceiling, there's less to gain
    expect(rookieDevelopment(100, { ...kid, potential: 70 })).toBeLessThan(rookieDevelopment(100, kid));
  });
});

describe("the rookie policy sets who starts, within a margin", () => {
  const mk = (id: string, overall: number, years_pro: number): Player =>
    ({ id, name: id, position: "WR", overall, years_pro, attributes: {} }) as unknown as Player;
  const base = new Roster("TST", [mk("vet1", 80, 5), mk("vet2", 76, 4), mk("kid", 72, 0), mk("kid2", 60, 0)]);
  it("moves a close rookie ahead of a veteran and never a distant one", () => {
    const up = withRookiePlaytime(base, 100).depth.get("WR")!.map((p) => p.id);
    // the kid (72) is within 4 of vet2 (76) and passes him, but not vet1 (80, 8 better)
    expect(up).toEqual(["vet1", "kid", "vet2", "kid2"]);
    const half = withRookiePlaytime(base, 40).depth.get("WR")!.map((p) => p.id); // margin 2.8
    expect(half).toEqual(["vet1", "vet2", "kid", "kid2"]);
  });
  it("sits a rookie behind a near-equal veteran with a negative dial", () => {
    const roster2 = new Roster("TST", [mk("kid", 78, 0), mk("vet", 75, 6), mk("vet2", 60, 6)]);
    expect(withRookiePlaytime(roster2, -100).depth.get("WR")!.map((p) => p.id)).toEqual(["vet", "kid", "vet2"]);
    // a rookie who is much better stays on top
    const star = new Roster("TST", [mk("kid", 90, 0), mk("vet", 75, 6)]);
    expect(withRookiePlaytime(star, -100).depth.get("WR")![0]!.id).toBe("kid");
  });
  it("leaves the standard roster alone", () => {
    expect(withRookiePlaytime(base, 0)).toBe(base);
  });
});

// ---- playing the games ---------------------------------------------------------

const pool = loadPlayerPool();
const find = (name: string): Player => pool.find((p) => p.name === name && p.position === "QB")!;

/** A team's roster with one named quarterback in the lineup and nobody else changed. */
function withQuarterback(team: string, qb: Player): Roster {
  const players = [...roster(team).depth.values()].flat().filter((p) => p.position !== "QB");
  return new Roster(team, [...players, { ...qb, nfl_team: team }]);
}

function avgMargin(home: Roster, away: Roster, homePlan: Partial<GamePlan>, n: number, salt = 0): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const g = simulateGame(9000 + salt * 100000 + i, home.team, away.team, {
      homeRoster: home,
      awayRoster: away,
      homePlan: plan(homePlan),
      talentScale: 1.5,
    });
    sum += g.score[0] - g.score[1];
  }
  return sum / n;
}

describe("quarterback runs in the engine", () => {
  const lamar = find("Lamar Jackson");
  const cousins = find("Kirk Cousins");
  it("have the pool's athletes where the story says they are", () => {
    expect(qbMobilityZ(lamar)).toBeGreaterThan(1.4);
    expect(qbMobilityZ(cousins)).toBeLessThan(-1);
  });
  it("help the quarterback with legs and hurt the one without", () => {
    const opp = roster("KC");
    const n = 600;
    const gain = (qb: Player) => {
      const me = withQuarterback("DET", qb);
      return avgMargin(me, opp, { qbRun: 100 }, n) - avgMargin(me, opp, {}, n);
    };
    const mobile = gain(lamar);
    const stuck = gain(cousins);
    expect(mobile).toBeGreaterThan(stuck + 1.5);
    expect(mobile).toBeGreaterThan(0);
    expect(stuck).toBeLessThan(0);
  }, 300000);
});

// ---- the sanity sweep ------------------------------------------------------------

const EXTREMES: [string, Partial<GamePlan>][] = [
  ["all in", { passRate: 15, fourthRedZone: 100, fourthOpp: 100, fourthOwn: 100, fourthShort: 100, fourthLong: 100, qbRun: 100, twoPoint: 100, kickoff: 100, returns: 100, rookies: 100, blitz: 100 }],
  ["all timid", { passRate: -15, fourthRedZone: -100, fourthOpp: -100, fourthOwn: -100, fourthShort: -100, fourthLong: -100, qbRun: -100, twoPoint: -100, kickoff: -100, returns: -100, rookies: -100, blitz: -100 }],
  ["go everywhere, kick never", { fourthRedZone: 100, fourthOpp: 100, fourthOwn: 100, fourthShort: 100, fourthLong: 100, twoPoint: 100 }],
  ["never go, fair catch always", { fourthRedZone: -100, fourthOpp: -100, fourthOwn: -100, fourthShort: -100, fourthLong: -100, returns: -100, twoPoint: -100 }],
];

describe("no lever can make a catastrophic decision", () => {
  const teams = ["BUF", "DET", "KC", "BAL", "SF", "CLE", "NE", "LV"];
  for (const [name, p] of EXTREMES) {
    it(`${name}: every fourth down, two-point try and fair catch passes the judge`, () => {
      const audit: DecisionRecord[] = [];
      let decisions = 0;
      const bad: string[] = [];
      let points = 0;
      let games = 0;
      for (let i = 0; i < teams.length; i++) {
        for (let k = 0; k < 6; k++) {
          const a = teams[i]!;
          const b = teams[(i + 1 + k) % teams.length]!;
          const g = simulateGame(700 + i * 31 + k, a, b, { homePlan: plan(p), awayPlan: plan(p), audit, talentScale: 1.5, mustDecide: true });
          points += g.score[0] + g.score[1];
          games++;
        }
      }
      for (const d of audit) {
        decisions++;
        const why = nonsense(d);
        if (why) bad.push(why);
      }
      expect(decisions).toBeGreaterThan(200);
      expect(bad).toEqual([]);
      // and the games are still football: a normal amount of scoring
      expect(points / games).toBeGreaterThan(24);
      expect(points / games).toBeLessThan(75);
    }, 300000);
  }
});

describe("the new dials move the engine the way they say", () => {
  const rates = (p: Partial<GamePlan>, n = 60) => {
    const audit: DecisionRecord[] = [];
    let two = 0;
    let td = 0;
    for (let i = 0; i < n; i++) {
      const g = simulateGame(4100 + i, "DAL", "PHI", { homePlan: plan(p), awayPlan: plan(p), audit, talentScale: 1.5 });
      for (const t of g.teams) {
        two += t.s["two_att"] ?? 0;
        td += t.s["td"] ?? 0;
      }
    }
    const fourths = audit.filter((d): d is Extract<DecisionRecord, { kind: "fourth" }> => d.kind === "fourth");
    const goRate = (f: (d: (typeof fourths)[number]) => boolean) => {
      const s = fourths.filter(f);
      return s.length ? s.filter((d) => d.act === "GO").length / s.length : 0;
    };
    return { two, td, short: goRate((d) => d.ydstogo <= 2), long: goRate((d) => d.ydstogo >= 8), fourths: fourths.length };
  };
  it("fourth-and-short and fourth-and-long move the go rate at their own distances", () => {
    const base = rates({ fourthOpp: 1 });
    const short = rates({ fourthShort: 100 });
    const long = rates({ fourthLong: 100 });
    expect(short.short).toBeGreaterThan(base.short + 0.1);
    expect(long.long).toBeGreaterThanOrEqual(base.long);
    const noShort = rates({ fourthShort: -100 });
    expect(noShort.short).toBeLessThan(base.short);
  }, 300000);
  it("two-point tries rise with the dial and the standard plan never attempts one", () => {
    const base = rates({ fourthOpp: 1 });
    const keen = rates({ twoPoint: 100 });
    expect(base.two).toBe(0);
    expect(keen.two).toBeGreaterThan(0);
    expect(keen.two).toBeLessThan(keen.td * 0.6);
  }, 300000);
});

describe("kickoffs, returns and rookies in the games", () => {
  /** how the receiving side's drives started and how many return touchdowns there were, over a spread of games */
  const specials = (kickPlan: Partial<GamePlan>, retPlan: Partial<GamePlan>, n = 150) => {
    let start = 0;
    let drives = 0;
    let returnTds = 0;
    for (let i = 0; i < n; i++) {
      const g = simulateGame(6100 + i, "DAL", "PHI", { homePlan: plan(kickPlan), awayPlan: plan(retPlan), talentScale: 1.5 });
      // drives of the away team (the receiver) that began with a kickoff are all we can see: use every away drive
      for (const d of g.drivesLog) if (d.team === 1) { start += 100 - d.startYl; drives++; }
      returnTds += (g.teams[1].s["kr_td"] ?? 0) + (g.teams[1].s["pr_td"] ?? 0);
    }
    return { start: start / drives, returnTds };
  };
  it("a team that fair catches takes the big play off the table", () => {
    const base = specials({ kickoff: 1 }, { returns: 1 }, 300);
    const cautious = specials({}, { returns: -100 }, 300);
    expect(cautious.returnTds).toBeLessThan(base.returnTds);
  }, 300000);
  it("a team that brings everything back gets more touchdowns and a different start", () => {
    const base = specials({ kickoff: 1 }, { returns: 1 });
    const bold = specials({}, { returns: 100 });
    expect(bold.returnTds).toBeGreaterThanOrEqual(base.returnTds);
    expect(Math.abs(bold.start - base.start)).toBeGreaterThan(0.05);
  }, 300000);
  it("pinning them short changes the receiver's field position from kicking deep", () => {
    const deep = specials({ kickoff: 100 }, { returns: 1 });
    const pin = specials({ kickoff: -100 }, { returns: 1 });
    expect(Math.abs(deep.start - pin.start)).toBeGreaterThan(0.1);
  }, 300000);
  it("rookie playing time changes who starts in a real game (and the result shifts a little)", () => {
    const me = roster("CLE");
    const rookies = [...me.depth.values()].flat().filter((p) => p.years_pro === 0).length;
    expect(rookies).toBeGreaterThan(0);
    const played = withRookiePlaytime(me, 100);
    const start = (r: Roster) => [...r.depth.values()].map((l) => l[0]?.id).join(",");
    expect(start(played)).not.toBe(start(me));
  });
});
