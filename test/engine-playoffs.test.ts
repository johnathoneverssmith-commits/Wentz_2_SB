import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import {
  finishPlayoffs,
  playPlayoffRound,
  playoffsComplete,
  simulatePlayoffs,
  startPlayoffs,
} from "../src/engine/playoffs.js";
import type { ConferenceSeeding } from "../src/engine/standings.js";

/**
 * Phase A1: the round-by-round playoff stepper the postseason UI drives. It must
 * produce exactly the same bracket as the one-shot `simulatePlayoffs` (which is
 * now defined as `finishPlayoffs(startPlayoffs(…))`).
 */

const mkSeeding = (teams: string[]): ConferenceSeeding => ({
  seeds: teams,
  divisionWinners: teams.slice(0, 4),
  wildCards: teams.slice(4),
});

const SEEDING = {
  AFC: mkSeeding(["KC", "BUF", "BAL", "HOU", "LAC", "PIT", "DEN"]),
  NFC: mkSeeding(["DET", "PHI", "TB", "LA", "MIN", "GB", "SEA"]),
};

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("playoff stepper", () => {
  it("emits 6 / 4 / 2 / 1 games across the four rounds", { timeout: 60_000 }, () => {
    let p = startPlayoffs(9, SEEDING);
    const sizes: number[] = [];
    const order: string[] = [];
    while (!playoffsComplete(p)) {
      order.push(p.nextRound as string);
      const step = playPlayoffRound(p);
      sizes.push(step.games.length);
      p = step.progress;
    }
    expect(order).toEqual(["wildcard", "divisional", "conference", "superbowl"]);
    expect(sizes).toEqual([6, 4, 2, 1]);
    expect(p.games).toHaveLength(13);
  });

  it("matches simulatePlayoffs exactly", { timeout: 180_000 }, () => {
    for (const seed of [1, 7, 42, 128]) {
      const oneShot = simulatePlayoffs(seed, SEEDING);
      const stepped = finishPlayoffs(startPlayoffs(seed, SEEDING));
      expect(stepped.games).toEqual(oneShot.games);
      expect(stepped.champion).toBe(oneShot.champion);
      expect(stepped.conferenceChampions).toEqual(oneShot.conferenceChampions);
      expect(stepped.runnerUp).toBe(oneShot.runnerUp);
    }
  });

  it("tracks the alive field down to one team per conference", { timeout: 60_000 }, () => {
    let p = startPlayoffs(3, SEEDING);
    expect(p.alive.AFC).toHaveLength(7);
    expect(p.alive.NFC).toHaveLength(7);

    p = playPlayoffRound(p).progress; // wild card
    expect(p.alive.AFC).toHaveLength(4);
    expect(p.alive.AFC[0]!.seed).toBe(1); // #1 seed always survives the bye

    p = playPlayoffRound(p).progress; // divisional
    expect(p.alive.AFC).toHaveLength(2);

    p = playPlayoffRound(p).progress; // conference
    expect(p.alive.AFC).toHaveLength(1);
    expect(p.alive.NFC).toHaveLength(1);

    const champA = p.alive.AFC[0]!.team;
    p = playPlayoffRound(p).progress; // super bowl
    expect(playoffsComplete(p)).toBe(true);
    const result = finishPlayoffs(p);
    expect(result.conferenceChampions.AFC).toBe(champA);
    expect([result.conferenceChampions.AFC, result.conferenceChampions.NFC]).toContain(
      result.champion,
    );
    expect(NFL_TEAMS).toContain(result.champion);
  });

  it("is a pure step and deterministic", { timeout: 60_000 }, () => {
    const p0 = startPlayoffs(55, SEEDING);
    const a = playPlayoffRound(p0);
    const b = playPlayoffRound(p0);
    expect(a.games).toEqual(b.games);
    expect(p0.games).toHaveLength(0); // input untouched
    expect(p0.nextRound).toBe("wildcard");
  });

  it("#1 seeds never play in the wild-card round", { timeout: 60_000 }, () => {
    const wc = playPlayoffRound(startPlayoffs(2, SEEDING)).games;
    expect(wc.every((g) => g.homeSeed !== 1 && g.awaySeed !== 1)).toBe(true);
    for (const g of wc) expect(g.homeSeed).toBeLessThan(g.awaySeed);
  });
});
