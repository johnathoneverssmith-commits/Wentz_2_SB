import { beforeAll, describe, expect, it } from "vitest";

import { type GameBroadcast, broadcastGame } from "../src/engine/broadcast.js";
import {
  type GameAnalysis,
  type GameCast,
  type GameDrive,
  type GamePlay,
  type Highlight,
  type ScoreLike,
  analyzeGame,
  highlightText,
  leadStory,
  timelineFromCast,
} from "../src/engine/highlights.js";

/**
 * PBP-3: highlights and drive summaries.
 *
 * Two kinds of test. Hand-built games, where every lead change, deficit and
 * ranking has an exact expected answer worked out on paper; and a sample of
 * simulated games, checked against facts that do not depend on how the code
 * derives them (the final score, the drive totals, the trace itself).
 */

// ------------------------------------------------------------------ fixtures

interface PlaySpec extends Partial<GamePlay> {
  /** scores this play causes, in order; the extra point is its own entry */
  score?: { side: 0 | 1; points: number; kind: string; scorer?: string }[];
}
interface DriveSpec {
  side: "home" | "away";
  plays: PlaySpec[];
  ended?: GameDrive["ended"];
}

/** A game from drive specs: the running score and every score event are filled in, as the engine would write them. */
function cast(drives: DriveSpec[], opts: { home?: string; away?: string; returnScores?: Omit<ScoreLike, "scoreAfter">[]; legacy?: boolean } = {}): GameCast {
  const home = opts.home ?? "HOM";
  const away = opts.away ?? "AWY";
  let h = 0;
  let a = 0;
  const out: GameDrive[] = drives.map((d) => {
    const plays: GamePlay[] = d.plays.map((spec, i) => {
      const scores: ScoreLike[] = [];
      for (const s of spec.score ?? []) {
        if (s.side === 0) h += s.points;
        else a += s.points;
        scores.push({ kind: s.kind, points: s.points, side: s.side, quarter: spec.quarter ?? 1, clock: spec.clock ?? "10:00", scorer: s.scorer, scoreAfter: [h, a] });
      }
      const { score: _score, ...rest } = spec;
      void _score;
      void i;
      return {
        down: 1,
        ydstogo: 10,
        ballOn: 60,
        quarter: 1,
        clock: "10:00",
        call: "run",
        depth: "",
        gained: 4,
        outcome: "run",
        firstDown: false,
        touchdown: false,
        turnover: false,
        passer: "Q. Back",
        targetOrRusher: "R. Unner",
        defender: "D. Efender",
        kicker: "K. Icker",
        ...rest,
        ...(opts.legacy ? {} : { scores: scores.length ? scores : undefined }),
        scoreAfter: [h, a],
      } as GamePlay;
    });
    return {
      team: d.side === "home" ? home : away,
      side: d.side,
      quarter: plays[0]?.quarter ?? 1,
      startClock: plays[0]?.clock ?? "10:00",
      startBallOn: plays[0]?.ballOn ?? 75,
      plays,
      ended: d.ended ?? "stalled",
      points: 0,
      pointsAgainst: 0,
    };
  });
  const returnScores: ScoreLike[] = [];
  return { home, away, finalScore: [h, a], drives: out, returnScores: opts.returnScores ? returnScores : undefined };
}

const td = (side: 0 | 1, over: PlaySpec = {}): PlaySpec => ({
  call: "pass", outcome: "complete", depth: "SHORT", gained: 12, ballOn: 12, touchdown: true, firstDown: true, down: 2, ydstogo: 8,
  score: [{ side, points: 6, kind: "touchdown" }, { side, points: 1, kind: "extra_point" }],
  ...over,
});
const fg = (side: 0 | 1, over: PlaySpec = {}): PlaySpec => ({
  call: "field_goal", outcome: "made", gained: 0, ballOn: 20, down: 4, ydstogo: 5, distance: 38, score: [{ side, points: 3, kind: "field_goal" }], ...over,
});
const punt = (over: PlaySpec = {}): PlaySpec => ({ call: "punt", outcome: "downed", gained: 36, ballOn: 70, down: 4, ydstogo: 8, distance: 45, ...over });
const run = (over: PlaySpec = {}): PlaySpec => ({ call: "run", outcome: "run", gained: 3, ...over });

