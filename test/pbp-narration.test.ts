import { beforeAll, describe, expect, it } from "vitest";

import { simulateOne } from "../server/simGame.js";
import { type BroadcastPlay, type GameBroadcast, broadcastGame } from "../src/engine/broadcast.js";
import { loadPool } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import {
  type PlayNarration,
  type Seg,
  narrateBroadcast,
  narratePlay,
  narrateScoreLine,
  narrationText,
  spotPhrase,
} from "../src/engine/narration.js";

/**
 * PBP-2: one narration, read off the play and the events the engine logged.
 *
 * These pin what the text may say and must not say, not its prose: a name has
 * to be one the play carries, a number has to be the play's own, a touchdown
 * has to be a touchdown. Wording can change; the facts cannot.
 */
const PAIRS: [string, string][] = [
  ["KC", "BUF"],
  ["SF", "DAL"],
  ["PHI", "NYG"],
  ["GB", "CHI"],
];
const SEEDS = Array.from({ length: 30 }, (_, i) => i * 13 + 2);

interface Cast {
  seed: number;
  home: string;
  away: string;
  b: GameBroadcast;
  N: PlayNarration[][];
  where: string;
}
const casts: Cast[] = [];
const teamsOf = (home: string, away: string) => ({ home, away });
const names = (segs: readonly Seg[]): string[] => segs.flatMap((s) => (typeof s === "string" ? [] : [s.name]));
const flat = (c: Cast) => c.b.drives.flatMap((d, i) => d.plays.map((p, j) => ({ p, n: c.N[i]![j]!, side: d.side, i, j })));

beforeAll(() => {
  for (const seed of SEEDS)
    for (const [home, away] of PAIRS) {
      const b = broadcastGame(seed, home, away, { overtime: "nfl" });
      casts.push({ seed, home, away, b, N: narrateBroadcast(b.drives, teamsOf(home, away)), where: `${away}@${home} seed ${seed}` });
    }
}, 180_000);

