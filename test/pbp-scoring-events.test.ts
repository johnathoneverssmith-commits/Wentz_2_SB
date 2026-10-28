import { beforeAll, describe, expect, it } from "vitest";

import { quarterScores, scoringPlaysFrom } from "../server/boxscore-map.js";
import { broadcastGame } from "../src/engine/broadcast.js";
import { extractBoxScore } from "../src/engine/boxscore.js";
import { type Game, type GameEvent, type PlayRec, type ScoreEvent, simulateGame } from "../src/engine/sim.js";

/**
 * PBP-1: the engine writes down who scored, when, and what else happened
 * between traced plays, and the scoring summary, line score and broadcast read
 * that instead of reconstructing it.
 *
 * Before, the summary guessed the quarter and the player of a defensive score
 * from "that team's last turnover", so a first-quarter pick-six could appear
 * in the third quarter, credited to another player, and every running score
 * after it was wrong. The properties below are the ones that were false.
 *
 * Nothing here pins prose: only quarters, clocks, teams, players taken from the
 * trace itself, and scores.
 */
const PAIRS: [string, string][] = [
  ["KC", "BUF"],
  ["SF", "DAL"],
  ["PHI", "NYG"],
  ["GB", "CHI"],
];
const SEEDS = Array.from({ length: 30 }, (_, i) => i * 17 + 1);

interface Played {
  seed: number;
  home: string;
  away: string;
  g: Game;
  where: string;
}
let games: Played[] = [];

beforeAll(() => {
  for (const seed of SEEDS)
    for (const [home, away] of PAIRS) {
      const g = simulateGame(seed, home, away, { trace: true, injuries: true, overtime: "nfl" });
      games.push({ seed, home, away, g, where: `${away}@${home} seed ${seed} (${g.score[0]}-${g.score[1]})` });
    }
}, 120_000);

const SIDE_OF = (rec: PlayRec): 0 | 1 => rec.team as 0 | 1;
const POINTS: Record<ScoreEvent["kind"], number> = {
  touchdown: 6,
  field_goal: 3,
  extra_point: 1,
  two_point: 2,
  safety: 2,
  interception_return_td: 6,
  fumble_return_td: 6,
  punt_return_td: 6,
  kick_return_td: 6,
};

/** Every way the scoring log can contradict the trace or the final score. Empty means consistent. */
export function scoringViolations(g: Game, log: readonly GameEvent[] = g.eventLog ?? []): string[] {
  const out: string[] = [];
  const trace = g.playTrace ?? [];
  const scores = log.filter((e): e is ScoreEvent => e.type === "score");
  const running: [number, number] = [0, 0];
  const prefixes = new Set<string>(["0-0"]);
  let prev: ScoreEvent | undefined;
  scores.forEach((e, n) => {
    const tag = `event ${n} ${e.kind}`;
    if (e.points !== POINTS[e.kind]) out.push(`${tag}: ${e.points} points`);
    running[e.side] += e.points;
    if (e.scoreAfter[0] !== running[0] || e.scoreAfter[1] !== running[1])
      out.push(`${tag}: scoreAfter ${e.scoreAfter} but the running score is ${running}`);
    prefixes.add(`${running[0]}-${running[1]}`);
    const rec = e.playIndex === null ? undefined : trace[e.playIndex];
    if (e.playIndex !== null && !rec) out.push(`${tag}: playIndex ${e.playIndex} is not a traced play`);
    const regulation = e.quarter <= 4;
    if (rec && regulation && (rec.quarter !== e.quarter || rec.clock !== e.clock))
      out.push(`${tag}: stamped Q${e.quarter} ${e.clock}, the play was Q${rec.quarter} ${rec.clock}`);
    switch (e.kind) {
      case "touchdown":
        if (!rec || !rec.touchdown || rec.turnover || SIDE_OF(rec) !== e.side) out.push(`${tag}: not the offence's touchdown play`);
        break;
      case "field_goal":
        if (!rec || rec.call !== "field_goal" || rec.outcome !== "made" || SIDE_OF(rec) !== e.side) out.push(`${tag}: not a made kick by this side`);
        break;
      case "interception_return_td":
        if (!rec || rec.outcome !== "interception" || SIDE_OF(rec) === e.side) out.push(`${tag}: not an interception thrown against this side`);
        else if (e.scorer !== rec.defender) out.push(`${tag}: scorer ${e.scorer} but the interceptor was ${rec.defender}`);
        break;
      case "fumble_return_td":
        if (!rec || rec.outcome !== "fumble" || SIDE_OF(rec) === e.side) out.push(`${tag}: not a fumble lost to this side`);
        else if (e.scorer !== undefined) out.push(`${tag}: a scorer was named; the engine does not know the recoverer`);
        break;
      case "punt_return_td":
        if (!rec || rec.call !== "punt" || rec.outcome !== "return_td" || SIDE_OF(rec) === e.side) out.push(`${tag}: not a punt returned by this side`);
        else if (e.scorer !== rec.returner) out.push(`${tag}: scorer ${e.scorer} but the returner was ${rec.returner}`);
        break;
      case "safety":
        if (!rec || SIDE_OF(rec) === e.side || rec.ballOn - rec.gained < 99) out.push(`${tag}: the play did not end in its own end zone`);
        break;
      case "kick_return_td":
        if (e.playIndex !== null) out.push(`${tag}: a kick return has no scrimmage play`);
        break;
      case "extra_point":
      case "two_point":
        if (!prev || prev.side !== e.side || prev.playIndex !== e.playIndex || prev.points < 6)
          out.push(`${tag}: does not follow a touchdown by the same side`);
        break;
    }
    prev = e;
  });
  if (running[0] !== g.score[0] || running[1] !== g.score[1]) out.push(`events total ${running}, the final score is ${g.score}`);
  // every score the trace ever showed was one the log reached
  trace.forEach((p, j) => {
    if (!prefixes.has(`${p.scoreBefore[0]}-${p.scoreBefore[1]}`)) out.push(`play ${j}: scoreBefore ${p.scoreBefore} is not a score the log passed through`);
  });
  // a defence that scored off an interception must be in the log, and only then
  trace.forEach((p, j) => {
    if (p.outcome !== "interception") return;
    const after = j + 1 < trace.length ? trace[j + 1]!.scoreBefore : [g.score[0], g.score[1]];
    const d = 1 - p.team;
    const scored = after[d]! - p.scoreBefore[d]! >= 6;
    const logged = scores.some((e) => e.kind === "interception_return_td" && e.playIndex === j);
    if (scored !== logged) out.push(`play ${j}: interception ${scored ? "was" : "was not"} returned for a score but the log ${logged ? "has" : "lacks"} it`);
  });
  return out;
}