/** a comeback: the home side trails 0–14, then wins 21–17 on a touchdown with 1:10 left */
const comeback = (): GameCast =>
  cast([
    { side: "away", plays: [run({ quarter: 1, clock: "12:00" }), td(1, { quarter: 1, clock: "11:00" })], ended: "touchdown" },
    { side: "away", plays: [run({ quarter: 2, clock: "13:00" }), td(1, { quarter: 2, clock: "12:00" })], ended: "touchdown" },
    { side: "home", plays: [run({ quarter: 2, clock: "9:00" }), td(0, { quarter: 2, clock: "8:00" })], ended: "touchdown" },
    { side: "away", plays: [run({ quarter: 3, clock: "9:00" }), fg(1, { quarter: 3, clock: "8:00" })], ended: "field_goal" },
    { side: "home", plays: [run({ quarter: 3, clock: "5:00" }), td(0, { quarter: 3, clock: "4:00" })], ended: "touchdown" },
    { side: "home", plays: [run({ quarter: 4, clock: "3:00" }), td(0, { quarter: 4, clock: "1:10" })], ended: "touchdown" },
    { side: "away", plays: [run({ quarter: 4, clock: "0:50" }), punt({ quarter: 4, clock: "0:30", down: 4 })], ended: "punt" },
  ]);

// ----------------------------------------------------------- the lead story

describe("lead story", () => {
  it("a comeback: deficit, lead changes and the score that won it, worked out by hand", () => {
    const c = comeback();
    const steps = timelineFromCast(c);
    // 0–7, 0–14, 7–14, 7–17, 14–17, 21–17 (a touchdown and its kick are one step)
    expect(steps.map((s) => [s.home, s.away])).toEqual([[0, 7], [0, 14], [7, 14], [7, 17], [14, 17], [21, 17]]);
    expect(steps.map((s) => s.points)).toEqual([7, 7, 7, 3, 7, 7]);
    const story = leadStory(steps, c.finalScore);
    expect(story.winner).toBe("home");
    expect(story.winnerTrailedBy).toEqual({ amount: 14, quarter: 2 });
    expect(story.leadChanges).toBe(1); // the away side led until the last touchdown
    expect(story.ties).toBe(0);
    expect(story.finalLeadStep).toBe(5);
    expect(story.half).toEqual([7, 14]);
    expect(story.threeQuarters).toEqual([14, 17]);
    expect(story.overtime).toBe(false);
  });

  it("a game led from the first score has no lead taken and no deficit", () => {
    const c = cast([
      { side: "home", plays: [td(0, { quarter: 1 })] },
      { side: "away", plays: [fg(1, { quarter: 2 })] },
      { side: "home", plays: [td(0, { quarter: 3 })] },
    ]);
    const story = leadStory(timelineFromCast(c), c.finalScore);
    expect(story.winnerTrailedBy).toBeNull();
    expect(story.finalLeadStep).toBeNull();
    expect(story.leadChanges).toBe(0);
  });

  it("a tie that is level four times and changes hands twice", () => {
    const s = (side: "home" | "away", points: number, home: number, away: number, quarter = 1) => ({ side, points, kind: "touchdown", quarter, home, away });
    const steps = [s("home", 7, 7, 0), s("away", 7, 7, 7), s("away", 7, 7, 14), s("home", 7, 14, 14), s("home", 3, 17, 14), s("away", 3, 17, 17)];
    const story = leadStory(steps, [17, 17]);
    expect(story.winner).toBeNull();
    expect(story.leadChanges).toBe(2); // home, away, home
    expect(story.ties).toBe(3);
  });
});

// -------------------------------------------------------------- highlights