describe("narration is faithful to the play", () => {
  it("never prints a placeholder, and always says something", () => {
    for (const c of casts)
      for (const { p, n } of flat(c)) {
        const t = narrationText(n.play);
        expect(t.length, c.where).toBeGreaterThan(8);
        expect(t, `${c.where}: ${t}`).not.toMatch(/undefined|null|NaN|\[object|\$\{/);
        void p;
      }
  });

  it("names only people the play carries, and all of the ones that matter", () => {
    for (const c of casts)
      for (const { p, n } of flat(c)) {
        const allowed = new Set([p.passer, p.targetOrRusher, p.defender, p.tackler, p.kicker, p.returner, ...(p.scores ?? []).map((s) => s.scorer)].filter(Boolean) as string[]);
        const used = names(n.play);
        const t = narrationText(n.play);
        for (const u of used) expect(allowed.has(u), `${c.where}: "${u}" is not on the play — ${t}`).toBe(true);
        if (p.call === "pass" && p.outcome !== "interception" && p.outcome !== "fumble") {
          expect(used, `${c.where}: ${t}`).toContain(p.passer);
          if (p.outcome !== "incomplete" || p.targetOrRusher) expect(used).toContain(p.targetOrRusher);
        }
        if (p.call === "run") expect(used, `${c.where}: ${t}`).toContain(p.targetOrRusher);
        if (p.call === "sack") expect(used, `${c.where}: ${t}`).toEqual(expect.arrayContaining([p.passer, ...(p.defender ? [p.defender] : [])] as string[]));
        if (p.outcome === "interception") expect(used, `${c.where}: ${t}`).toEqual(expect.arrayContaining([p.passer, p.defender] as string[]));
        if (p.call === "field_goal" || p.call === "punt") expect(used, `${c.where}: ${t}`).toContain(p.kicker);
      }
  });

  it("states the play's own numbers and spot", () => {
    for (const c of casts)
      for (const { p, n } of flat(c)) {
        const t = narrationText(n.play);
        const safety = p.scores?.some((s) => s.kind === "safety") ?? false;
        const g = Math.abs(Math.round(p.gained));
        if (p.call === "field_goal" || p.call === "punt") {
          if (p.distance !== undefined) expect(t, `${c.where}: ${t}`).toContain(String(p.distance));
          continue;
        }
        const incomplete = p.outcome === "incomplete";
        if (g !== 0 && !incomplete && p.outcome !== "fumble" && p.outcome !== "interception") expect(t, `${c.where}: ${t}`).toMatch(new RegExp(`\\b${g}\\b`));
        const lands = !p.touchdown && !safety && !incomplete && p.outcome !== "interception" && !(p.outcome === "fumble" && g === 0);
        if (lands && p.outcome !== "fumble") expect(t, `${c.where}: ${t}`).toContain(spotPhrase(Math.max(1, p.ballOn - p.gained)));
      }
  });

  it("calls a play what it was: touchdown, sack, interception, safety, incomplete, turnover on downs", () => {
    for (const c of casts) {
      const plays = flat(c);
      plays.forEach(({ p, n }, k) => {
        const t = narrationText(n.play);
        const has = (kind: string) => p.scores?.some((s) => s.kind === kind) ?? false;
        const defTd = has("interception_return_td") || has("fumble_return_td") || has("punt_return_td");
        const where = `${c.where}: ${t}`;
        expect(/touchdown/i.test(t), where).toBe(p.touchdown || defTd);
        expect(/\bsack|brings down/i.test(t), where).toBe(p.call === "sack");
        expect(/intercept|picks off/i.test(t), where).toBe(p.outcome === "interception");
        expect(/SAFETY/.test(t), where).toBe(has("safety"));
        expect(/fumble/i.test(t), where).toBe(p.outcome === "fumble" || p.outcome === "fumbled");
        if (p.outcome === "incomplete") expect(t, where).toMatch(/incomplete|cannot connect/);
        // a fourth-down snap that neither moved the chains nor scored hands the ball over: the next snap is the other side's
        const downs = /turnover on downs/.test(t);
        const next = plays[k + 1];
        const expectDowns = p.down === 4 && p.call !== "punt" && p.call !== "field_goal" && !p.firstDown && !p.touchdown && !p.turnover && !has("safety");
        expect(downs, where).toBe(expectDowns);
        if (downs && next && next.p.quarter === p.quarter) expect(next.side, `${where} — the next snap should be the other side's`).not.toBe(plays[k]!.side);
      });
    }
  });

  it("does not mutate the broadcast it reads", () => {
    const c = casts[0]!;
    const before = JSON.stringify(c.b);
    narrateBroadcast(c.b.drives, teamsOf(c.home, c.away));
    expect(JSON.stringify(c.b)).toBe(before);
  });
});

describe("defensive scores and special teams", () => {
  const withKind = (kind: string) => casts.flatMap((c) => flat(c).filter(({ p }) => p.scores?.some((s) => s.kind === kind)).map((x) => ({ ...x, c })));

  it("a pick-six says who returned it for a touchdown, from the logged scorer", () => {
    const rows = withKind("interception_return_td");
    expect(rows.length, "the sample must contain pick-sixes").toBeGreaterThan(2);
    for (const { p, n, c } of rows) {
      const t = narrationText(n.play);
      expect(t, c.where).toMatch(/touchdown/);
      expect(names(n.play)).toContain(p.defender);
      expect(p.scores!.find((s) => s.kind === "interception_return_td")!.scorer).toBe(p.defender);
    }
  });

  it("a fumble return says touchdown but does not name a recoverer the engine does not know", () => {
    for (const { p, n, c } of withKind("fumble_return_td")) {
      expect(narrationText(n.play), c.where).toMatch(/returns it for a touchdown/);
      expect(names(n.play).every((x) => x === p.defender || x === p.passer || x === p.targetOrRusher), c.where).toBe(true);
    }
  });

  it("a punt return touchdown names the returner, a safety is a safety", () => {
    for (const { p, n, c } of withKind("punt_return_td")) {
      expect(narrationText(n.play), c.where).toMatch(/returned by .* for a touchdown/);
      expect(names(n.play)).toContain(p.returner);
    }
    const safeties = withKind("safety");
    expect(safeties.length).toBeGreaterThan(0);
    for (const { n, c } of safeties) expect(narrationText(n.play), c.where).toMatch(/SAFETY/);
  });

  it("scoring-summary lines name only what the event and its play carry", () => {
    const play = { call: "pass", gained: 31, passer: "A. Passer", targetOrRusher: "B. Catcher", defender: "C. Back", kicker: "D. Kicker", distance: 44 };
    expect(narrateScoreLine({ kind: "touchdown", points: 6 }, play)).toBe("A. Passer 31-yard touchdown pass to B. Catcher");
    expect(narrateScoreLine({ kind: "field_goal", points: 3 }, play)).toBe("44-yard field goal, D. Kicker");
    expect(narrateScoreLine({ kind: "interception_return_td", points: 6, scorer: "C. Back" }, play)).toBe("C. Back returns the interception for a touchdown");
    expect(narrateScoreLine({ kind: "fumble_return_td", points: 6 }, play)).toBe("Fumble returned for a touchdown");
    expect(narrateScoreLine({ kind: "kick_return_td", points: 6 }, undefined)).toBe("Kickoff returned for a touchdown");
    expect(narrateScoreLine({ kind: "safety", points: 2 }, { ...play, call: "sack" })).toBe("Safety — C. Back sacks A. Passer in the end zone");
    expect(narrateScoreLine({ kind: "safety", points: 2 }, undefined)).toBe("Safety");
    expect(narrateScoreLine({ kind: "punt_return_td", points: 6 }, undefined)).toBe("Punt returned for a touchdown");
  });
});

describe("penalties, spikes and kneels", () => {
  it("each one is narrated from its own event, with the team and where the ball ended up", () => {
    let pen = 0;
    let spikes = 0;
    let kneels = 0;
    for (const c of casts)
      for (const { p, n } of flat(c)) {
        const evs = p.eventsBefore ?? [];
        expect(n.before.length, c.where).toBe(evs.length);
        evs.forEach((e, i) => {
          const t = narrationText(n.before[i]!);
          const team = e.team === 0 ? c.home : c.away;
          expect(t, c.where).toContain(team);
          if (e.type === "penalty") {
            pen++;
            const moved = Math.abs(e.after.yardline100 - e.before.yardline100);
            expect(t, `${c.where}: ${t}`).toMatch(/^(OT|Q\d)?.*Flag: /);
            expect(t).toContain(moved === 0 ? "no yardage" : String(moved));
            expect(t).toContain(spotPhrase(e.after.yardline100));
            expect(t).toContain(`${["", "1st", "2nd", "3rd", "4th"][e.after.down]} &`);
            expect(/automatic first down/.test(t)).toBe(e.automaticFirstDown);
            expect(t).toContain(e.onOffense ? "offense" : "defense");
          } else if (e.type === "spike") {
            spikes++;
            expect(t).toMatch(/spike/);
          } else {
            kneels++;
            expect(t).toMatch(/take a knee/);
          }
          // an event stamped in another quarter than the snap it precedes says when it happened
          if (e.quarter !== p.quarter) expect(t, `${c.where}: ${t}`).toMatch(/^(Q\d|OT)/);
        });
      }
    expect(pen).toBeGreaterThan(100);
    expect(spikes + kneels).toBeGreaterThan(0);
  });
});

describe("overtime", () => {
  it("narrates overtime plays like any others, and says overtime on a late event", () => {
    let otPlays = 0;
    for (const c of casts)
      for (const { p, n } of flat(c)) {
        if (p.quarter < 5) continue;
        otPlays++;
        const t = narrationText(n.play);
        expect(t, c.where).not.toMatch(/undefined|NaN/);
        if (p.touchdown) expect(t).toMatch(/touchdown/);
      }
    expect(otPlays, "the sample must contain overtime").toBeGreaterThan(10);
  });
});

describe("games saved before the engine logged scores", () => {
  /** what an older save carries: no scores, no events between snaps, no tackler. */
  const legacy = (b: GameBroadcast): GameBroadcast => {
    const c = JSON.parse(JSON.stringify(b)) as GameBroadcast;
    delete c.returnScores;
    for (const d of c.drives)
      for (const p of d.plays) {
        delete p.scores;
        delete p.eventsBefore;
        delete p.tackler;
        p.desc = "stale text from an older version";
      }
    return c;
  };

  it("still reads, and never shows the stale stored text", () => {
    for (const c of casts) {
      const old = legacy(c.b);
      const N = narrateBroadcast(old.drives, teamsOf(c.home, c.away));
      N.forEach((d, i) =>
        d.forEach((n, j) => {
          const t = narrationText(n.play);
          expect(t, c.where).not.toMatch(/undefined|NaN|stale text/);
          expect(n.before, c.where).toEqual([]);
          void i;
          void j;
        }),
      );
    }
  });

  it("recovers a defensive touchdown from the running score, and invents none", () => {
    let recovered = 0;
    for (const c of casts) {
      const N = narrateBroadcast(legacy(c.b).drives, teamsOf(c.home, c.away));
      c.b.drives.forEach((d, i) =>
        d.plays.forEach((p, j) => {
          const t = narrationText(N[i]![j]!.play);
          const truth = p.scores?.some((s) => s.kind === "interception_return_td" || s.kind === "fumble_return_td") ?? false;
          if (truth) recovered++;
          // a kickoff returned for a score just before the next snap is also in the running score, so a rare false reading is possible
          // only for a turnover on the last snap of a half; the sample must not contain a miss
          expect(/for a touchdown|returns it/.test(t) && (p.outcome === "interception" || p.outcome === "fumble"), `${c.where}: ${t}`).toBe(truth);
        }),
      );
    }
    expect(recovered).toBeGreaterThan(2);
  });

  it("reads the same as a new save for every play the new data does not touch", () => {
    let same = 0;
    for (const c of casts.slice(0, 40)) {
      const N = narrateBroadcast(legacy(c.b).drives, teamsOf(c.home, c.away));
      c.b.drives.forEach((d, i) =>
        d.plays.forEach((p, j) => {
          if (p.scores || p.eventsBefore || p.tackler) return;
          expect(narrationText(N[i]![j]!.play), c.where).toBe(narrationText(c.N[i]![j]!.play));
          same++;
        }),
      );
    }
    expect(same).toBeGreaterThan(500);
  });
});

describe("one narration for every path", () => {
  it("the text the engine stores is the text the screen renders", () => {
    for (const c of casts)
      for (const { p, n } of flat(c)) expect(narrationText(n.play), c.where).toBe(p.desc);
  });

  it("is the same after a save and reload, and wherever the play sits", () => {
    for (const c of casts.slice(0, 40)) {
      const back = JSON.parse(JSON.stringify(c.b)) as GameBroadcast;
      expect(narrateBroadcast(back.drives, teamsOf(c.home, c.away)), c.where).toEqual(c.N);
      // position-independent: a play reads the same alone as in the game
      for (const { p, n, side, i, j } of flat(c).slice(0, 60)) {
        const prev = j > 0 ? c.b.drives[i]!.plays[j - 1]!.scoreAfter : i > 0 ? c.b.drives[i - 1]!.plays.at(-1)!.scoreAfter : undefined;
        expect(narratePlay(p as BroadcastPlay, { prevScoreAfter: prev, side })).toEqual(n.play);
      }
    }
  });

  it("single-player's stored broadcast, the engine's, and the narration of either agree", () => {
    const pool = loadPool();
    let checked = 0;
    for (const [home, away] of PAIRS) {
      for (const gameSeed of [3, 11]) {
        const out = simulateOne({
          gameSeed,
          season: 2026,
          week: 4,
          phase: "REG",
          homeTeam: home,
          awayTeam: away,
          isViewer: true,
          homePlayers: pool.get(home)!,
          awayPlayers: pool.get(away)!,
        });
        const bc = (out as { broadcast?: GameBroadcast }).broadcast!;
        expect(bc, `${away}@${home}`).toBeDefined();
        const N = narrateBroadcast(bc.drives, teamsOf(home, away));
        bc.drives.forEach((d, i) => d.plays.forEach((p, j) => {
          expect(narrationText(N[i]![j]!.play)).toBe(p.desc);
          checked++;
        }));
        // and a second run of the same seed is the same text
        const again = simulateOne({ gameSeed, season: 2026, week: 4, phase: "REG", homeTeam: home, awayTeam: away, isViewer: true, homePlayers: pool.get(home)!, awayPlayers: pool.get(away)! });
        expect(JSON.stringify((again as { broadcast?: GameBroadcast }).broadcast)).toBe(JSON.stringify(bc));
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("the text follows the data", () => {
  const base: BroadcastPlay = {
    down: 2, ydstogo: 7, ballOn: 40, quarter: 2, clock: "5:00", call: "pass", depth: "SHORT", gained: 12, outcome: "complete",
    desc: "", firstDown: true, touchdown: false, turnover: false, passer: "Q. Back", targetOrRusher: "W. Receiver", defender: undefined,
    injuries: [], scoreAfter: [0, 0],
  };
  const t = (p: Partial<BroadcastPlay>, ctx = {}) => narrationText(narratePlay({ ...base, ...p }, ctx));

  it("a changed name, distance, spot or result changes the sentence, and nothing else does", () => {
    expect(t({})).toContain("Q. Back");
    expect(t({ passer: "Z. Other" })).toContain("Z. Other");
    expect(t({ passer: "Z. Other" })).not.toContain("Q. Back");
    expect(t({ gained: 15 })).toContain("15");
    expect(t({ gained: 15 })).not.toContain("12");
    expect(t({ ballOn: 60, gained: 12 })).toContain(spotPhrase(48));
    expect(t({ touchdown: true, firstDown: false, gained: 40, ballOn: 40 })).toMatch(/40-yard touchdown/);
    expect(t({ outcome: "incomplete", gained: 0, firstDown: false })).toMatch(/incomplete|cannot connect/);
    // a different clock may re-word it but never changes a fact
    expect(t({ clock: "4:59" })).toContain("12 yards");
  });

  it("a defensive score is recovered from the scoreboard only when the defence's points say so", () => {
    const pick = { outcome: "interception", gained: 0, firstDown: false, turnover: true, defender: "I. Ntercept", scoreAfter: [0, 7] as [number, number] };
    expect(t(pick, { prevScoreAfter: [0, 0], side: "home" })).toMatch(/touchdown/);
    expect(t(pick, { prevScoreAfter: [0, 7], side: "home" })).not.toMatch(/touchdown/);
    expect(t(pick, { prevScoreAfter: [0, 0], side: "away" })).not.toMatch(/touchdown/); // the offence's own points are not a pick-six
    expect(t({ ...pick, scores: [] })).not.toMatch(/touchdown/); // the engine's record wins when there is one
  });
});

describe("variety, and a stable simulation", () => {
  it("uses many more sentence shapes than before, without leaning on a few", () => {
    const shape = (t: string) => t.replace(/-?\d+/g, "#").replace(/\b(the opp|their own) #/g, "SPOT #");
    const counts = new Map<string, number>();
    let total = 0;
    for (const c of casts)
      for (const { n } of flat(c)) {
        const nm = names(n.play);
        let t = narrationText(n.play);
        for (const x of nm) t = t.split(x).join("N");
        const k = shape(t);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        total++;
      }
    const top = Math.max(...counts.values());
    expect(counts.size, "distinct shapes").toBeGreaterThan(70);
    expect(top / total, "share of the most common shape").toBeLessThan(0.1);
  });

  it("does not repeat a sentence back to back within a drive", () => {
    let pairs = 0;
    let same = 0;
    for (const c of casts)
      for (const d of c.b.drives)
        for (let i = 1; i < d.plays.length; i++) {
          pairs++;
          if (d.plays[i]!.desc === d.plays[i - 1]!.desc) same++;
        }
    expect(same / pairs).toBeLessThan(0.01);
  });

  it("changes nothing about the game: the broadcast's score is the engine's", () => {
    for (const c of casts.slice(0, 20)) {
      const g = simulateGame(c.seed, c.home, c.away, { trace: true, injuries: true, overtime: "nfl" });
      expect(c.b.finalScore, c.where).toEqual([g.score[0], g.score[1]]);
      expect(c.b.drives.flatMap((d) => d.plays).length, c.where).toBe(g.playTrace!.length);
    }
  });
});
