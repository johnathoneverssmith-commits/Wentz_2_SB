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
        expect(["pass", "run", "sack", "scramble"]).toContain(p.call);
      }
      // the drive's `ended` matches its last play
      const last = d.plays[d.plays.length - 1]!;
      if (last.touchdown) expect(d.ended).toBe("touchdown");
      else if (last.turnover) expect(d.ended).toBe("turnover");
    }
  });

  it("scoringDrives point only at touchdown possessions", () => {
    expect(b.scoringDrives.length).toBeGreaterThan(0);
    for (const i of b.scoringDrives) {
      expect(b.drives[i]!.ended).toBe("touchdown");
      expect(b.drives[i]!.plays.some((p) => p.touchdown)).toBe(true);
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
