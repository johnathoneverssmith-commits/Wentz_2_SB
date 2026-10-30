import { describe, expect, it } from "vitest";

import { setQbEffect } from "../src/engine/ratings.js";
import { Roster, roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { teamStaff } from "../src/engine/staff-data.js";
import type { Player } from "../src/schema/player.js";

/**
 * The scaled quarterback effect (`setQbEffect`): experimental and off by default.
 *
 * Off must be the engine exactly as it was (and switching it on and back off must not leave anything cached behind);
 * on, a quarterback's rating moves completion and interception rates less, but still moves them.
 */
const PROPOSED = { complete: 0.5, interception: 0.45, arm: 0.25 };

function fingerprint(): string {
  let h = 0x811c9dc5;
  for (const t of [1, 1.5, 2]) {
    for (let s = 1; s <= 40; s++) {
      const g = simulateGame(s, "KC", "BUF", {
        homeRoster: roster("KC"), awayRoster: roster("BUF"), trace: true, injuries: true, talentScale: t, overtime: "nfl",
        homeStaff: teamStaff("KC")!, awayStaff: teamStaff("BUF")!,
      });
      for (const x of [g.score[0]!, g.score[1]!, g.playTrace!.length]) {
        h ^= x | 0;
        h = Math.imul(h, 0x01000193);
      }
    }
  }
  return (h >>> 0).toString(16);
}

describe("quarterback effect: off", () => {
  it("is the engine as it was, and switching it on and off again leaves no trace", () => {
    setQbEffect(null);
    const before = fingerprint();
    // recorded with the setting absent from the engine (franchise options, three talent levels)
    expect(before).toBe("4b5c61c3");
    setQbEffect(PROPOSED);
    expect(fingerprint(), "on is a different game").not.toBe(before);
    setQbEffect({ complete: 1, interception: 1, arm: 0 });
    expect(fingerprint(), "the identity setting is the engine as it was").toBe(before);
    setQbEffect(PROPOSED);
    setQbEffect(null);
    expect(fingerprint(), "caches rebuilt after switching off").toBe(before);
  }, 240_000);
});

describe("quarterback effect: on", () => {
  /** Seattle's passing line with the quarterback's every attribute shifted by `delta`, over every opponent home and away. */
  function line(delta: number) {
    const base = roster("SEA");
    const qb0 = base.depth.get("QB")![0]!;
    const attrs: Record<string, number> = {};
    for (const [k, v] of Object.entries(qb0.attributes ?? {})) attrs[k] = typeof v === "number" ? Math.max(1, Math.min(99, v + delta)) : (v as never);
    const q = { ...qb0, id: `${qb0.id}~${delta}`, overall: Math.max(1, Math.min(99, (qb0.overall ?? 0) + delta)), attributes: attrs } as Player;
    const players: Player[] = [q];
    for (const [pos, ps] of base.depth) if (pos !== "QB") players.push(...ps);
    const mine = new Roster("SEA", players);
    const t = { att: 0, cmp: 0, int: 0 };
    let k = 0;
    for (const o of ["KC", "BUF", "PHI", "DET", "BAL", "NO", "TEN", "CAR", "NYG", "DAL", "SF", "GB"]) {
      for (const home of [true, false]) {
        for (let rep = 0; rep < 8; rep++) {
          const seed = 31_000 + rep * 101 + k++;
          const h = home ? "SEA" : o;
          const a = home ? o : "SEA";
          const g = simulateGame(seed, h, a, { homeRoster: home ? mine : roster(o), awayRoster: home ? roster(o) : mine, talentScale: 1, overtime: "nfl", homeStaff: teamStaff(h)!, awayStaff: teamStaff(a)! });
          const s = g.teams[home ? 0 : 1]!.s as Record<string, number>;
          t.att += s.pass_att ?? 0; t.cmp += s.completion ?? 0; t.int += s.int_thrown ?? 0;
        }
      }
    }
    return { cmp: t.cmp / t.att, int: t.int / t.att };
  }
  const gap = () => {
    const hi = line(10), lo = line(-10);
    return { cmp: hi.cmp - lo.cmp, int: lo.int - hi.int };
  };

  it("a good quarterback still completes more and throws fewer interceptions, by clearly less than before", () => {
    setQbEffect(null);
    const off = gap();
    setQbEffect(PROPOSED);
    const on = gap();
    setQbEffect(null);
    expect(off.cmp).toBeGreaterThan(0.06);
    expect(on.cmp, "completion gap kept").toBeGreaterThan(0.02);
    expect(on.cmp, "completion gap shrunk").toBeLessThan(off.cmp * 0.8);
    expect(on.int, "interception gap kept").toBeGreaterThan(0.004);
    expect(on.int, "interception gap shrunk").toBeLessThan(off.int * 0.8);
  }, 240_000);
});
