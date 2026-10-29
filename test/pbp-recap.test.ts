import { beforeAll, describe, expect, it } from "vitest";

import { simulateOne } from "../server/simGame.js";
import { scoringPlaysFrom } from "../server/boxscore-map.js";
import { analyzeGame, highlightText } from "../src/engine/highlights.js";
import { type RecapLine, type RecapSource, buildRecap, standoutsFrom } from "../src/engine/recap.js";
import { loadPool } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * PBP-4: the postgame recap.
 *
 * It must say only what the record supports. The strongest check here audits
 * every number a recap prints against the numbers the record carries; the
 * others pin classification, standouts, key moments and the fall-backs for
 * older records. Prose is never pinned, only the facts inside it.
 */

type Record = RecapSource & { id: string };
const PAIRS: [string, string][] = [["KC", "BUF"], ["SF", "DAL"], ["PHI", "NYG"], ["GB", "CHI"]];
const records: Record[] = [];

beforeAll(() => {
  const pool = loadPool();
  let n = 0;
  for (const seed of Array.from({ length: 14 }, (_, i) => i * 9 + 3))
    for (const [home, away] of PAIRS) {
      const phase = n++ % 9 === 0 ? "SB" : "REG";
      const o = simulateOne({ gameSeed: seed, season: 2026, week: 5, phase, homeTeam: home, awayTeam: away, isViewer: true, homePlayers: pool.get(home)!, awayPlayers: pool.get(away)! }) as unknown as RecapSource;
      records.push({ ...o, homeTeam: home, awayTeam: away, id: `${away}@${home} seed ${seed}` });
    }
}, 240_000);

const ints = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);

/** every number a recap may print: the record's own figures, plus the few that are plain arithmetic on them */
function allowedNumbers(src: RecapSource, r: ReturnType<typeof buildRecap>): Set<number> {
  const ok = new Set<number>([0, 1, 2, 3, 4, 5]); // quarter and ordinal words, "once"
  const add = (...ns: number[]): void => ns.forEach((n) => ok.add(n));
  add(src.homeScore, src.awayScore, Math.abs(src.homeScore - src.awayScore), src.homeScore + src.awayScore, src.week ?? 0);
  for (const t of [src.totals?.home, src.totals?.away]) {
    if (!t) continue;
    let run = 0;
    for (const q of t.byQuarter) {
      add(q);
      run += q;
      add(run);
    }
  }
  for (const row of src.scoringPlays ?? []) add(row.quarter, row.homeScore, row.awayScore, Math.abs(row.homeScore - row.awayScore), ...ints(row.description));
  for (const side of ["home", "away"] as const)
    for (const l of src.playerLines?.[side] ?? []) add(...Object.values(l).filter((v): v is number => typeof v === "number"));
  for (const d of src.broadcast?.drives ?? [])
    for (const p of d.plays) {
      add(p.scoreAfter[0], p.scoreAfter[1], Math.abs(p.scoreAfter[0] - p.scoreAfter[1]), Math.round(p.gained), Math.round(p.ydstogo), Math.round(p.ballOn), p.quarter, p.distance ?? 0, ...ints(p.clock));
      // the spots a play names: where it started and ended, from either end of the field, and where a punt came to rest
      for (const yl of [p.ballOn, p.ballOn - p.gained, 100 - p.ballOn + p.gained]) add(Math.round(yl), 100 - Math.round(yl));
      for (const e of p.scores ?? []) add(e.scoreAfter[0], e.scoreAfter[1], Math.abs(e.scoreAfter[0] - e.scoreAfter[1]), ...ints(e.clock));
    }
  add(r.facts.margin, r.facts.total, r.facts.leadChanges, r.facts.winnerTrailedBy ?? 0);
  return ok;
}

