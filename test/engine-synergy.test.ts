import { describe, expect, it } from "vitest";

import type { Player } from "../src/schema/player.js";
import { withPlayoffRosters, decidePlayoffGame } from "../src/engine/playoffs.js";
import { loadPool, Roster, roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { pairJ, referenceScores, unitScores } from "../src/engine/synergy.js";

/**
 * Position-group synergy (`src/engine/synergy.ts`).
 *
 * These pin the *shape* of the effect rather than its size — the size is
 * calibrated in `analysis/33_synergy.ts` against real-world extremes and may
 * be retuned. What must not change is that it is synergistic: a complete
 * unit is worth more than the sum of its parts, and a weak link costs more
 * than his share.
 */

const everyone: Player[] = [...loadPool().values()].flat();
const byPos = (pos: string): Player[] =>
  everyone.filter((p) => p.position === pos).sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
let n = 0;
const clone = (p: Player): Player => ({ ...p, id: `${p.id}__t${n++}` });

/** A reference team with the given positions' starters replaced. */
function variant(base: string, starters: Record<string, Player[]>): Roster {
  const players = [...loadPool().get(base)!];
  const order: Record<string, string[]> = {};
  for (const [pos, list] of Object.entries(starters)) {
    const c = list.map(clone);
    players.push(...c);
    order[pos] = c.map((p) => p.id);
  }
  return new Roster(base, players, order);
}

const BASE = teamList()[10]!;
const OPP = roster(teamList()[20]!);
const off = (r: Roster) => unitScores(r.offense(), OPP.defense());
const def = (r: Roster) => unitScores(OPP.offense(), r.defense());

describe("the pairwise term", () => {
  it("is symmetric", () => {
    expect(pairJ(2, -1)).toBe(pairJ(-1, 2));
  });
  it("is superadditive when both are good, and nothing when one is average", () => {
    expect(pairJ(2, 2)).toBeGreaterThan(pairJ(2, 0) + pairJ(0, 2));
    expect(pairJ(2, 0)).toBe(0);
  });
  it("drags a good player down next to a bad one, and compounds two bad ones", () => {
    expect(pairJ(2, -1)).toBeLessThan(0);
    expect(pairJ(-2, -1)).toBeLessThan(0);
    expect(pairJ(-2, -2)).toBeLessThan(pairJ(-1, -1));
  });
});

describe("centring", () => {
  it("nets an ordinary NFL roster to about zero", () => {
    // every term's mean over the 32 reference teams is subtracted, so the
    // average team against the average defence moves nothing
    const ref = referenceScores();
    const teams = teamList();
    const sums: Record<string, number> = {};
    for (const t of teams) {
      const s = unitScores(roster(t).offense(), roster(t).defense());
      for (const [k, v] of Object.entries(s)) sums[k] = (sums[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(sums)) {
      // the rush-vs-protection matchup reads both teams, and is centred over
      // every pair of *different* teams — checked separately below
      if (k === "pressure") continue;
      expect(Math.abs(v / teams.length), `${k} mean (ref ${ref[k as keyof typeof ref]})`).toBeLessThan(1e-9);
    }
  });

  it("nets the average matchup between two different teams to about zero", () => {
    const teams = teamList();
    let sum = 0;
    let n = 0;
    for (const a of teams) {
      for (const b of teams) {
        if (a === b) continue;
        sum += unitScores(roster(a).offense(), roster(b).defense()).pressure;
        n++;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(1e-9);
  });
});

describe("offensive line", () => {
  const [ot1, ot2] = byPos("OT");
  const [og1, og2] = byPos("OG");
  const [c1] = byPos("C");
  const badOg = byPos("OG").at(-1)!;
  const five = variant(BASE, { OT: [ot1!, ot2!], OG: [og1!, og2!], C: [c1!] });
  const three = variant(BASE, { OT: [ot1!, ot2!], C: [c1!] });
  const holed = variant(BASE, { OT: [ot1!, ot2!], OG: [badOg, og2!], C: [c1!] });

  it("rewards the complete unit well beyond the partial one", () => {
    const base = off(roster(BASE)).passPro;
    const gainFive = off(five).passPro - base;
    const gainThree = off(three).passPro - base;
    // five elite linemen are more than 5/3 of three elite linemen's gain
    expect(gainFive).toBeGreaterThan((5 / 3) * gainThree);
  });

  it("lets one bad lineman sink four good ones below three good ones", () => {
    expect(off(holed).passPro).toBeLessThan(off(three).passPro);
  });

  it("finally reaches the run game", () => {
    // the fitted run model ignored the line entirely; this is that channel
    expect(off(five).runBlockLinear).toBeGreaterThan(off(roster(BASE)).runBlockLinear);
    expect(off(five).runBlock).toBeGreaterThan(off(roster(BASE)).runBlock);
  });
});

describe("pass rush", () => {
  it("makes two great edges more than twice one great edge", () => {
    const [e1, e2] = byPos("EDGE");
    const base = variant(BASE, {});
    const d0 = def(base).passRush;
    const one = def(variant(BASE, { EDGE: [e1!, base.defense().EDGE2!] })).passRush - d0;
    const two = def(variant(BASE, { EDGE: [e1!, e2!] })).passRush - d0;
    expect(two).toBeGreaterThan(2 * one);
  });

  it("wastes a great edge next to a bad one", () => {
    const [e1] = byPos("EDGE");
    const bad = byPos("EDGE").at(-1)!;
    const base = def(variant(BASE, {})).passRush;
    expect(def(variant(BASE, { EDGE: [e1!, bad] })).passRush).toBeLessThan(base);
  });
});

describe("rush against protection", () => {
  it("compounds: a great rush against a bad line is worse than the two gaps summed", () => {
    const worstLine = variant(BASE, {
      OT: byPos("OT").slice(-2),
      OG: byPos("OG").slice(-2),
      C: byPos("C").slice(-1),
    });
    const ownLine = variant(BASE, {});
    const oppBase = teamList()[20]!;
    const eliteRush = variant(oppBase, { EDGE: byPos("EDGE").slice(0, 2) });
    const ownRush = variant(oppBase, {});
    const p = (o: Roster, d: Roster) => unitScores(o.offense(), d.defense()).pressure;
    const interaction = p(worstLine, eliteRush) - p(worstLine, ownRush) - p(ownLine, eliteRush) + p(ownLine, ownRush);
    expect(interaction).toBeGreaterThan(0);
    expect(p(worstLine, eliteRush)).toBeGreaterThan(p(ownLine, ownRush));
  });
});

describe("quarterback and receivers", () => {
  const qbGreat = byPos("QB")[0]!;
  const qbBad = byPos("QB").at(-1)!;
  const wrGreat = byPos("WR")[0]!;
  const wrBad = byPos("WR").at(-1)!;
  const pair = (qb: Player, wr: Player) => off(variant(BASE, { QB: [qb], WR: [wr] })).qbReceivers;

  it("lets a great receiver lift a great quarterback", () => {
    expect(pair(qbGreat, wrGreat)).toBeGreaterThan(pair(qbGreat, wrBad));
  });

  it("lets a horrible quarterback tank a great receiver", () => {
    expect(pair(qbBad, wrGreat)).toBeLessThan(0);
    expect(pair(qbBad, wrGreat)).toBeLessThan(pair(qbGreat, wrGreat));
  });
});

describe("pool-free paths", () => {
  it("are untouched: a rosterless game never reads synergy", () => {
    // `simulateGame(seed)` has no rosters and so no rating layer; it must be
    // byte-identical whatever synergy does
    const a = simulateGame(4242);
    const b = simulateGame(4242);
    expect(a.score).toEqual(b.score);
    expect(a.teams[0].s.plays).toBe(b.teams[0].s.plays);
  });
});

describe("playoff games", () => {
  it("play the rosters they are given, not the reference NFL teams", () => {
    const [h, a] = [teamList()[0]!, teamList()[1]!];
    // a home team stripped to the worst player at every position loses far
    // more than the real one does; if the rosters were ignored the two
    // records would be identical
    const worst: Record<string, Player[]> = {};
    for (const pos of ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "ILB", "CB", "S"]) {
      worst[pos] = byPos(pos).slice(-3);
    }
    const weak = variant(h, worst);
    let realWins = 0;
    let weakWins = 0;
    for (let k = 0; k < 40; k++) {
      const seed = 1000 + k * 7;
      if (decidePlayoffGame(seed, h, a, false).winner === h) realWins++;
      const w = withPlayoffRosters({ [h]: weak, [a]: roster(a) }, () => decidePlayoffGame(seed, h, a, false));
      if (w.winner === h) weakWins++;
    }
    expect(weakWins).toBeLessThan(realWins);
  }, 120_000);
});
