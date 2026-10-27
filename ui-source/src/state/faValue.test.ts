import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { positionValueWeight } from "./draftBoard.ts";
import { MIN_SIGNING_VALUE, MIN_SIGNING_VALUE_MIDSEASON, outlookFor, outlookRating, signingBar, signingValue, slotGain, youthPreference } from "./faValue.ts";
import { readTeamTimeline } from "./rules.ts";
import { beginFreeAgencyEvent, chooseFaMove, offerRoomFor } from "./freeAgencyEvent.ts";
import { useStore } from "./store.ts";
import { marketOfStage } from "./faValue.ts";
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

  it("keeps the mid-season market alive: a modest upgrade is bid on there, where the offseason's higher bar would pass on it", () => {
    expect(signingBar("midseason")).toBe(MIN_SIGNING_VALUE_MIDSEASON);
    expect(signingBar("offseason")).toBe(MIN_SIGNING_VALUE);
    expect(MIN_SIGNING_VALUE_MIDSEASON).toBeLessThan(MIN_SIGNING_VALUE);
    expect(marketOfStage("midseasonFreeAgency")).toBe("midseason");
    for (const stage of ["freeAgency", "offseasonFreeAgency", "regularSeason", "tradeDeadlineSummary"]) expect(marketOfStage(stage), stage).toBe("offseason");
    // a tackle three points over a good line: worth about four weighted points to the team, between the two bars
    const move = (market: "offseason" | "midseason", stage: string, record = true) => {
      const { s, code } = rigged(76, [{ position: "DT", overall: 73 }], { DT: [70, 70, 70, 70, 70] });
      s.stage = stage as never;
      if (record) s.freeAgencyEvent!.market = market;
      else delete s.freeAgencyEvent!.market;
      return chooseFaMove(s, code).kind;
    };
    expect(move("offseason", "freeAgency")).toBe("pass");
    expect(move("midseason", "midseasonFreeAgency")).toBe("offer");
    // the market the event was opened for decides, not the stage the league happens to report: the opening turns of the
    // mid-season market run while the league is still entering it
    expect(move("midseason", "tradeDeadlineSummary")).toBe("offer");
    expect(move("offseason", "midseasonFreeAgency")).toBe("pass");
  });

  it("reads the stage when an event has no market recorded, as in a save from before the field existed", () => {
    const move = (stage: string) => {
      const { s, code } = rigged(76, [{ position: "DT", overall: 73 }], { DT: [70, 70, 70, 70, 70] });
      s.stage = stage as never;
      delete s.freeAgencyEvent!.market;
      return chooseFaMove(s, code).kind;
    };
    expect(move("midseasonFreeAgency")).toBe("offer");
    expect(move("freeAgency")).toBe("pass");
  });

  it("records the market when an event opens: the one given, or else the stage's", () => {
    const { s } = market(77);
    expect(s.freeAgencyEvent!.market).toBe("offseason"); // the fixture's stage is freeAgency
    Object.assign(s, { freeAgencyEvent: null });
    beginFreeAgencyEvent(s, "midseason");
    expect(s.freeAgencyEvent!.market).toBe("midseason");
    Object.assign(s, { freeAgencyEvent: null, stage: "midseasonFreeAgency" });
    beginFreeAgencyEvent(s);
    expect(s.freeAgencyEvent!.market).toBe("midseason");
  });

  it("is deterministic: the same market gives the same choice, whoever asks", () => {
    const a = market(71);
    const b = market(71);
    expect(chooseFaMove(a.s, a.code)).toEqual(chooseFaMove(b.s, b.code));
  });
});

