import { describe, expect, it } from "vitest";

import { loadPool, roster } from "../src/engine/roster.js";
import { Rng } from "../src/engine/rng.js";
import { Game, simulateGame } from "../src/engine/sim.js";

/**
 * Second-half opening possession (issue #53).
 *
 * `advanceClock` spends a play's clock before the play's result is applied. When that clock used up the second quarter the
 * quarter rolled mid-play: the half kickoff set the second half's possession, and the rest of the play then wrote the old
 * spot and down onto it, or handed the ball back to the team that had it. These tests build the exact situation (a snap whose
 * runoff ends Q2) and read the engine's state right after the play, so they depend on nothing but the engine's own fields.
 */
type G = any;

interface Situation {
  label: string;
  spot: number;
  down: number;
  toGo: number;
  /**
   * seconds left in the quarter (and the half) when the snap happens. Inside the opponent's 40 with six seconds or fewer the
   * engine kicks the end-of-half field goal instead of snapping (a separate, hand-rolled path), so those cases use more.
   */
  seconds: number;
}

const SITUATIONS: Situation[] = [
  { label: "3rd & 8 at the opponent's 34", spot: 34, down: 3, toGo: 8, seconds: 9 },
  { label: "4th & 3 at midfield (punt, go or turnover on downs)", spot: 50, down: 4, toGo: 3, seconds: 2 },
  { label: "4th & 12 at the own 40 (punt)", spot: 60, down: 4, toGo: 12, seconds: 4 },
  { label: "4th & 6 at the opponent's 22 (field goal)", spot: 22, down: 4, toGo: 6, seconds: 12 },
  { label: "1st & 10 at the own 25", spot: 75, down: 1, toGo: 10, seconds: 2 },
  { label: "2nd & goal at the 4 (touchdown possible)", spot: 4, down: 2, toGo: 4, seconds: 9 },
  { label: "3rd & 15 at the own 30 (interception possible)", spot: 70, down: 3, toGo: 15, seconds: 4 },
];

function lastSnapOfTheHalf(seed: number, opener: 0 | 1, offense: 0 | 1, s: Situation): { g: G; viaTd: boolean; kickoffFumble: boolean; foulSpentIt: boolean } {
  const g: G = new Game(new Rng(seed));
  g.receivedOpening = opener;
  g.qtr = 2;
  g.qsr = s.seconds;
  g.hsr = s.seconds;
  g.gsr = 1800 + s.seconds;
  g.pos = offense;
  g.yardline100 = s.spot;
  g.down = s.down;
  g.ydstogo = s.toGo;
  g.startDrive();
  let kickoffFumble = false;
  const original = g.kickoffFumble.bind(g);
  g.kickoffFumble = (...a: unknown[]) => {
    kickoffFumble = true;
    return original(...a);
  };
  // a dead-ball foul before the snap can spend the quarter itself; the half then opens and the snap is played from the kickoff
  // (a different, intended path: the state afterwards is a snap into the new half, not the kickoff itself)
  let foulSpentIt = false;
  const burn = g.burn.bind(g);
  g.burn = (...a: unknown[]) => {
    const q = g.qtr;
    burn(...a);
    if (g.qtr !== q) foulSpentIt = true;
  };
  const krTdBefore = (g.teams[0].s.kr_td ?? 0) + (g.teams[1].s.kr_td ?? 0);
  g.play();
  const viaTd = (g.teams[0].s.kr_td ?? 0) + (g.teams[1].s.kr_td ?? 0) > krTdBefore;
  return { g, viaTd, kickoffFumble, foulSpentIt };
}