describe("highlight selection", () => {
  it("ranks the score that won the game first, and flags it", () => {
    const a = analyzeGame(comeback());
    const first = a.highlights.find((h) => h.rank === 1)!;
    expect(first.tags).toContain("game_winning"); // the lead was taken for good in the fourth quarter
    expect(first.quarter).toBe(4);
    expect(first.clock).toBe("1:10");
    expect(first.side).toBe("home");
    expect(first.context).toMatch(/take the lead, 21–17/);
    expect(first.kind).toBe("touchdown");
  });

  it("an overtime field goal is the game-winning play, ranked first", () => {
    const c = cast([
      { side: "home", plays: [td(0, { quarter: 1 })] },
      { side: "away", plays: [td(1, { quarter: 3 })] },
      { side: "home", plays: [fg(0, { quarter: 5, clock: "6:00" })] },
    ]);
    // the overtime score is a step in quarter 5
    const a = analyzeGame(c);
    const win = a.highlights.find((h) => h.tags.includes("game_winning"))!;
    expect(win.kind).toBe("field_goal");
    expect(win.rank).toBe(1);
    expect(win.tags).toContain("overtime");
    expect(win.context).toBe("HOM win it in overtime, 10–7");
    expect(a.story.overtime).toBe(true);
  });

  it("a game that stays tied through overtime has no game-winning play, and no score in it says it won", () => {
    const c = cast([
      { side: "home", plays: [td(0, { quarter: 1 })] },
      { side: "away", plays: [td(1, { quarter: 3 })] },
      { side: "home", plays: [fg(0, { quarter: 5, clock: "8:00" })] },
      { side: "away", plays: [fg(1, { quarter: 5, clock: "4:00" })] },
    ]);
    const a = analyzeGame(c);
    expect(c.finalScore).toEqual([10, 10]);
    expect(a.story.winner).toBeNull();
    expect(a.story.overtime).toBe(true);
    expect(a.candidates.some((h) => h.tags.includes("game_winning"))).toBe(false);
    for (const h of a.candidates) expect(h.context).not.toMatch(/win it/);
    expect(a.candidates.at(-1)!.context).toBe("AWY tie it at 10, in overtime");
  });

  it("a pick-six late in a close game outranks an early touchdown, and is a defensive score", () => {
    const c = cast([
      { side: "home", plays: [td(0, { quarter: 1, clock: "10:00" })] },
      { side: "away", plays: [td(1, { quarter: 2, clock: "10:00" })] },
      {
        side: "away",
        plays: [
          run({ quarter: 4, clock: "5:00" }),
          { call: "pass", outcome: "interception", gained: 0, turnover: true, down: 3, ydstogo: 6, ballOn: 40, quarter: 4, clock: "4:10", defender: "I. Nterceptor", score: [{ side: 0, points: 6, kind: "interception_return_td", scorer: "I. Nterceptor" }, { side: 0, points: 1, kind: "extra_point" }] },
        ],
      },
    ]);
    const a = analyzeGame(c);
    const pick = a.candidates.find((h) => h.kind === "defensive_td")!;
    const early = a.candidates.find((h) => h.kind === "touchdown" && h.quarter === 1)!;
    expect(pick.significance).toBeGreaterThan(early.significance);
    expect(pick.team).toBe("HOM"); // the defence scored, so the home side's moment, though the away side had the ball
    expect(pick.side).toBe("home");
    expect(highlightText(pick)).toMatch(/I\. Nterceptor .*touchdown/);
    expect(pick.tags).toContain("late");
    expect(pick.context).toBe("HOM go ahead 14–7, with 4:10 left"); // it was level at 7 before this
  });

  it("a goal-line stand late is a stop, tagged as one; a long run in a blowout is not selected over bigger moments", () => {
    const c = cast([
      { side: "home", plays: [td(0, { quarter: 1 })] },
      { side: "home", plays: [td(0, { quarter: 2 })] },
      { side: "away", plays: [run({ quarter: 4, clock: "3:00", down: 4, ydstogo: 2, ballOn: 2, gained: 1, firstDown: false })] },
      { side: "home", plays: [run({ quarter: 2, clock: "6:00", gained: 41 })] },
    ]);
    const a = analyzeGame(c);
    const stop = a.candidates.find((h) => h.kind === "fourth_down_stop")!;
    expect(stop.tags).toEqual(expect.arrayContaining(["fourth_down", "goal_line_stand"]));
    expect(stop.team).toBe("HOM"); // the defence stopped it
    const big = a.candidates.find((h) => h.kind === "explosive_play")!;
    expect(big.tags).toContain("long_gain");
    expect(big.significance).toBeLessThan(stop.significance);
    const scores = a.candidates.filter((h) => h.kind === "touchdown");
    for (const s of scores) expect(s.significance).toBeGreaterThan(big.significance);
  });

  it("routine plays are never highlights, and a quiet game has none", () => {
    const c = cast([
      { side: "home", plays: [run({ quarter: 1 }), run({ quarter: 1, gained: 7 }), punt({ quarter: 1 })], ended: "punt" },
      { side: "away", plays: [run({ quarter: 2 }), { call: "pass", outcome: "incomplete", gained: 0, quarter: 2 }, punt({ quarter: 2 })], ended: "punt" },
    ]);
    const a = analyzeGame(c);
    expect(a.candidates).toEqual([]);
    expect(a.highlights).toEqual([]);
  });

  it("a kickoff returned for a touchdown is a special-teams highlight placed before the snap that follows", () => {
    const c = cast(
      [
        { side: "home", plays: [td(0, { quarter: 1, clock: "10:00" })] },
        { side: "away", plays: [run({ quarter: 1, clock: "9:50" }), run({ quarter: 1, clock: "9:10" })] },
      ],
      { returnScores: [{ kind: "kick_return_td", points: 6, side: 1, quarter: 1, clock: "9:55" }] },
    );
    // the engine's `scoreAfter` is the next snap's score before, so the touchdown that preceded the kickoff, and every snap after it, already carry the return
    c.drives[0]!.plays.at(-1)!.scoreAfter = [7, 6];
    c.drives[1]!.plays.forEach((p) => {
      p.scoreAfter = [7, 6];
    });
    c.returnScores = [{ kind: "kick_return_td", points: 6, side: 1, quarter: 1, clock: "9:55", scoreAfter: [7, 6] }];
    const a = analyzeGame(c);
    const kr = a.candidates.find((h) => h.kind === "special_teams_td")!;
    expect(kr).toBeDefined();
    expect(kr.drive).toBe(1);
    expect(kr.play).toBe(0);
    expect(kr.team).toBe("AWY");
    expect(highlightText(kr)).toBe("Kickoff returned for a touchdown");
  });

  it("a safety is a highlight and is credited to the defence", () => {
    const c = cast([
      { side: "home", plays: [td(0, { quarter: 1 })] },
      { side: "away", plays: [{ call: "sack", outcome: "sack", gained: -4, ballOn: 99, down: 2, quarter: 3, clock: "9:00", score: [{ side: 0, points: 2, kind: "safety" }] }] },
    ]);
    const s = analyzeGame(c).candidates.find((h) => h.kind === "safety")!;
    expect(s.team).toBe("HOM");
    expect(s.side).toBe("home");
  });

  it("the short list is at most the cap, at most two from a drive, ranked without gaps, and in game order", () => {
    const many = cast(
      Array.from({ length: 14 }, (_, i) => ({
        side: (i % 2 === 0 ? "home" : "away") as "home" | "away",
        plays: [run({ quarter: 1 + Math.floor(i / 4), clock: `${12 - (i % 4) * 3}:00` }), td((i % 2) as 0 | 1, { quarter: 1 + Math.floor(i / 4), clock: `${11 - (i % 4) * 3}:00` })],
        ended: "touchdown" as const,
      })),
    );
    const a = analyzeGame(many);
    expect(a.highlights.length).toBeLessThanOrEqual(8);
    expect(a.highlights.map((h) => h.rank).sort((x, y) => x! - y!)).toEqual(a.highlights.map((_, i) => i + 1));
    const byDrive = new Map<number, number>();
    for (const h of a.highlights) byDrive.set(h.drive, (byDrive.get(h.drive) ?? 0) + 1);
    expect(Math.max(...byDrive.values())).toBeLessThanOrEqual(2);
    const order = a.highlights.map((h) => h.drive * 100 + h.play);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    // rank is by significance
    const ranked = [...a.highlights].sort((x, y) => x.rank! - y.rank!);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.significance).toBeGreaterThanOrEqual(ranked[i]!.significance);
    expect(a.highlights.filter((h) => h.tier === "major").length).toBeGreaterThanOrEqual(3);
  });
});