describe("the mid-season market opened through the real stage change", () => {
  it("has the CPU teams ahead of the first human bid at the mid-season bar, in the opening turns", async () => {
    // a league with rosters (the store's own starting league has none, and a team with no tackles would bid at any bar)
    await useStore.getState().newLeague(1470, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const st = useStore.getState();
    st.pickTeam(st.viewerGmId, "GB");
    useStore.setState((s) => {
      fillRosterGaps(s);
      for (const g of s.gms) if (g.id !== s.viewerGmId) g.isHuman = false;
      s.stage = "tradeDeadlineSummary";
      s.week = 9;
      // only one free agent is left, a tackle three points better than a line of seventies: worth about four
      // weighted points to every team, over the mid-season bar and under the offseason's
      const free = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
      free.slice(1).forEach((p) => {
        p.retired = true;
      });
      Object.assign(free[0]!, { position: "DT", overall: 73, age: 26 });
      for (const code of Object.keys(s.teams)) {
        s.teams[code]!.cap.total += 300; // room is not what this is about
        const mine = () => Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent);
        // this league is only partly rostered, and a team with fewer than five tackles would find the signing worth more
        // than the offseason bar through its thin depth alone: every team gets the same full line of seventies
        for (let guard = 0; guard < 60 && mine().filter((p) => p.position === "DT").length < 5; guard++) {
          const spare = mine().filter((p) => p.position !== "DT").sort((x, y) => x.overall - y.overall)[0];
          if (!spare) break;
          spare.position = "DT";
        }
        mine()
          .filter((p) => p.position === "DT")
          .forEach((p, i) => {
            p.overall = i < 5 ? 70 : 40;
          });
      }
    });
    useStore.getState().autoReadyNonViewers();
    useStore.getState().setReady(useStore.getState().viewerGmId, true);
    const moved = await useStore.getState().tryAdvance();
    expect(moved.moved).toBe(true);

    const s = useStore.getState();
    expect(s.stage).toBe("midseasonFreeAgency");
    const e = s.freeAgencyEvent!;
    expect(e.market).toBe("midseason");
    const lineOf = (code: string) => Object.values(s.players).filter((p) => p.nfl_team === code && p.position === "DT" && !p.retired && !p.free_agent).map((p) => p.overall);
    expect(lineOf(e.order[0]!), "the first team holds the full line it was given").toEqual([70, 70, 70, 70, 70]);
    const human = s.gms.find((g) => g.id === s.viewerGmId)!.teamCode;
    const ahead = e.order.slice(0, e.order.indexOf(human));
    expect(ahead.length, "the human is not first, so some CPU teams act before them").toBeGreaterThan(0);
    // The team first in the order holds the line every team was given, so the tackle is worth about four weighted points
    // to it: over the mid-season bar and under the offseason's. It acts before any human, while the league is still
    // entering the stage, so it bids only if the bar follows the market the event was opened for and not the stage.
    // (Teams with no tackles at all would bid at any bar, so they are not the evidence; and a bid war ends after about
    // nine bids, so only the first team is asked.)
    const firstBidders = new Set(Object.values(e.offers).flat().map((o) => o.teamCode));
    expect(firstBidders.has(e.order[0]!), `the first team in the order (${e.order[0]}) bid`).toBe(true);
  }, 120_000);
});