describe("the result", () => {
  it("names the winner and the loser and the exact final score, in the headline and the first paragraph", () => {
    for (const rec of records) {
      const r = buildRecap(rec);
      const hi = Math.max(rec.homeScore, rec.awayScore);
      const lo = Math.min(rec.homeScore, rec.awayScore);
      const [w, l] = rec.homeScore > rec.awayScore ? [rec.homeTeam, rec.awayTeam] : [rec.awayTeam, rec.homeTeam];
      if (rec.homeScore === rec.awayScore) {
        expect(r.headline, rec.id).toContain(`${rec.homeScore}–${rec.awayScore}`);
        expect(r.facts.winner).toBeNull();
        continue;
      }
      expect(r.headline, rec.id).toContain(w);
      expect(r.headline, rec.id).toContain(l);
      expect(r.headline, rec.id).toContain(`${hi}–${lo}`);
      expect(r.paragraphs[0], rec.id).toContain(`${w}`);
      expect(r.paragraphs[0], rec.id).toContain(`${hi}–${lo}`);
      expect(r.facts.winner).toBe(w);
      expect(r.facts.margin).toBe(hi - lo);
    }
  });

  it("says overtime exactly when the game went to overtime, and champions exactly in the Super Bowl", () => {
    let ot = 0;
    let sb = 0;
    for (const rec of records) {
      const r = buildRecap(rec);
      const wentOT = (rec.totals?.home.byQuarter.length ?? 4) > 4;
      expect(r.facts.overtime, rec.id).toBe(wentOT);
      if (rec.homeScore !== rec.awayScore) {
        expect(/in overtime/.test(r.paragraphs[0]!), rec.id).toBe(wentOT);
        expect(/champions/.test(r.paragraphs[0]!), rec.id).toBe(rec.phase === "SB");
        expect(r.paragraphs[0]).toContain(rec.phase === "SB" ? "Super Bowl" : "Week 5");
      }
      if (wentOT) ot++;
      if (rec.phase === "SB") sb++;
    }
    expect(ot).toBeGreaterThan(0);
    expect(sb).toBeGreaterThan(0);
  });
});