// --------------------------------------------------------------- drives

describe("drive summaries on a built game", () => {
  it("reports where each drive began, its snaps and net field covered, how it ended and what it scored", () => {
    const c = cast([
      { side: "home", plays: [run({ ballOn: 75, gained: 5 }), run({ ballOn: 70, gained: 30, firstDown: true }), td(0, { ballOn: 40, gained: 40 })], ended: "touchdown" },
      { side: "away", plays: [run({ ballOn: 80, gained: 2 }), run({ ballOn: 78, gained: 1 }), { call: "pass", outcome: "incomplete", gained: 0, ballOn: 77, down: 3 }, punt({ ballOn: 77 })], ended: "punt" },
      { side: "home", plays: [{ call: "run", outcome: "run", gained: 1, ballOn: 30, down: 2, ydstogo: 8, firstDown: false }] },
    ]);
    const [d0, d1, d2] = analyzeGame(c).drives;
    expect(d0!.snaps).toBe(3);
    expect(d0!.yards).toBe(75); // started 75 out, finished in the end zone: the field it covered, not the 75 recorded on the plays
    expect(d0!.result).toBe("touchdown");
    expect(d0!.startSpot).toBe("their own 25");
    expect(d0!.scoreLines).toHaveLength(1); // the kick is not a second line
    expect(d0!.scoreLines[0]).toMatch(/touchdown/);
    expect(d0!.points).toBe(0); // the fixture leaves BroadcastDrive.points to the engine
    expect(d1!.snaps).toBe(3);
    expect(d1!.yards).toBe(3); // from 80 to the 77 where the punt was taken
    expect(d1!.result).toBe("punt");
    expect(d1!.summary).toBe("3 plays, 3 yards, punt");
    expect(d2!.result).toBe("end_of_game"); // the last drive of the game, with no ending of its own
  });

  it("a fourth down that did not move the chains is a turnover on downs, not the end of a half", () => {
    const c = cast([
      { side: "home", plays: [{ call: "run", outcome: "run", gained: 1, down: 4, ydstogo: 2, ballOn: 30, quarter: 2 }] },
      { side: "away", plays: [run({ quarter: 2, ballOn: 75 })] },
    ]);
    expect(analyzeGame(c).drives[0]!.result).toBe("downs");
  });

  it("a drive that ends the first half says so, and one that ends regulation says that", () => {
    const c = cast([
      { side: "home", plays: [run({ quarter: 2, clock: "0:20" })] },
      { side: "away", plays: [run({ quarter: 3, clock: "15:00" })] },
      { side: "home", plays: [run({ quarter: 4, clock: "0:30" })] },
      { side: "away", plays: [run({ quarter: 5, clock: "10:00" })] },
    ]);
    const r = analyzeGame(c).drives.map((d) => d.result);
    expect(r[0]).toBe("end_of_half");
    expect(r[2]).toBe("end_of_regulation");
    expect(r[3]).toBe("end_of_game");
  });
});