describe("the team's window in the market (timeline-aware targeting)", () => {

  it("reads no outlook where no timeline was recorded: ratings are taken as they are", () => {
    expect(outlookFor(undefined, 0.7)).toBeNull();
    expect(outlookRating({ position: "WR", overall: 80, age: 35 }, null)).toBe(80);
  });

  it("looks no seasons ahead for a contender, a few for a rebuild, and moves a veteran's rating by age only over that horizon", () => {
    const contender = outlookFor(1, 1)!;
    const middle = outlookFor(0, 1)!;
    const rebuild = outlookFor(-1, 1)!;
    expect(contender.horizon).toBeLessThan(middle.horizon);
    expect(middle.horizon).toBeLessThan(rebuild.horizon);
    expect(contender.rebuild).toBe(0);
    expect(middle.rebuild).toBe(0);
    expect(rebuild.rebuild).toBe(1);
    const vet = { position: "CB" as const, overall: 80, age: 32 };
    expect(outlookRating(vet, contender)).toBe(80); // a contender reads him as he is
    expect(outlookRating(vet, rebuild)).toBeLessThan(outlookRating(vet, middle));
    expect(outlookRating(vet, middle)).toBeLessThan(80);
    // a young player gains with the horizon: a rebuild sees more of it
    const kid = { position: "WR" as const, overall: 70, age: 22 };
    expect(outlookRating(kid, rebuild)).toBeGreaterThan(outlookRating(kid, middle));
    expect(outlookRating(kid, middle)).toBeGreaterThan(70);
    // a GM who plans less far (a lower long-term weight) reads the same player less far ahead
    expect(outlookRating(vet, outlookFor(-1, 0.45))!).toBeGreaterThan(outlookRating(vet, rebuild));
  });

  it("gives a youth preference to a rebuild alone, takes none away from a one-year veteran, and keeps a young player's preference on any length", () => {
    const rebuild = outlookFor(-1, 1)!;
    const young = { position: "WR" as const, age: 23 };
    const old = { position: "WR" as const, age: 33 };
    expect(youthPreference(young, rebuild, false)).toBeGreaterThan(0);
    expect(youthPreference(young, rebuild, true)).toBe(youthPreference(young, rebuild, false));
    expect(youthPreference(old, rebuild, false)).toBeLessThan(0);
    expect(youthPreference(old, rebuild, true)).toBe(0);
    for (const o of [outlookFor(1, 1), outlookFor(0, 1), null]) {
      expect(youthPreference(young, o, false)).toBe(0);
      expect(youthPreference(old, o, false)).toBe(0);
    }
    // it is priced like the rest of the value: a kicker's point is worth a fraction of a receiver's
    expect(Math.abs(youthPreference({ position: "K", age: 23 }, rebuild, false))).toBeLessThan(youthPreference(young, rebuild, false));
    // and it is modest: a two-year age difference does not outweigh a few points of rating
    expect(youthPreference(young, rebuild, false)).toBeLessThan(MIN_SIGNING_VALUE);
  });

  it("records every team's window when the market opens, and keeps it as the rosters change", () => {
    const { s } = market(81);
    const e = s.freeAgencyEvent!;
    const window = e.timeline!;
    expect(Object.keys(window).sort()).toEqual(Object.keys(s.teams).sort());
    expect(Object.fromEntries(readTeamTimeline(s))).toEqual(window);
    const values = Object.values(window);
    expect(Math.min(...values), "windows span rebuilding to contending").toBeLessThan(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
    const before = structuredClone(window);
    // the league moves under the event: a team's record and its roster both change, as a round of signings changes the roster
    for (const t of Object.values(s.teams)) {
      t.wins = 0;
      t.losses = 17;
    }
    for (const p of Object.values(s.players)) if (!p.retired && !p.free_agent) p.overall = Math.max(40, p.overall - 15);
    expect(chooseFaMove(s, e.order[0]!)).toBeDefined();
    expect(s.freeAgencyEvent!.timeline).toEqual(before);
  });

  /** two receivers a team's lineup needs: the older is the better player now */
  function twoReceivers(seed: number, timeline: number | "unrecorded"): number {
    const { s, code } = rigged(seed, [{ position: "WR", overall: 81 }, { position: "WR", overall: 78 }], { WR: [60, 55, 50] });
    const [older, younger] = Object.values(s.players).filter((p) => p.free_agent && !p.retired).sort((a, b) => b.overall - a.overall);
    older!.age = 32;
    younger!.age = 24;
    if (timeline === "unrecorded") delete s.freeAgencyEvent!.timeline;
    else s.freeAgencyEvent!.timeline![code] = timeline;
    const m = chooseFaMove(s, code);
    expect(m.kind).toBe("offer");
    return s.players[(m as { playerId: string }).playerId]!.age;
  }

  it("has a contender sign the better player now, and a rebuilding team the younger one, between two close free agents", () => {
    expect(twoReceivers(82, 1)).toBe(32);
    expect(twoReceivers(82, -1)).toBe(24);
  });

  it("chooses as before for a team whose event has no window recorded, as in a save from before it was recorded", () => {
    expect(twoReceivers(82, "unrecorded")).toBe(32);
    const { s, code } = rigged(82, [{ position: "WR", overall: 81 }], { WR: [60, 55, 50] });
    delete s.freeAgencyEvent!.timeline;
    expect(() => chooseFaMove(s, code)).not.toThrow();
  });

  it("compares a free agent with the incumbents on the same footing: a lineup of aging starters is worth less to a team that looks ahead, and a save from before windows read it as it is", () => {
    // an 87 against a room of 84s who are 36: a three-point upgrade on today's ratings, under the bar,
    // but more than that once the veterans are read a season on (and more again by a team looking three seasons on)
    const offered = (timeline: number | "unrecorded") => {
      const { s, code } = rigged(85, [{ position: "WR", overall: 87 }], { WR: [84, 84, 84, 84, 84, 84, 84, 84] });
      for (const p of Object.values(s.players)) if (p.nfl_team === code && p.position === "WR" && !p.retired && !p.free_agent && p.overall === 84) p.age = 36;
      if (timeline === "unrecorded") delete s.freeAgencyEvent!.timeline;
      else s.freeAgencyEvent!.timeline![code] = timeline;
      return chooseFaMove(s, code).kind;
    };
    expect(offered("unrecorded")).toBe("pass");
    expect(offered(0)).toBe("offer");
    expect(offered(-1)).toBe("offer");
  });

  it("keeps a rebuild's youth preference from making a signing that is under the bar worth bidding on", () => {
    // a young tackle three points over a good line: four points to every team, under the offseason's bar
    const { s, code } = rigged(83, [{ position: "DT", overall: 73 }], { DT: [70, 70, 70, 70, 70] });
    Object.values(s.players).find((p) => p.free_agent && !p.retired)!.age = 22;
    s.freeAgencyEvent!.timeline![code] = -1;
    expect(chooseFaMove(s, code).kind).toBe("pass");
  });

  it("is deterministic with windows: the same market gives the same choice for every team", () => {
    const a = market(84).s;
    const b = market(84).s;
    for (const code of a.freeAgencyEvent!.order.slice(0, 8)) expect(chooseFaMove(a, code)).toEqual(chooseFaMove(b, code));
  });
});