describe("game types are decided by the record's numbers", () => {
  /** the most the winner trailed by, from the scoring summary alone */
  const worstDeficit = (rec: RecapSource): number => {
    const winnerHome = rec.homeScore > rec.awayScore;
    let worst = 0;
    for (const row of rec.scoringPlays ?? []) worst = Math.max(worst, winnerHome ? row.awayScore - row.homeScore : row.homeScore - row.awayScore);
    return worst;
  };
  it("blowout, shootout, defensive struggle, overtime, tie and comeback follow their definitions", () => {
    const seen = new Set<string>();
    for (const rec of records) {
      const r = buildRecap(rec);
      const margin = Math.abs(rec.homeScore - rec.awayScore);
      const total = rec.homeScore + rec.awayScore;
      expect(r.kinds.includes("blowout"), rec.id).toBe(margin >= 21);
      expect(r.kinds.includes("shootout"), rec.id).toBe(total >= 65);
      expect(r.kinds.includes("defensive_struggle"), rec.id).toBe(total <= 24);
      expect(r.kinds.includes("tie"), rec.id).toBe(margin === 0);
      expect(r.kinds.includes("comeback"), rec.id).toBe(margin > 0 && worstDeficit(rec) >= 10);
      for (const k of r.kinds) seen.add(k);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["blowout", "comeback", "overtime"]));
  });

  const built = (over: Partial<RecapSource>): RecapSource => ({ homeTeam: "HOM", awayTeam: "AWY", homeScore: 0, awayScore: 0, phase: "REG", week: 3, ...over });
  const row = (quarter: number, team: string, description: string, homeScore: number, awayScore: number) => ({ quarter, team, description, homeScore, awayScore });

  it("a comeback names the deficit, the quarter it was reached in, and the score that won it", () => {
    const rec = built({
      homeScore: 24,
      awayScore: 20,
      totals: { home: { byQuarter: [0, 7, 3, 14] }, away: { byQuarter: [10, 7, 0, 3] } },
      scoringPlays: [
        row(1, "AWY", "A. Back 20-yard touchdown pass to R. Eceiver", 0, 7),
        row(1, "AWY", "30-yard field goal, K. Icker", 0, 10),
        row(2, "AWY", "A. Back 5-yard touchdown run", 0, 17),
        row(2, "HOM", "H. Ome 9-yard touchdown pass to T. End", 7, 17),
        row(3, "HOM", "40-yard field goal, H. Kicker", 10, 17),
        row(4, "HOM", "H. Ome 3-yard touchdown run", 17, 17),
        row(4, "AWY", "35-yard field goal, K. Icker", 17, 20),
        row(4, "HOM", "H. Ome 11-yard touchdown pass to W. Ideout", 24, 20),
      ],
    });
    const r = buildRecap(rec);
    expect(r.kinds).toContain("comeback");
    expect(r.facts.winnerTrailedBy).toBe(17);
    expect(r.headline).toMatch(/rally from 17 down|come back/);
    const flow = r.paragraphs.join(" ");
    expect(flow).toContain("trailed by 17 in the second quarter");
    expect(flow).toContain("The go-ahead score came in the fourth quarter: H. Ome 11-yard touchdown pass to W. Ideout");
    expect(r.facts.leadChanges).toBe(1);
  });

  it("an overtime finish says the game was level after regulation and how it was won", () => {
    const rec = built({
      homeScore: 23,
      awayScore: 20,
      totals: { home: { byQuarter: [7, 3, 3, 7, 3] }, away: { byQuarter: [7, 7, 3, 3, 0] } },
      scoringPlays: [
        row(1, "AWY", "A. Back 20-yard touchdown pass to R. Eceiver", 0, 7),
        row(1, "HOM", "H. Ome 9-yard touchdown run", 7, 7),
        row(2, "AWY", "A. Back 5-yard touchdown run", 7, 14),
        row(2, "HOM", "40-yard field goal, H. Kicker", 10, 14),
        row(3, "HOM", "30-yard field goal, H. Kicker", 13, 14),
        row(3, "AWY", "35-yard field goal, K. Icker", 13, 17),
        row(4, "HOM", "H. Ome 3-yard touchdown run", 20, 17),
        row(4, "AWY", "50-yard field goal, K. Icker", 20, 20),
        row(5, "HOM", "33-yard field goal, H. Kicker", 23, 20),
      ],
    });
    const r = buildRecap(rec);
    expect(r.kinds).toContain("overtime");
    expect(r.headline).toMatch(/overtime/);
    const text = r.paragraphs.join(" ");
    expect(text).toContain("tied at 20 after regulation");
    expect(text).toContain("HOM won it in overtime: 33-yard field goal, H. Kicker");
    expect(r.keyMoments.at(-1)!.quarter).toBe(5);
  });

  it("defensive and special-teams scores are named, with the player where the summary names one", () => {
    const rec = built({
      homeScore: 21,
      awayScore: 10,
      scoringPlays: [
        row(1, "HOM", "I. Nterceptor returns the interception for a touchdown", 7, 0),
        row(2, "AWY", "40-yard field goal, K. Icker", 7, 3),
        row(2, "HOM", "P. Unter punt return for a touchdown", 14, 3),
        row(3, "HOM", "Safety", 16, 3),
        row(4, "AWY", "A. Back 5-yard touchdown run", 16, 10),
        row(4, "HOM", "Kickoff returned for a touchdown", 22, 10),
      ],
    });
    const r = buildRecap(rec);
    expect(r.kinds).toEqual(expect.arrayContaining(["defensive_score", "special_teams_score"]));
    const text = r.paragraphs.join(" ");
    expect(text).toContain("I. Nterceptor returned an interception for a touchdown in the first quarter");
    expect(text).toContain("P. Unter returned a punt for a touchdown in the second quarter");
    expect(text).toContain("HOM added a safety in the third quarter");
  });

  it("a tie is a tie, and a low score is a defensive struggle", () => {
    expect(buildRecap(built({ homeScore: 17, awayScore: 17 })).headline).toBe("HOM and AWY play to a 17–17 tie");
    const r = buildRecap(built({ homeScore: 13, awayScore: 10 }));
    expect(r.kinds).toContain("defensive_struggle");
    expect(r.headline).toMatch(/defensive struggle|low-scoring/);
  });

  it("the Super Bowl winner is called champion, and no other round is", () => {
    expect(buildRecap(built({ homeScore: 27, awayScore: 24, phase: "SB" })).paragraphs[0]).toBe("HOM beat AWY 27–24 in the Super Bowl and are the champions.".replace("beat", RegExp("beat|defeated|topped").exec(buildRecap(built({ homeScore: 27, awayScore: 24, phase: "SB" })).paragraphs[0]!)![0]));
    expect(buildRecap(built({ homeScore: 27, awayScore: 24, phase: "DIV" })).paragraphs[0]).not.toMatch(/champion/);
  });
});