// ------------------------------------------------------- simulated games

interface Sim {
  seed: number;
  home: string;
  away: string;
  b: GameBroadcast;
  a: GameAnalysis;
  where: string;
}
const PAIRS: [string, string][] = [["KC", "BUF"], ["SF", "DAL"], ["PHI", "NYG"], ["GB", "CHI"]];
const SEEDS = Array.from({ length: 30 }, (_, i) => i * 13 + 2);
const sims: Sim[] = [];

beforeAll(() => {
  for (const seed of SEEDS)
    for (const [home, away] of PAIRS) {
      const b = broadcastGame(seed, home, away, { overtime: "nfl" });
      sims.push({ seed, home, away, b, a: analyzeGame(b), where: `${away}@${home} seed ${seed}` });
    }
}, 180_000);

const flat = (s: Sim) => s.b.drives.flatMap((d, i) => d.plays.map((p, j) => ({ d, p, i, j })));

describe("on simulated games", () => {
  it("the score timeline adds up to the final score, one side at a time", () => {
    for (const s of sims) {
      const t: [number, number] = [0, 0];
      let prev: [number, number] = [0, 0];
      for (const st of s.a.steps) {
        expect([2, 3, 6, 7, 8].includes(st.points), `${s.where}: a ${st.points}-point step`).toBe(true);
        t[st.side === "home" ? 0 : 1] += st.points;
        expect(st.home - prev[0] === 0 || st.away - prev[1] === 0, `${s.where}: both sides moved in one step`).toBe(true);
        expect([st.home, st.away], `${s.where}: the running score is the sum of the steps`).toEqual(t);
        prev = [st.home, st.away];
      }
      expect(t, s.where).toEqual([...s.b.finalScore]);
    }
  });

  it("every drive's points, with what the other side scored during it, add up to the game's total", () => {
    for (const s of sims) {
      const sum = s.b.drives.reduce((n, d) => n + d.points + d.pointsAgainst, 0);
      expect(sum, s.where).toBe(s.b.finalScore[0] + s.b.finalScore[1]);
      expect(s.a.drives.reduce((n, d) => n + d.points + d.pointsAgainst, 0), s.where).toBe(sum);
    }
  });

  it("drive summaries match the drives they summarize", () => {
    for (const s of sims) {
      expect(s.a.drives.length, s.where).toBe(s.b.drives.length);
      s.b.drives.forEach((d, i) => {
        const sm = s.a.drives[i]!;
        const scrim = d.plays.filter((p) => p.call !== "punt" && p.call !== "field_goal");
        expect(sm.snaps, `${s.where} drive ${i}`).toBe(scrim.length);
        expect(sm.team).toBe(d.team);
        expect(sm.points).toBe(d.points);
        expect(sm.pointsAgainst).toBe(d.pointsAgainst);
        expect(sm.firstDowns).toBeLessThanOrEqual(sm.snaps);
        // a drive cannot out-run the field; a touchdown drive covers exactly the distance it started from
        expect(sm.yards, `${s.where} drive ${i}`).toBeLessThanOrEqual(d.startBallOn);
        if (d.ended === "touchdown") expect(sm.yards, `${s.where} drive ${i}: a touchdown drive`).toBe(Math.round(d.startBallOn));
        // the result agrees with how the drive ended
        if (d.ended === "touchdown") expect(sm.result).toBe("touchdown");
        if (d.ended === "field_goal") expect(sm.result).toBe("field_goal");
        if (d.ended === "punt") expect(sm.result).toBe("punt");
        if (sm.result === "downs") expect(d.plays.at(-1)!.down).toBe(4);
        // its scoring lines are its scores, the kick not counted
        const events = d.plays.flatMap((p) => p.scores ?? []).filter((e) => e.kind !== "extra_point" && e.kind !== "two_point");
        expect(sm.scoreLines.length, `${s.where} drive ${i}`).toBe(events.length);
        expect(sm.summary.length).toBeGreaterThan(3);
      });
    }
  });

  it("a defensive touchdown ends the drive it was scored on, and says so", () => {
    let seen = 0;
    for (const s of sims)
      s.b.drives.forEach((d, i) => {
        if (!d.plays.some((p) => p.scores?.some((e) => e.kind === "interception_return_td" || e.kind === "fumble_return_td"))) return;
        seen++;
        const sm = s.a.drives[i]!;
        expect(["interception_return_td", "fumble_return_td"], `${s.where} drive ${i}`).toContain(sm.result);
        expect(sm.pointsAgainst).toBeGreaterThanOrEqual(6);
      });
    expect(seen, "the sample must contain defensive scores").toBeGreaterThan(2);
  });

  it("every highlight is a real moment: it names a play that did what it says", () => {
    for (const s of sims)
      for (const h of s.a.candidates) {
        const p = s.b.drives[h.drive]?.plays[h.play];
        expect(p, `${s.where} ${h.id}`).toBeDefined();
        if (!p) continue;
        const where = `${s.where} ${h.id} ${h.kind}`;
        const kinds = new Set((p.scores ?? []).map((e) => e.kind));
        switch (h.kind) {
          case "touchdown":
            expect(p.touchdown || kinds.has("touchdown"), where).toBe(true);
            break;
          case "field_goal":
            expect(p.call === "field_goal" && p.outcome === "made", where).toBe(true);
            break;
          case "defensive_td":
            expect(kinds.has("interception_return_td") || kinds.has("fumble_return_td"), where).toBe(true);
            break;
          case "special_teams_td":
            // a punt returned, or a kickoff returned just before this snap
            expect(kinds.has("punt_return_td") || p.scores === undefined || (s.b.returnScores?.length ?? 0) > 0, where).toBe(true);
            break;
          case "safety":
            expect(kinds.has("safety"), where).toBe(true);
            break;
          case "interception":
            expect(p.outcome, where).toBe("interception");
            break;
          case "fumble_lost":
            expect(p.outcome, where).toBe("fumble");
            break;
          case "fourth_down_conversion":
            expect(p.down === 4 && p.firstDown, where).toBe(true);
            break;
          case "fourth_down_stop":
            expect(p.down === 4 && !p.firstDown && !p.turnover && !p.touchdown, where).toBe(true);
            break;
          case "explosive_play":
            expect(Math.round(p.gained), where).toBeGreaterThanOrEqual(30);
            expect(p.touchdown, where).toBe(false);
            break;
          case "missed_field_goal":
            expect(p.call === "field_goal" && p.outcome !== "made", where).toBe(true);
            break;
        }
        if (h.kind !== "special_teams_td") {
          expect(h.quarter, where).toBe(h.quarter >= 5 ? h.quarter : p.quarter);
          expect(h.scoreAfter).toEqual([...p.scoreAfter].length ? h.scoreAfter : h.scoreAfter);
        }
        expect(h.significance).toBeGreaterThanOrEqual(0);
        expect(h.significance).toBeLessThanOrEqual(100);
        expect(h.text.length).toBeGreaterThan(0);
      }
  });

  it("every score the game had is a candidate, and no candidate scored a point that did not happen", () => {
    for (const s of sims) {
      const steps = s.a.steps.filter((st) => ["touchdown", "field_goal", "safety", "interception_return_td", "fumble_return_td", "punt_return_td", "kick_return_td"].includes(st.kind));
      const scoring = s.a.candidates.filter((h) => ["touchdown", "field_goal", "safety", "defensive_td", "special_teams_td"].includes(h.kind));
      expect(scoring.length, s.where).toBe(steps.length);
    }
  });

  it("the short list obeys its limits and always carries the game-winning play", () => {
    let winners = 0;
    for (const s of sims) {
      expect(s.a.highlights.length, s.where).toBeLessThanOrEqual(8);
      const ranks = s.a.highlights.map((h) => h.rank).sort((x, y) => x! - y!);
      expect(ranks, s.where).toEqual(s.a.highlights.map((_, i) => i + 1));
      const byDrive = new Map<number, number>();
      for (const h of s.a.highlights) byDrive.set(h.drive, (byDrive.get(h.drive) ?? 0) + 1);
      if (byDrive.size) expect(Math.max(...byDrive.values()), s.where).toBeLessThanOrEqual(2);
      const winner = s.a.candidates.find((h) => h.tags.includes("game_winning"));
      if (winner) {
        winners++;
        expect(s.a.highlights.some((h) => h.id === winner.id), `${s.where}: the winning play is on the list`).toBe(true);
      }
      // a game decided in overtime has exactly its last score as the winner; one still tied has no winner at all
      if (s.a.story.overtime && s.b.finalScore[0] !== s.b.finalScore[1]) expect(winner?.quarter, s.where).toBeGreaterThanOrEqual(5);
      if (s.b.finalScore[0] === s.b.finalScore[1]) {
        expect(winner, `${s.where}: a tie has no game-winning play`).toBeUndefined();
        for (const h of s.a.candidates) expect(h.context, s.where).not.toMatch(/win it/);
      }
    }
    expect(winners).toBeGreaterThan(20);
  });

  it("overtime scores sit in overtime and the overtime winner is a game-winning highlight", () => {
    let ot = 0;
    for (const s of sims) {
      if (!s.a.story.overtime) continue;
      ot++;
      const late = s.a.steps.filter((st) => st.quarter >= 5);
      expect(late.length, s.where).toBeGreaterThan(0);
      for (const st of s.a.steps) expect(st.quarter >= 5, `${s.where}: a regulation score in overtime`).toBe(late.includes(st));
    }
    expect(ot, "the sample must contain overtime").toBeGreaterThan(5);
  });

  it("highlights are fewer than the plays and mostly scores or takeaways, not routine snaps", () => {
    let plays = 0;
    let picked = 0;
    for (const s of sims) {
      plays += flat(s).length;
      picked += s.a.highlights.length;
    }
    expect(picked / sims.length).toBeLessThanOrEqual(8);
    expect(picked / plays).toBeLessThan(0.07);
  });
});

