import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { positionValueWeight } from "./draftBoard.ts";
import { MIN_SIGNING_VALUE, signingValue, slotGain } from "./faValue.ts";
import { beginFreeAgencyEvent, chooseFaMove, offerRoomFor } from "./freeAgencyEvent.ts";
import { DEFAULT_CONFIG, createLeague, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";

/**
 * What a free agent is worth to a CPU team's lineup (`faValue.ts`): the slot he would fill, priced by what a
 * rating point at his position is worth, with players the team has already bid on counted as on the roster.
 */

describe("the slot a signing fills", () => {
  it("is the gain over the weakest starter, not over the best player at the position", () => {
    // three starting receivers: 90, 85, 60. A 75 does not beat the best, but he takes the third slot.
    expect(slotGain(75, "WR", [90, 85, 60, 50])).toBeGreaterThan(14);
    // a 75 behind three better ones adds nothing to the lineup (and little to the reserves)
    expect(slotGain(75, "WR", [90, 85, 80, 78, 77, 76])).toBe(0);
  });
  it("sees the second slot of a two-starter position", () => {
    expect(slotGain(82, "OT", [90, 70, 60])).toBeGreaterThanOrEqual(12);
    expect(slotGain(82, "OT", [90, 85, 60])).toBeLessThan(slotGain(82, "OT", [90, 70, 60]));
  });
  it("treats a vacant starting slot as worth filling with almost anyone", () => {
    expect(slotGain(60, "QB", [])).toBeGreaterThan(15);
  });
  it("counts a better reserve only a little", () => {
    const withReserveHelp = slotGain(70, "RB", [90, 50, 45, 40]);
    const noHelp = slotGain(70, "RB", [90, 75, 74, 73]);
    expect(withReserveHelp).toBeGreaterThan(noHelp);
    expect(withReserveHelp).toBeLessThan(6);
  });
});

describe("what a point at a position is worth", () => {
  it("runs from a kicker or punter, worth a fraction of a starter's point, to a quarterback, worth about twice", () => {
    expect(positionValueWeight("K")).toBeLessThan(0.5);
    expect(positionValueWeight("P")).toBeLessThan(0.5);
    expect(positionValueWeight("QB")).toBeGreaterThan(1.7);
    expect(positionValueWeight("QB")).toBeLessThanOrEqual(2);
    for (const pos of ["WR", "OT", "CB", "EDGE", "S", "DT", "OG", "C", "ILB", "TE", "RB"] as const) {
      expect(positionValueWeight(pos), pos).toBeGreaterThan(0.8);
      expect(positionValueWeight(pos), pos).toBeLessThan(1.6);
    }
  });
  it("keeps a sixteen-point kicker upgrade from outranking a real starter upgrade", () => {
    const kicker = signingValue(86, "K", [70]);
    const guard = signingValue(80, "OG", [85, 70, 62]);
    expect(kicker).toBeLessThan(guard);
    // and a lone modest kicker upgrade is below the bar to bid at all, where a lineup upgrade is not
    expect(signingValue(76, "K", [70])).toBeLessThan(MIN_SIGNING_VALUE);
    expect(guard).toBeGreaterThan(MIN_SIGNING_VALUE);
  });
});

const built = new Map<number, LeagueState>();
function market(seed: number): { s: LeagueState; code: string } {
  let base = built.get(seed);
  if (!base) {
    base = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(base);
    for (const g of base.gms) g.isHuman = false;
    for (const t of Object.values(base.teams)) t.controlledBy = { kind: "ai" };
    base.stage = "freeAgency";
    for (const p of Object.values(base.players)) {
      if (!p.retired && !p.free_agent && p.contract && p.contract.years_remaining <= 0) {
        p.free_agent = true;
        p.nfl_team = "FA";
        p.contract = null as never;
      }
    }
    recomputeTeamRatings(base);
    built.set(seed, base);
  }
  const s = structuredClone(base);
  Object.assign(s, { freeAgencyEvent: null });
  beginFreeAgencyEvent(s);
  return { s, code: s.freeAgencyEvent!.order[0]! };
}

describe("a CPU team's choice in the market", () => {
  it("does not bid twice for the same slot: a player it has already bid on fills it for the next bid", () => {
    const { s, code } = market(71);
    const first = chooseFaMove(s, code);
    expect(first.kind).toBe("offer");
    const target = s.players[(first as { playerId: string }).playerId]!;
    // pretend the bid is out, then ask what else it wants at that position: it must not be a player who would take the same slot for less
    s.freeAgencyEvent!.offers[target.id] = [{ teamCode: code, salary: 5, years: 3, round: 1, sequence: 0 }];
    const again = chooseFaMove(s, code);
    if (again.kind === "offer" && again.playerId !== target.id) {
      const other = s.players[again.playerId]!;
      const roster = Object.values(s.players).filter((p: Player) => p.nfl_team === code && p.position === other.position && !p.retired && !p.free_agent).map((p) => p.overall);
      const alone = signingValue(other.overall, other.position, roster);
      const withBid = signingValue(other.overall, other.position, other.position === target.position ? [...roster, target.overall] : roster);
      expect(withBid).toBeLessThanOrEqual(alone);
    }
  });

  it("rarely signs a kicker or punter: a market's worth of turns leaves them a small share", () => {
    let specialists = 0;
    let offers = 0;
    for (const seed of [71, 72]) {
      const { s } = market(seed);
      for (const code of s.freeAgencyEvent!.order) {
        const m = chooseFaMove(s, code);
        if (m.kind !== "offer") continue;
        offers++;
        const p = s.players[m.playerId]!;
        if (p.position === "K" || p.position === "P") specialists++;
      }
    }
    expect(offers).toBeGreaterThan(20);
    expect(specialists / offers).toBeLessThan(0.15);
  });

  /**
   * A market with only the free agents given, and a team whose players at those positions are set to the ratings given:
   * so exactly one choice is right, and the old rule (gain over the team's best at the position) has a different one.
   */
  function rigged(seed: number, free: { position: Player["position"]; overall: number }[], team: Record<string, number[]>): { s: LeagueState; code: string } {
    const { s, code } = market(seed);
    s.teams[code]!.cap.total += 300; // room is not what this is about (PR A's cap-room rule is tested on its own)
    const pool = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
    pool.slice(free.length).forEach((p) => {
      p.retired = true;
    });
    pool.slice(0, free.length).forEach((p, i) => {
      p.position = free[i]!.position;
      p.overall = free[i]!.overall;
      p.age = 26;
    });
    for (const [pos, ratings] of Object.entries(team)) {
      const mine = Object.values(s.players).filter((p) => p.nfl_team === code && p.position === pos && !p.retired && !p.free_agent);
      mine.forEach((p, i) => {
        p.overall = ratings[i] ?? 40;
      });
    }
    return { s, code };
  }

  it("takes the lineup upgrade over a bigger raw kicker upgrade", () => {
    const { s, code } = rigged(73, [{ position: "K", overall: 86 }, { position: "OG", overall: 82 }], { K: [70], OG: [80, 72, 50, 50] });
    const move = chooseFaMove(s, code);
    expect(move.kind).toBe("offer");
    // the kicker is +16 over his team's kicker and the guard only +10 over his weakest starter, but a point at guard is worth three of a kicker's
    expect(s.players[(move as { playerId: string }).playerId]!.position).toBe("OG");
  });

  it("does not move on to a second player at a one-starter position once it has bid on the first: the bid fills the slot", () => {
    const { s, code } = rigged(73, [{ position: "QB", overall: 95 }, { position: "QB", overall: 94 }], { QB: [60, 55, 50] });
    const qbs = Object.values(s.players).filter((p) => p.free_agent && !p.retired).sort((x, y) => x.overall - y.overall);
    const bidOn = qbs[0]!; // the 94
    const better = qbs[1]!; // the 95, who would be the pick on a clean slate
    expect(chooseFaMove(s, code)).toMatchObject({ kind: "offer", playerId: better.id });
    s.freeAgencyEvent!.offers[bidOn.id] = [{ teamCode: code, salary: 5, years: 3, round: 1, sequence: 0 }];
    // with the 94 already bid on, the 95 would add one point over him: the team stays with its bid
    const again = chooseFaMove(s, code);
    expect(again.kind === "offer" ? again.playerId : bidOn.id).toBe(bidOn.id);
  });

  it("never lets a GM's taste make an unworthwhile signing worth bidding on: identity chooses among signings, it does not create them", () => {
    // a tackle worth about five weighted points to a team that already starts good ones: under the bar for everyone
    for (const strategy of ["defense_heavy", "pass_heavy", "trenches_first", "high_ceiling"] as const) {
      const { s, code } = rigged(74, [{ position: "DT", overall: 74 }], { DT: [70, 70, 70, 70, 70] });
      s.aiGms!.find((g) => g.teamCode === code)!.strategy = strategy;
      expect(chooseFaMove(s, code).kind, strategy).toBe("pass");
    }
  });

  it("keeps a little of its room back when it bids: a team whose room only just covers the bid passes, one with a cushion over it offers", () => {
    const first = rigged(75, [{ position: "WR", overall: 85 }], { WR: [60, 55, 50] });
    const asked = chooseFaMove(first.s, first.code) as { kind: "offer"; salary: number };
    expect(asked.kind).toBe("offer");
    const withRoom = (room: number) => {
      const { s, code } = rigged(75, [{ position: "WR", overall: 85 }], { WR: [60, 55, 50] });
      s.teams[code]!.cap.total += room - offerRoomFor(s, code);
      expect(offerRoomFor(s, code)).toBeCloseTo(room, 5);
      return chooseFaMove(s, code).kind;
    };
    // the bid exactly covered by the room: the cushion says no
    expect(withRoom(asked.salary)).toBe("pass");
    expect(withRoom(asked.salary + 1)).toBe("pass");
    // two million more than the bid: yes
    expect(withRoom(asked.salary + 2.5)).toBe("offer");
  });

  it("is deterministic: the same market gives the same choice, whoever asks", () => {
    const a = market(71);
    const b = market(71);
    expect(chooseFaMove(a.s, a.code)).toEqual(chooseFaMove(b.s, b.code));
  });
});
