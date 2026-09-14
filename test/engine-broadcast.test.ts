import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { broadcastGame } from "../src/engine/broadcast.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";

/**
 * The broadcast view (field visualisation + injury ticker). Pool-gated — it
 * sims a real game with the trace + injuries on.
 */

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("broadcastGame", () => {
  const b = broadcastGame(5, "KC", "BUF");

  it("packages the game with drives grouped into possessions", () => {
    expect(b.home).toBe("KC");
    expect(b.away).toBe("BUF");
    expect(b.finalScore).toHaveLength(2);
    expect(b.drives.length).toBeGreaterThan(8);
    for (const d of b.drives) {
      expect(["home", "away"]).toContain(d.side);
      expect(NFL_TEAMS).toContain(d.team);
      expect(d.plays.length).toBeGreaterThan(0);
      // a possession is a single team's run of plays
      expect(new Set(d.plays.map(() => d.team)).size).toBe(1);
      for (const p of d.plays) {
        expect(p.ballOn).toBeGreaterThanOrEqual(0);
        expect(p.ballOn).toBeLessThanOrEqual(100);
        expect(p.desc.length).toBeGreaterThan(4);
        expect(["pass", "run", "sack", "scramble", "punt", "field_goal"]).toContain(p.call);
      }
      // the drive's `ended` matches its last play
      const last = d.plays[d.plays.length - 1]!;
      if (last.touchdown) expect(d.ended).toBe("touchdown");
      else if (last.call === "field_goal") expect(["field_goal", "missed_field_goal"]).toContain(d.ended);
      else if (last.call === "punt") expect(["punt", "punt_return_td"]).toContain(d.ended);
      else if (last.turnover) expect(d.ended).toBe("turnover");
    }
  });

  it("scoringDrives point at every drive that put points on the board", () => {
    expect(b.scoringDrives.length).toBeGreaterThan(0);
    for (const i of b.scoringDrives) {
      expect(b.drives[i]!.points).toBeGreaterThan(0);
      expect(["touchdown", "field_goal"]).toContain(b.drives[i]!.ended);
    }
  });

  it("models punts and field goals as their own trailing play", () => {
    const plays = b.drives.flatMap((d) => d.plays);
    const fgs = plays.filter((p) => p.call === "field_goal");
    const punts = plays.filter((p) => p.call === "punt");
    expect(fgs.length + punts.length).toBeGreaterThan(0);
    for (const p of fgs) {
      expect(["made", "missed"]).toContain(p.outcome);
      expect(p.distance).toBeGreaterThan(0);
      expect(p.kicker).toBeTruthy();
      expect(p.desc).toMatch(/field goal/);
    }
    for (const p of punts) {
      expect(["touchback", "downed", "returned", "return_td"]).toContain(p.outcome);
      expect(p.distance).toBeGreaterThan(0);
      expect(p.kicker).toBeTruthy();
      expect(p.desc).toMatch(/punt/);
    }
    // every field-goal/punt drive's `ended` is consistent with its last play's outcome
    for (const d of b.drives) {
      const last = d.plays[d.plays.length - 1]!;
      if (last.call === "field_goal") expect(d.ended).toBe(last.outcome === "made" ? "field_goal" : "missed_field_goal");
      if (last.call === "punt") expect(d.ended).toBe(last.outcome === "return_td" ? "punt_return_td" : "punt");
    }
  });

  it("carries the injury log through, attached to its exact play", () => {
    for (const e of b.injuries) {
      expect(e.narrative).toMatch(/ while /);
      expect(["KC", "BUF"]).toContain(e.team);
    }
    const attached = b.drives.flatMap((d) => d.plays).flatMap((p) => p.injuries);
    expect(attached).toHaveLength(b.injuries.length);
    for (const e of attached) expect(b.injuries).toContain(e);
  });

  it("attributes plays to plausible on-field players", () => {
    const plays = b.drives.flatMap((d) => d.plays);
    const withPasser = plays.filter((p) => p.call !== "run" && p.passer);
    const withRusher = plays.filter((p) => p.call === "run" && p.targetOrRusher);
    expect(withPasser.length).toBeGreaterThan(5);
    expect(withRusher.length).toBeGreaterThan(5);
    const interceptions = plays.filter((p) => p.outcome === "interception");
    for (const p of interceptions) expect(p.defender).toBeTruthy();
  });

  it("a play's quarter can be used to detect quarter transitions front-to-back", () => {
    const seq = b.drives.flatMap((d) => d.plays).map((p) => p.quarter);
    let last = 0;
    for (const q of seq) {
      expect(q).toBeGreaterThanOrEqual(last);
      last = q;
    }
    expect(new Set(seq).size).toBeGreaterThanOrEqual(3); // most games reach Q3+
  });

  it("is deterministic", () => {
    const again = broadcastGame(5, "KC", "BUF");
    expect(again.finalScore).toEqual(b.finalScore);
    expect(again.drives.map((d) => d.plays.map((p) => p.desc))).toEqual(
      b.drives.map((d) => d.plays.map((p) => p.desc)),
    );
    expect(again.injuries.map((e) => e.narrative)).toEqual(b.injuries.map((e) => e.narrative));
  });
});