describe("scoring log", () => {
  it("is consistent with the trace and the final score in every game", () => {
    expect(games.length).toBe(SEEDS.length * PAIRS.length);
    for (const { g, where } of games) expect(scoringViolations(g), where).toEqual([]);
  });

  it("covers the cases the old reconstruction got wrong", () => {
    const kinds = new Set<string>();
    for (const { g } of games) for (const e of g.eventLog!) if (e.type === "score") kinds.add(e.kind);
    // if a refactor stops producing these, the property test above is vacuous for them
    expect([...kinds]).toEqual(expect.arrayContaining(["touchdown", "field_goal", "extra_point", "interception_return_td"]));
  });

  it("is a log and nothing more: tracing changes neither the score nor the drives", () => {
    for (const { seed, home, away, g } of games.slice(0, 24)) {
      // injuries stay on: their hazard draws from the same RNG stream, so that one switch really is a different game
      const plain = simulateGame(seed, home, away, { injuries: true, overtime: "nfl" });
      expect(plain.score, `${home}-${away} ${seed}`).toEqual(g.score);
      expect(plain.drivesLog).toEqual(g.drivesLog);
      expect(extractBoxScore(plain, home, away)).toEqual(extractBoxScore(g, home, away));
    }
  });

  it("is deterministic", () => {
    const [a, b] = [broadcastGame(77, "KC", "BUF"), broadcastGame(77, "KC", "BUF")];
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("scoring summary and line score", () => {
  it("are built from the log: the running score is the engine's, and the quarters add up", () => {
    for (const { home, away, g, where } of games) {
      const final: [number, number] = [g.score[0], g.score[1]];
      const trace = g.playTrace!;
      const rows = scoringPlaysFrom(trace, home, away, final, g.drivesLog, g.eventLog!);
      const qs = quarterScores(trace, final, g.drivesLog, g.eventLog!);
      expect(qs[0]!.reduce((a, b) => a + b, 0), `home line score, ${where}`).toBe(final[0]);
      expect(qs[1]!.reduce((a, b) => a + b, 0), `away line score, ${where}`).toBe(final[1]);
      let prev: [number, number] = [0, 0];
      const byQuarter = [0, 1].map(() => Array.from({ length: qs[0]!.length }, () => 0));
      for (const r of rows) {
        const dh = r.homeScore - prev[0];
        const da = r.awayScore - prev[1];
        expect(dh >= 0 && da >= 0 && dh + da > 0, `row ${r.description} must add points, ${where}`).toBe(true);
        expect(dh === 0 || da === 0, `row ${r.description} scored for both sides, ${where}`).toBe(true);
        expect(r.team, `row ${r.description} credited to the wrong team, ${where}`).toBe(dh > 0 ? home : away);
        byQuarter[0]![r.quarter - 1]! += dh;
        byQuarter[1]![r.quarter - 1]! += da;
        prev = [r.homeScore, r.awayScore];
      }
      expect(prev, `last row is the final score, ${where}`).toEqual(final);
      expect(byQuarter, `rows and line score disagree, ${where}`).toEqual(qs);
      // every score the game actually passed through is a row (extra points fold into their touchdown)
      const steps = new Set(rows.map((r) => `${r.homeScore}-${r.awayScore}`));
      trace.forEach((p, j) => {
        const after = j + 1 < trace.length ? trace[j + 1]!.scoreBefore : final;
        const changed = after[0] !== p.scoreBefore[0] || after[1] !== p.scoreBefore[1];
        if (changed) expect(steps.has(`${after[0]}-${after[1]}`), `missing ${after} after play ${j}, ${where}`).toBe(true);
      });
    }
  });

  it("places and names a defensive touchdown from its own play, not from a later turnover", () => {
    let seen = 0;
    for (const { home, away, g, where } of games) {
      const trace = g.playTrace!;
      const rows = scoringPlaysFrom(trace, home, away, [g.score[0], g.score[1]], g.drivesLog, g.eventLog!);
      for (const e of g.eventLog!) {
        if (e.type !== "score" || e.kind !== "interception_return_td") continue;
        seen++;
        const rec = trace[e.playIndex!]!;
        const row = rows.find((r) => r.description.includes("interception") && r.quarter === rec.quarter && r.team === (e.side === 0 ? home : away));
        expect(row, `pick-six off ${rec.defender} in Q${rec.quarter}, ${where}`).toBeDefined();
        expect(row!.description).toContain(rec.defender!);
      }
    }
    expect(seen, "the sample must contain pick-sixes").toBeGreaterThan(3);
  });

  it("does not consult the drive log when the engine's log is there", () => {
    const { home, away, g } = games.find((x) => x.g.eventLog!.some((e) => e.type === "score" && e.kind === "interception_return_td"))!;
    const final: [number, number] = [g.score[0], g.score[1]];
    const honest = scoringPlaysFrom(g.playTrace!, home, away, final, g.drivesLog, g.eventLog!);
    const scrambled = scoringPlaysFrom(g.playTrace!, home, away, final, [], g.eventLog!);
    expect(scrambled).toEqual(honest);
  });

  it("falls back to the reconstruction, still reconciled, when there is no log", () => {
    const { home, away, g } = games[0]!;
    const final: [number, number] = [g.score[0], g.score[1]];
    const rows = scoringPlaysFrom(g.playTrace!, home, away, final, g.drivesLog);
    expect(rows.at(-1) ? [rows.at(-1)!.homeScore, rows.at(-1)!.awayScore] : [0, 0]).toEqual(final);
  });
});

describe("overtime score clocks", () => {
  it("are the clock at the snap that scored, the same one a field goal gets, not the clock after the play", () => {
    // Pinned on the committed fixture pool. Before the fix a touchdown was stamped
    // after its play's clock had run (8:08, 8:08, 5:23 below) while a field goal
    // was stamped before it; an extra point shares its touchdown's time.
    const at = (seed: number, home: string, away: string): string[] =>
      simulateGame(seed, home, away, { trace: true, injuries: true, overtime: "nfl" })
        .eventLog!.filter((e): e is ScoreEvent => e.type === "score" && e.quarter >= 5 && e.kind === "touchdown")
        .map((e) => e.clock);
    // Re-pinned (seeds and values) when the second-half kickoff stopped being overwritten mid-play (issue #53): that moved every
    // game's random stream after the first half, so the old seeds no longer reach overtime. These are the clocks of the snaps that
    // scored in the new games.
    expect(at(16, "GB", "CHI")).toEqual(["2:37"]);
    expect(at(2, "KC", "BUF")).toEqual(["5:59", "4:48", "4:29"]);
  });

  it("never stamp a scoring snap at 0:00, and give a conversion its touchdown's time", () => {
    for (const { g, where } of games) {
      const ev = g.eventLog!.filter((e): e is ScoreEvent => e.type === "score" && e.quarter >= 5);
      ev.forEach((e, i) => {
        if (e.playIndex !== null) expect(e.clock, `snap clock, ${where}`).not.toBe("0:00");
        if ((e.kind === "extra_point" || e.kind === "two_point") && i > 0) expect(e.clock, where).toBe(ev[i - 1]!.clock);
      });
    }
  });
});

describe("older or incomplete event logs", () => {
  const g0 = () => games.find((x) => x.g.score[0] + x.g.score[1] > 0)!;

  it("an empty or missing log uses the reconstruction, which still reaches the final score", () => {
    const { home, away, g } = g0();
    const final: [number, number] = [g.score[0], g.score[1]];
    for (const log of [undefined, [] as GameEvent[]]) {
      const rows = scoringPlaysFrom(g.playTrace!, home, away, final, g.drivesLog, log);
      expect([rows.at(-1)!.homeScore, rows.at(-1)!.awayScore]).toEqual(final);
      const qs = quarterScores(g.playTrace!, final, g.drivesLog, log);
      expect([qs[0]!.reduce((a, b) => a + b, 0), qs[1]!.reduce((a, b) => a + b, 0)]).toEqual(final);
    }
  });

  it("a log with only non-scoring events, or a truncated one, is not trusted", () => {
    const { home, away, g } = g0();
    const final: [number, number] = [g.score[0], g.score[1]];
    const noScores = g.eventLog!.filter((e) => e.type !== "score");
    const half = g.eventLog!.slice(0, Math.floor(g.eventLog!.length / 2));
    for (const log of [noScores, half]) {
      const rows = scoringPlaysFrom(g.playTrace!, home, away, final, g.drivesLog, log);
      expect([rows.at(-1)!.homeScore, rows.at(-1)!.awayScore]).toEqual(final);
    }
  });

  it("a 0-0 game with an empty log is an empty summary, not an error", () => {
    expect(scoringPlaysFrom([], "KC", "BUF", [0, 0], [], [])).toEqual([]);
  });
});

describe("negative controls: the checker notices a corrupted log", () => {
  const pick = () => games.find((x) => x.g.eventLog!.some((e) => e.type === "score" && e.kind === "interception_return_td"))!.g;
  const clone = (g: Game): GameEvent[] => JSON.parse(JSON.stringify(g.eventLog)) as GameEvent[];

  it("a pick-six moved to another quarter", () => {
    const g = pick();
    const log = clone(g);
    const e = log.find((x): x is ScoreEvent => x.type === "score" && x.kind === "interception_return_td")!;
    e.quarter = e.quarter === 4 ? 1 : e.quarter + 1;
    expect(scoringViolations(g, log).join("\n")).toMatch(/stamped Q/);
  });

  it("a pick-six credited to the wrong player", () => {
    const g = pick();
    const log = clone(g);
    log.find((x): x is ScoreEvent => x.type === "score" && x.kind === "interception_return_td")!.scorer = "Somebody Else";
    expect(scoringViolations(g, log).join("\n")).toMatch(/scorer Somebody Else/);
  });

  it("a dropped score", () => {
    const g = pick();
    const log = clone(g).filter((x) => !(x.type === "score" && x.kind === "interception_return_td"));
    expect(scoringViolations(g, log).length).toBeGreaterThan(0);
  });

  it("an invented score", () => {
    const g = pick();
    const log = clone(g);
    const first = log.findIndex((x) => x.type === "score");
    const fake: ScoreEvent = { type: "score", side: 0, points: 3, kind: "field_goal", quarter: 1, clock: "10:00", playIndex: 0, scoreAfter: [3, 0] };
    log.splice(first, 0, fake);
    expect(scoringViolations(g, log).length).toBeGreaterThan(0);
  });

  it("a wrong running score", () => {
    const g = pick();
    const log = clone(g);
    const e = log.find((x): x is ScoreEvent => x.type === "score")!;
    e.scoreAfter = [e.scoreAfter[0] + 1, e.scoreAfter[1]];
    expect(scoringViolations(g, log).join("\n")).toMatch(/scoreAfter/);
  });

  it("a log that disagrees with the final score is not used for the summary", () => {
    const { home, away, g } = games[0]!;
    const log = clone(g).filter((x) => !(x.type === "score" && x.kind === "field_goal"));
    const rows = scoringPlaysFrom(g.playTrace!, home, away, [g.score[0], g.score[1]], g.drivesLog, log);
    // fell back, so the final score is still reached
    const last = rows.at(-1)!;
    expect([last.homeScore, last.awayScore]).toEqual([g.score[0], g.score[1]]);
  });
});

describe("accepted penalties, spikes and kneels explain the trace's discontinuities", () => {
  it("every jump in field position or down inside a drive is accounted for by a logged event", () => {
    let jumps = 0;
    for (const { seed, home, away, where } of games.slice(0, 40)) {
      const b = broadcastGame(seed, home, away, { overtime: "nfl" });
      for (const d of b.drives)
        for (let i = 1; i < d.plays.length; i++) {
          const x = d.plays[i - 1]!;
          const y = d.plays[i]!;
          const before = y.eventsBefore ?? [];
          const moved = Math.abs(x.ballOn - x.gained - y.ballOn) > 1.01;
          const expectedDown = x.firstDown ? 1 : x.down + 1;
          const downOff = y.down !== expectedDown && !(y.down === 1 && moved);
          if (moved) {
            jumps++;
            const pen = before.filter((e) => e.type === "penalty");
            expect(pen.length, `unexplained jump ${x.ballOn}->${y.ballOn} Q${y.quarter} ${y.clock}, ${where}`).toBeGreaterThan(0);
            const last = pen.at(-1)!;
            if (last.type === "penalty") expect(Math.abs(last.after.yardline100 - y.ballOn), `penalty lands where the next snap is, ${where}`).toBeLessThanOrEqual(1);
          }
          if (downOff) expect(before.length, `unexplained down change, Q${y.quarter} ${y.clock}, ${where}`).toBeGreaterThan(0);
        }
    }
    expect(jumps).toBeGreaterThan(50);
  });

  it("a penalty's recorded yards agree with how the ball moved", () => {
    for (const { g, where } of games.slice(0, 40))
      for (const e of g.eventLog!) {
        if (e.type !== "penalty") continue;
        const moved = e.after.yardline100 - e.before.yardline100;
        // the foul moves the ball toward the guilty side's goal, limited by the goal lines
        if (e.onOffense) expect(moved, `${e.bucket} on offence, ${where}`).toBeGreaterThanOrEqual(0);
        else expect(moved, `${e.bucket} on defence, ${where}`).toBeLessThanOrEqual(0);
        expect(Math.abs(moved), `${e.bucket} ${e.yards}, ${where}`).toBeLessThanOrEqual(e.yards + 1);
      }
  });
});

describe("broadcast", () => {
  it("shows a pick-six as a score, in the play's own record", () => {
    const { seed, home, away } = games.find((x) => x.g.eventLog!.some((e) => e.type === "score" && e.kind === "interception_return_td"))!;
    const b = broadcastGame(seed, home, away, { overtime: "nfl" });
    const plays = b.drives.flatMap((d) => d.plays);
    const pick6 = plays.filter((p) => p.scores?.some((s) => s.kind === "interception_return_td"));
    expect(pick6.length).toBeGreaterThan(0);
    for (const p of pick6) {
      expect(p.outcome).toBe("interception");
      expect(p.desc).toMatch(/returned for a TOUCHDOWN/);
      expect(p.desc).not.toMatch(/— TURNOVER/);
      const s = p.scores!.find((e) => e.kind === "interception_return_td")!;
      expect(s.scorer).toBe(p.defender);
    }
  });

  it("keeps the trace whole, and puts overtime in overtime", () => {
    let otGames = 0;
    for (const { seed, home, away, g, where } of games) {
      const b = broadcastGame(seed, home, away, { overtime: "nfl" });
      const plays = b.drives.flatMap((d) => d.plays);
      expect(plays.length, where).toBe(g.playTrace!.length);
      const ot = g.eventLog!.find((e) => e.type === "overtime_start");
      if (!ot) {
        expect(Math.max(...plays.map((p) => p.quarter)), where).toBeLessThanOrEqual(4);
        continue;
      }
      otGames++;
      const first = ot.type === "overtime_start" ? ot.beforePlayIndex : 0;
      plays.forEach((p, i) => {
        if (i >= first) expect(p.quarter, `play ${i}, ${where}`).toBeGreaterThanOrEqual(5);
        else expect(p.quarter, `play ${i}, ${where}`).toBeLessThanOrEqual(4);
      });
      // overtime is a fresh possession, never glued to the last regulation drive
      const di = b.drives.findIndex((d) => d.plays[0]!.quarter >= 5);
      expect(b.drives[di - 1]!.plays.at(-1)!.quarter, where).toBeLessThanOrEqual(4);
      // and its scoring is in an overtime column
      const qs = quarterScores(g.playTrace!, [g.score[0], g.score[1]], g.drivesLog, g.eventLog!);
      expect(qs[0]!.length, where).toBeGreaterThanOrEqual(5);
    }
    expect(otGames, "the sample must contain overtime games").toBeGreaterThan(0);
  });
});