describe("the snap that spends the second quarter", () => {
  for (const s of SITUATIONS) {
    it(`${s.label}: the half kickoff stands`, () => {
      const wrong: string[] = [];
      let spent = 0;
      let runsWrong = 0;
      for (let seed = 1; seed <= 250; seed++)
        for (const opener of [0, 1] as const)
          for (const offense of [0, 1] as const) {
            const { g, viaTd, kickoffFumble, foulSpentIt } = lastSnapOfTheHalf(seed, opener, offense, s);
            if (g.qtr !== 3 || foulSpentIt) continue; // the play's own runoff must be what spent the quarter
            spent++;
            const receiver = 1 - opener;
            // a kickoff returned for a touchdown, or fumbled away by the returner, legitimately ends elsewhere
            const exempt = viaTd || kickoffFumble;
            const where = `seed ${seed} opener ${opener} offense ${offense}`;
            const before = wrong.length;
            // the clocks are the new half's
            if (g.qsr !== 900 || g.hsr !== 1800 || g.gsr !== 1800) wrong.push(`${where}: clocks ${g.qsr}/${g.hsr}/${g.gsr}`);
            if (g.toRemaining[0] !== 3 || g.toRemaining[1] !== 3) wrong.push(`${where}: timeouts ${g.toRemaining}`);
            if (exempt) continue;
            if (g.pos !== receiver) wrong.push(`${where}: ball with ${g.pos}, receiver is ${receiver}`);
            if (g.down !== 1 || g.ydstogo !== 10) wrong.push(`${where}: ${g.down} & ${g.ydstogo}`);
            if (g.yardline100 < 45) wrong.push(`${where}: spot ${g.yardline100} is not a kickoff spot`);
            // the open drive is the kickoff's, not a leftover of the play
            if (g.dTeam !== g.pos || g.dStartYl !== g.yardline100) wrong.push(`${where}: drive log says team ${g.dTeam} from ${g.dStartYl}`);
            runsWrong += wrong.length > before ? 1 : 0;
          }
      expect(spent, "the situation must actually spend the quarter often enough to mean something").toBeGreaterThan(300);
      expect(wrong.slice(0, 5), `${runsWrong} of ${spent} second halves opened wrongly`).toEqual([]);
    });
  }

  it("is deterministic: the same seed and situation give the same state", () => {
    const a = lastSnapOfTheHalf(7, 0, 1, SITUATIONS[0]!).g;
    const b = lastSnapOfTheHalf(7, 0, 1, SITUATIONS[0]!).g;
    const pick = (g: G) => JSON.stringify([g.pos, g.down, g.ydstogo, g.yardline100, g.score, g.qtr, g.gsr, g.drivesLog]);
    expect(pick(a)).toBe(pick(b));
  });
});

describe("whole games", () => {
  const teams = [...loadPool().keys()].sort();
  const games = Array.from({ length: 120 }, (_, i) => {
    const h = teams[i % teams.length]!;
    const a = teams[(i * 7 + 3) % teams.length]!;
    if (h === a) return null;
    return simulateGame(9000 + i, h, a, { homeRoster: roster(h), awayRoster: roster(a), trace: true, injuries: true, overtime: "nfl" });
  }).filter((g): g is Game => g !== null);

  it("the first snap of the second half belongs to the half's receiver at a kickoff spot (a foul or a returned-for-a-score kickoff excepted)", () => {
    const bad: string[] = [];
    let checked = 0;
    games.forEach((g, i) => {
      const trace = g.playTrace ?? [];
      const j = trace.findIndex((p) => p.quarter === 3);
      if (j <= 0) return;
      const log = g.eventLog ?? [];
      const foulFirst = log.some((e) => e.type === "penalty" && e.beforePlayIndex === j);
      const krTd = log.some((e) => e.type === "score" && e.kind === "kick_return_td");
      if (foulFirst || krTd) return;
      checked++;
      const p = trace[j]!;
      if (p.team !== 1 - g.receivedOpening) bad.push(`game ${i}: Q3 opens with team ${p.team}`);
      else if (p.down !== 1 || p.ballOn < 45) bad.push(`game ${i}: Q3 opens ${p.down}&${p.ydstogo} at ${p.ballOn}`);
    });
    expect(checked).toBeGreaterThan(60);
    // a kickoff fumbled away by the returner is the one legitimate way for the kicking team to snap first
    expect(bad.length, bad.slice(0, 5).join("; ")).toBeLessThanOrEqual(Math.ceil(checked * 0.02));
  });

  it("the PBP-1 event log still adds up to the final score", () => {
    for (const g of games) {
      const log = (g.eventLog ?? []).filter((e) => e.type === "score");
      const sum: [number, number] = [0, 0];
      for (const e of log) if (e.type === "score") sum[e.side] += e.points;
      expect(sum, "scoring events sum to the final score").toEqual([g.score[0], g.score[1]]);
      const last = log[log.length - 1];
      if (last && last.type === "score") expect(last.scoreAfter).toEqual([g.score[0], g.score[1]]);
    }
  });
});