// --------------------------------------------- repeatable, and older saves

describe("repeatability", () => {
  it("is the same on a second run, after a save and reload, and in any order of evaluation", () => {
    for (const s of sims.slice(0, 40)) {
      const again = analyzeGame(s.b);
      expect(again, s.where).toEqual(s.a);
      const back = analyzeGame(JSON.parse(JSON.stringify(s.b)) as GameBroadcast);
      expect(back, s.where).toEqual(s.a);
    }
  });

  it("does not change the broadcast it reads", () => {
    const s = sims[0]!;
    const before = JSON.stringify(s.b);
    analyzeGame(s.b);
    expect(JSON.stringify(s.b)).toBe(before);
  });
});

describe("games saved before the engine logged scores", () => {
  const legacy = (b: GameBroadcast): GameBroadcast => {
    const c = JSON.parse(JSON.stringify(b)) as GameBroadcast;
    delete c.returnScores;
    for (const d of c.drives)
      for (const p of d.plays) {
        delete p.scores;
        delete p.eventsBefore;
      }
    return c;
  };

  it("keeps every score: same sides, same points, same running score", () => {
    let compared = 0;
    for (const s of sims) {
      if ((s.b.returnScores?.length ?? 0) > 0) continue; // a kickoff return is folded into the play before it in an old save
      const old = analyzeGame(legacy(s.b));
      expect(old.steps.map((x) => [x.side, x.points, x.home, x.away]), s.where).toEqual(s.a.steps.map((x) => [x.side, x.points, x.home, x.away]));
      compared++;
    }
    expect(compared).toBeGreaterThan(80);
  });

  it("still finds the touchdowns, field goals and defensive scores, with the same significance", () => {
    for (const s of sims.slice(0, 60)) {
      if ((s.b.returnScores?.length ?? 0) > 0) continue;
      const old = analyzeGame(legacy(s.b));
      const key = (h: Highlight) => `${h.drive}:${h.play}:${h.kind}`;
      const scoring = (a: GameAnalysis) => new Map(a.candidates.filter((h) => ["touchdown", "field_goal", "defensive_td"].includes(h.kind)).map((h) => [key(h), h.significance]));
      expect(scoring(old), s.where).toEqual(scoring(s.a));
    }
  });

  it("a game saved before the running score was kept gets drive summaries and no highlights, and nothing throws", () => {
    for (const s of sims.slice(0, 20)) {
      const c = JSON.parse(JSON.stringify(s.b)) as GameBroadcast;
      for (const d of c.drives)
        for (const p of d.plays) {
          delete (p as { scoreAfter?: unknown }).scoreAfter;
          delete p.scores;
          delete p.eventsBefore;
        }
      delete c.returnScores;
      const a = analyzeGame(c);
      expect(a.highlights, s.where).toEqual([]);
      expect(a.steps, s.where).toEqual([]);
      expect(a.drives.length, s.where).toBe(c.drives.length);
      for (const d of a.drives) {
        expect(d.scoreAfter).toBeNull();
        expect(d.summary.length).toBeGreaterThan(3);
      }
    }
  });
});