describe("standouts come from the recorded lines", () => {
  const mk = (name: string, over: Partial<RecapLine>): RecapLine => ({ name, position: "X", ...over });

  it("picks the top passer, rusher, receiver and a defender, and quotes their lines exactly", () => {
    const lines = {
      home: [
        mk("Q. One", { passCmp: 20, passAtt: 30, passYds: 250, passTd: 2 }),
        mk("Q. Two", { passCmp: 5, passAtt: 9, passYds: 40, passInt: 1 }),
        mk("R. Ush", { rushAtt: 18, rushYds: 96, rushTd: 1 }),
        mk("W. Ide", { rec: 7, recYds: 130, recTd: 2 }),
        mk("D. Efense", { sacks: 3, tackles: 5, passDef: 1 }),
      ],
      away: [mk("Q. Away", { passCmp: 30, passAtt: 45, passYds: 380, passTd: 1, passInt: 3 }), mk("T. Iny", { rushAtt: 3, rushYds: 9 })],
    };
    const s = standoutsFrom(lines, { home: "HOM", away: "AWY" });
    const by = (team: string, role: string) => s.find((x) => x.team === team && x.role === role);
    expect(by("HOM", "passing")).toMatchObject({ name: "Q. One", line: "20/30, 250 yds, 2 TD" });
    expect(by("HOM", "rushing")).toMatchObject({ name: "R. Ush", line: "18 carries, 96 yds, 1 TD" });
    expect(by("HOM", "receiving")).toMatchObject({ name: "W. Ide", line: "7 catches, 130 yds, 2 TD" });
    expect(by("HOM", "defense")).toMatchObject({ name: "D. Efense", line: "3 sacks, 1 pass defended, 5 tackles" });
    expect(by("AWY", "passing")).toMatchObject({ name: "Q. Away", line: "30/45, 380 yds, 1 TD, 3 INT" });
    // a nine-yard rushing day and a two-carry quarterback are not standouts
    expect(by("AWY", "rushing")).toBeUndefined();
  });

  it("on every sampled game, every standout is a recorded line, quoted without change", () => {
    let checked = 0;
    for (const rec of records) {
      const r = buildRecap(rec);
      for (const s of r.standouts) {
        const side = s.team === rec.homeTeam ? "home" : "away";
        const line = rec.playerLines![side].find((l) => l.name === s.name);
        expect(line, `${rec.id}: ${s.name} is not on ${s.team}`).toBeDefined();
        const printed = ints(s.line);
        const have = Object.values(line!).filter((v): v is number => typeof v === "number");
        for (const n of printed) expect(have.includes(n), `${rec.id}: ${s.name} "${s.line}" has a ${n} that is not recorded`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("no lines, no standouts, and no failure", () => {
    const rec = records[0]!;
    const r = buildRecap({ ...rec, playerLines: undefined });
    expect(r.standouts).toEqual([]);
    expect(r.paragraphs.length).toBeGreaterThan(0);
  });

  it("follows the record: change a line and the recap changes with it", () => {
    const rec = records.find((x) => x.playerLines!.home.some((l) => (l.passAtt ?? 0) >= 8))!;
    const tampered: RecapSource = {
      ...rec,
      playerLines: { away: rec.playerLines!.away, home: rec.playerLines!.home.map((l) => ((l.passAtt ?? 0) >= 8 ? { ...l, passYds: 999 } : l)) },
    };
    expect(buildRecap(tampered).standouts.some((s) => s.line.includes("999 yds"))).toBe(true);
    expect(buildRecap(rec).standouts.some((s) => s.line.includes("999 yds"))).toBe(false);
  });
});

describe("nothing in a recap is invented", () => {
  it("every number printed is in the record or plain arithmetic on it", () => {
    for (const rec of records) {
      const r = buildRecap(rec);
      const ok = allowedNumbers(rec, r);
      const text = [r.headline, ...r.paragraphs, ...r.keyMoments.flatMap((m) => [m.text, m.why]), ...r.standouts.map((s) => s.line)].join(" | ");
      for (const n of ints(text)) expect(ok.has(n), `${rec.id}: "${n}" is not supported by the record — ${text}`).toBe(true);
    }
  });

  it("the audit can fail: a made-up statistic and a made-up score are caught", () => {
    const rec = records[1]!;
    const r = buildRecap(rec);
    const ok = allowedNumbers(rec, r);
    const text = r.paragraphs.join(" ") + " Q. Back threw for 4,873 yards.";
    expect(ints(text).every((n) => ok.has(n))).toBe(false);
    const wrong = r.headline.replace(/\d+/, "187");
    expect(ints(wrong).every((n) => ok.has(n))).toBe(false);
  });

  it("every name printed is one the record carries", () => {
    for (const rec of records) {
      const r = buildRecap(rec);
      const known = new Set<string>([rec.homeTeam, rec.awayTeam]);
      for (const side of ["home", "away"] as const) for (const l of rec.playerLines![side]) known.add(l.name);
      for (const d of rec.broadcast!.drives) for (const p of d.plays) for (const n of [p.passer, p.targetOrRusher, p.defender, p.kicker, p.returner, p.tackler]) if (n) known.add(n);
      for (const m of r.keyMoments) expect(known.has(m.team), `${rec.id}: team ${m.team}`).toBe(true);
      for (const s of r.standouts) expect(known.has(s.name), `${rec.id}: ${s.name}`).toBe(true);
    }
  });
});

describe("key moments", () => {
  it("are three to five, in game order, each one a real score or play with a reason", () => {
    for (const rec of records) {
      const r = buildRecap(rec);
      const steps = analyzeGame(rec.broadcast!).steps.length;
      if (steps >= 3) {
        expect(r.keyMoments.length, rec.id).toBeGreaterThanOrEqual(3);
        expect(r.keyMoments.length, rec.id).toBeLessThanOrEqual(5);
      }
      const analysis = analyzeGame(rec.broadcast!);
      const known = new Set(analysis.candidates.map((h) => highlightText(h)));
      let prev = 0;
      for (const m of r.keyMoments) {
        expect(known.has(m.text), `${rec.id}: "${m.text}" is not a play of the game`).toBe(true);
        expect(m.why.length, rec.id).toBeGreaterThan(0);
        expect(m.quarter, rec.id).toBeGreaterThanOrEqual(prev);
        prev = m.quarter;
      }
    }
  });

  it("a game that ended late shows a late moment", () => {
    let checked = 0;
    for (const rec of records) {
      const a = analyzeGame(rec.broadcast!);
      const lateExists = a.candidates.some((h) => h.quarter >= 4 && h.significance >= 30);
      if (!lateExists || a.steps.length < 3) continue;
      checked++;
      expect(buildRecap(rec).keyMoments.some((m) => m.quarter >= 4), rec.id).toBe(true);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("from a scoring summary alone, each moment is a row of the summary", () => {
    for (const rec of records.slice(0, 30)) {
      const r = buildRecap({ ...rec, broadcast: undefined });
      const descriptions = new Set((rec.scoringPlays ?? []).map((x) => x.description));
      for (const m of r.keyMoments) expect(descriptions.has(m.text), `${rec.id}: ${m.text}`).toBe(true);
    }
  });
});

describe("older records", () => {
  it("any amount of the record gives a recap, and the result never changes", () => {
    for (const rec of records.slice(0, 30)) {
      const full = buildRecap(rec);
      const variants: RecapSource[] = [
        { ...rec, broadcast: undefined },
        { ...rec, broadcast: undefined, playerLines: undefined },
        { ...rec, broadcast: undefined, playerLines: undefined, scoringPlays: undefined },
        { ...rec, broadcast: undefined, playerLines: undefined, scoringPlays: undefined, totals: undefined },
      ];
      const bases = ["scoring_summary", "scoring_summary", "final_score", "final_score"];
      variants.forEach((v, i) => {
        const r = buildRecap(v);
        expect(r.basis, rec.id).toBe(bases[i]);
        expect(r.headline.length, rec.id).toBeGreaterThan(8);
        // a record with only a final score cannot know the game went to overtime; every other cut can
        const expected = i >= 3 ? full.paragraphs[0]!.replace(" in overtime", "") : full.paragraphs[0];
        expect(r.paragraphs[0], `${rec.id}: the result paragraph is the same however much was kept`).toBe(expected);
        expect(r.facts.winner).toBe(full.facts.winner);
        expect(r.facts.margin).toBe(full.facts.margin);
        expect(r.facts.overtime).toBe(i >= 3 ? false : full.facts.overtime);
        expect(r.paragraphs.join(" ")).not.toMatch(/undefined|NaN/);
      });
    }
  });

  it("a scoring summary reconstructed by the old method (no engine log) still gives a recap that reaches the final score", () => {
    const pool = loadPool();
    for (const seed of [3, 12, 30, 57]) {
      const g = simulateGame(seed, "KC", "BUF", { trace: true, injuries: true, overtime: "nfl" });
      const rows = scoringPlaysFrom(g.playTrace!, "KC", "BUF", [g.score[0], g.score[1]], g.drivesLog); // no log: the old reconstruction
      void pool;
      const r = buildRecap({ homeTeam: "KC", awayTeam: "BUF", homeScore: g.score[0], awayScore: g.score[1], scoringPlays: rows });
      expect(r.basis).toBe("scoring_summary");
      expect(r.paragraphs[0]).toContain(`${Math.max(g.score[0], g.score[1])}–${Math.min(g.score[0], g.score[1])}`);
    }
  });

  it("a bare record (scores only) is a one-line result", () => {
    const r = buildRecap({ homeTeam: "KC", awayTeam: "BUF", homeScore: 20, awayScore: 17 });
    expect(r.basis).toBe("final_score");
    expect(r.paragraphs).toHaveLength(1);
    expect(r.keyMoments).toEqual([]);
    expect(r.standouts).toEqual([]);
  });
});

describe("repeatability", () => {
  it("is the same twice, after a save and reload, and with the same team naming", () => {
    for (const rec of records.slice(0, 40)) {
      const name = (c: string) => `The ${c}`;
      const a = buildRecap(rec, { teamName: name });
      expect(buildRecap(rec, { teamName: name }), rec.id).toEqual(a);
      expect(buildRecap(JSON.parse(JSON.stringify(rec)) as RecapSource, { teamName: name }), rec.id).toEqual(a);
      expect(a.headline).toContain("The ");
    }
  });

  it("does not change the record it reads", () => {
    const rec = records[2]!;
    const before = JSON.stringify(rec);
    buildRecap(rec);
    expect(JSON.stringify(rec)).toBe(before);
  });

  it("the same game gives the same recap whatever else was in the league", () => {
    // the record is all it reads: building other recaps first changes nothing
    const rec = records[5]!;
    const alone = buildRecap(rec);
    for (const other of records.slice(10, 20)) buildRecap(other);
    expect(buildRecap(rec)).toEqual(alone);
  });
});