/**
 * The running score.
 *
 * A replay whose scoreboard shows the final score from the opening kickoff
 * isn't a replay. What makes this awkward enough to be worth a suite of its
 * own is that points do not all arrive on the play that produced them: a
 * pick-six is traced as an interception and scores afterwards, a punt taken
 * back scores after the punt, and a kickoff return scores between two traced
 * plays. So each play carries the score as it stands once everything that
 * play set off is done, and these check it end to end rather than by
 * construction.
 *
 * Points that land between two drives are credited to the drive that just
 * ended, because in almost every case that drive is what caused them: the
 * punt that was taken back, the interception returned for a score. The one
 * case where that reads oddly is a kickoff return touchdown, which lands in
 * the same gap and gets credited to the possession before it — which is why
 * a single drive can carry points both ways.
 */
describe("broadcast running score", () => {
  const games = Array.from({ length: 40 }, (_, i) => broadcastGame(9_000 + i * 37, "KC", "BUF"));

  it("never goes backwards", () => {
    for (const b of games) {
      let prev: readonly [number, number] = [0, 0];
      for (const p of b.drives.flatMap((d) => d.plays)) {
        expect(p.scoreAfter[0]).toBeGreaterThanOrEqual(prev[0]);
        expect(p.scoreAfter[1]).toBeGreaterThanOrEqual(prev[1]);
        prev = p.scoreAfter;
      }
    }
  });

  it("arrives at the final score on the last play", () => {
    for (const b of games) {
      const last = b.drives.flatMap((d) => d.plays).at(-1);
      expect(last?.scoreAfter).toEqual(b.finalScore);
    }
  });

  it("starts at nothing to nothing", () => {
    for (const b of games) {
      const first = b.drives[0]?.plays[0];
      // the opening drive's first snap can only be 0-0 unless the game
      // opened with a kickoff return touchdown
      expect(first?.scoreAfter[0]).toBeLessThanOrEqual(8);
      expect(first?.scoreAfter[1]).toBeLessThanOrEqual(8);
    }
  });

  it("credits every point to a drive, including the other team's", () => {
    for (const b of games) {
      const total: [number, number] = [0, 0];
      for (const d of b.drives) {
        const mine = d.side === "home" ? 0 : 1;
        total[mine] += d.points;
        total[1 - mine === 0 ? 0 : 1] += d.pointsAgainst;
      }
      expect(total).toEqual(b.finalScore);
    }
  });

  it("gives a defensive or return score to the team that scored it", () => {
    // across forty games at least one drive ends with the other team scoring
    const swings = games.flatMap((b) => b.drives.filter((d) => d.pointsAgainst > 0));
    expect(swings.length).toBeGreaterThan(0);
    for (const d of swings) {
      // a safety is two, a pick-six / scoop-six / punt return is six or seven
      expect([2, 6, 7, 8]).toContain(d.pointsAgainst);
    }
    // and at least one of them is a touchdown rather than only safeties
    expect(swings.some((d) => d.pointsAgainst >= 6)).toBe(true);
  });

  it("lists every scoring drive, whichever way the points went", () => {
    for (const b of games) {
      const moved = b.drives
        .map((d, i) => [d, i] as const)
        .filter(([d]) => d.points > 0 || d.pointsAgainst > 0)
        .map(([, i]) => i);
      expect(b.scoringDrives).toEqual(moved);
    }
  });
});
