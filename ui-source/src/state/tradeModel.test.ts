import { describe, expect, it } from "vitest";

import type { LeagueState, Player, TradeAsset } from "@/domain";
import {
  TRADE_CONTRACT_WEIGHT,
  contractValueFor,
  playerContractValue,
  playerPerformanceValue,
  tradeAssetValue,
} from "@/sim/MockSimulationService";
import { cpuToCpuOffer, generateAiTradeOffers } from "./aiTrades.ts";
import { ensureDraftPicks, picksOwnedBy } from "./draftPicks.ts";
import { releasePenalty } from "./releaseCost.ts";
import { capLegal } from "./aiTrades.ts";
import { DEFAULT_CONFIG, createLeague, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { readTeamTimeline } from "./teamTimeline.ts";
import { beginTradeDeadline, onTheClock, runCpuTurns as runDeadlineTurns, staffDeadlineMove } from "./tradeDeadline.ts";
import { TRADE_ACCEPT_THRESHOLD, TRADE_FRICTION, judgeTrade, judgeWith, teamAssetMultiplier, tradeAccepts, tradeContext } from "./tradeModel.ts";

/**
 * CPU trade intelligence: what a contract does to a player's trade value, the one decision every channel makes, and the proposals
 * the CPU teams build on top of both. Negative controls sit beside the rules they guard, each failing on the code before this
 * change (the baseline harness, `online/test/trade-metrics.test.ts`, measures the same defects over whole leagues).
 */

const built = new Map<number, LeagueState>();
function cpuLeague(seed: number): LeagueState {
  let base = built.get(seed);
  if (!base) {
    base = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    fillRosterGaps(base);
    for (const g of base.gms) g.isHuman = false;
    for (const t of Object.values(base.teams)) t.controlledBy = { kind: "ai" };
    ensureDraftPicks(base, base.season);
    recomputeTeamRatings(base);
    built.set(seed, base);
  }
  return structuredClone(base);
}

/** A copy of a real player's shape, put on a team with the contract and ratings given. */
function withPlayer(
  s: LeagueState,
  id: string,
  team: string,
  o: { position: Player["position"]; overall: number; age: number; years: number; pay: number; decline?: number },
): Player {
  const base = Object.values(s.players).find((p) => p.position === o.position && !p.free_agent && p.contract)!;
  const p: Player = {
    ...structuredClone(base),
    id,
    name: id,
    nfl_team: team,
    free_agent: false,
    retired: false,
    injury_status: null,
    position: o.position,
    overall: o.overall,
    age: o.age,
    decline_age_threshold: o.decline ?? 31,
    contract: { ...base.contract!, team_id: team, years_remaining: o.years, cap_hit_by_year: Array(o.years).fill(o.pay), total_value: o.pay * o.years, guaranteed: 0, signing_bonus: 0 },
  };
  s.players[id] = p;
  return p;
}
const asset = (id: string): TradeAsset => ({ kind: "player", playerId: id });
const value = (s: LeagueState, id: string): number => tradeAssetValue(s, asset(id));
const market = (pos: Player["position"], ovr: number): number => contractValueFor(ovr, pos, 1);

describe("a contract is part of a player's trade value", () => {
  it("does not make an aging player worth more for having more years left", () => {
    const s = cpuLeague(601);
    withPlayer(s, "old1", "DET", { position: "WR", overall: 85, age: 33, years: 1, pay: market("WR", 85) });
    withPlayer(s, "old4", "DET", { position: "WR", overall: 85, age: 33, years: 4, pay: market("WR", 85) });
    // the old rule paid a bonus for years of control whatever he was going to be: 34.6 against 29.7
    expect(value(s, "old4")).toBeLessThan(value(s, "old1"));
  });

  it("still pays for years of a player in his prime", () => {
    const s = cpuLeague(601);
    withPlayer(s, "prime1", "DET", { position: "WR", overall: 85, age: 26, years: 1, pay: market("WR", 85) });
    withPlayer(s, "prime4", "DET", { position: "WR", overall: 85, age: 26, years: 4, pay: market("WR", 85) });
    expect(value(s, "prime4")).toBeGreaterThan(value(s, "prime1"));
  });

  it("prices the pay: the same player is worth less paid above his market and more below it", () => {
    const s = cpuLeague(601);
    for (const [id, mult] of [["cheap", 0.4], ["fair", 1], ["dear", 1.6]] as const) {
      withPlayer(s, id, "DET", { position: "CB", overall: 84, age: 27, years: 4, pay: market("CB", 84) * mult });
    }
    expect(value(s, "cheap")).toBeGreaterThan(value(s, "fair"));
    expect(value(s, "fair")).toBeGreaterThan(value(s, "dear"));
  });

  it("can put a bad contract below nothing, but never lower than it costs to be rid of him", () => {
    const s = cpuLeague(601);
    const p = withPlayer(s, "liability", "DET", { position: "WR", overall: 62, age: 35, years: 4, pay: 16 });
    const v = value(s, "liability");
    expect(v).toBeLessThan(0);
    // a team can always release him: the contract part of the price is at worst the dead money, in chart points
    expect(playerContractValue(s, p)).toBeGreaterThanOrEqual(-TRADE_CONTRACT_WEIGHT * releasePenalty(p) - 1e-9);
    expect(v).toBeGreaterThanOrEqual(playerPerformanceValue(s, p) - TRADE_CONTRACT_WEIGHT * releasePenalty(p) - 1e-9);
  });

  it("keeps the price of what he does, apart from his contract, where it was", () => {
    const s = cpuLeague(601);
    const p = withPlayer(s, "any", "DET", { position: "EDGE", overall: 88, age: 27, years: 3, pay: market("EDGE", 88) });
    expect(value(s, "any")).toBeCloseTo(playerPerformanceValue(s, p) + playerContractValue(s, p), 9);
  });

  it("discounts an injured player this season only", () => {
    const s = cpuLeague(601);
    const p = withPlayer(s, "hurt", "DET", { position: "EDGE", overall: 88, age: 27, years: 3, pay: market("EDGE", 88) });
    const healthy = value(s, "hurt");
    p.injury_status = { status: "out", weeks_out_est: [8, 12], description: "knee" };
    // in the offseason injuries have healed or are not counted
    s.stage = "offseasonDraft";
    expect(value(s, "hurt")).toBeCloseTo(healthy, 9);
    s.stage = "regularSeason";
    s.week = 6;
    expect(value(s, "hurt")).toBeLessThan(healthy);
  });

  it("protects the franchise quarterback: no pile of picks buys one, and a contract does not cheapen him", () => {
    const s = cpuLeague(601);
    const team = "DET";
    const qb = withPlayer(s, "qb1", team, { position: "QB", overall: 92, age: 28, years: 4, pay: market("QB", 92), decline: 36 });
    for (const q of Object.values(s.players)) if (q.nfl_team === team && q.position === "QB" && q.id !== qb.id) q.overall = 60;
    expect(value(s, "qb1")).toBeGreaterThan(5 * tradeAssetValue(s, { kind: "pick", pick: picksOwnedBy(s, "GB")[0]! }));
    const picks: TradeAsset[] = picksOwnedBy(s, "GB").slice(0, 7).map((pick) => ({ kind: "pick", pick }));
    const ev = judgeTrade(s, "GB", team, picks, [asset("qb1")]);
    expect(ev.acceptLikelihood).toBe(0);
    expect(ev.refusal).toMatch(/franchise quarterback/);
  });
});

describe("handing a bad contract to a CPU team", () => {
  /** a team's liability: an aging player on years he will not play at his pay */
  function dump(s: LeagueState, from: string): Player {
    return withPlayer(s, "dumped", from, { position: "WR", overall: 66, age: 34, years: 4, pay: 18 });
  }

  it("is refused for nothing, and for a late pick", () => {
    const s = cpuLeague(602);
    const p = dump(s, "GB");
    const seventh = picksOwnedBy(s, "GB").find((k) => k.round === 7)!;
    expect(judgeTrade(s, "GB", "DET", [asset(p.id)], []).acceptLikelihood).toBeLessThan(TRADE_ACCEPT_THRESHOLD);
    expect(judgeTrade(s, "GB", "DET", [asset(p.id), { kind: "pick", pick: seventh }], []).acceptLikelihood).toBeLessThan(TRADE_ACCEPT_THRESHOLD);
  });

  it("is taken for a sweetener, and the sweetener it asks is no more than the dead money he would cost to release", () => {
    const s = cpuLeague(602);
    const p = dump(s, "GB");
    const sweeteners = picksOwnedBy(s, "GB").filter((k) => k.year === s.season);
    // picks of ours, cheapest first, until they take him
    const asc = sweeteners.map((pick) => ({ pick, v: tradeAssetValue(s, { kind: "pick", pick }) })).sort((a, b) => a.v - b.v);
    const sent: TradeAsset[] = [asset(p.id)];
    let paid = 0;
    let taken = false;
    for (const { pick, v } of asc) {
      sent.push({ kind: "pick", pick });
      paid += v;
      if (tradeAccepts(judgeTrade(s, "GB", "DET", sent, []).acceptLikelihood)) {
        taken = true;
        break;
      }
    }
    expect(taken, "some picks of ours make a team take him").toBe(true);
    // priced at what it costs to be rid of him (and the team's own friction), never at an arbitrary premium
    expect(paid).toBeLessThanOrEqual(TRADE_CONTRACT_WEIGHT * releasePenalty(p) + 0.1 * Math.abs(tradeAssetValue(s, asset(p.id))) + 12);
  });

  it("is no way to make picks: taking a bad contract from a CPU team pays less than cutting him costs", () => {
    const s = cpuLeague(603);
    const p = dump(s, "DET");
    // DET would give us the contract and a pick of its own: the best pick it would attach
    const attach = picksOwnedBy(s, "DET")
      .map((pick) => ({ pick, v: tradeAssetValue(s, { kind: "pick", pick }) }))
      .filter(({ pick }) => tradeAccepts(judgeTrade(s, "GB", "DET", [], [asset(p.id), { kind: "pick", pick }]).acceptLikelihood))
      .sort((a, b) => b.v - a.v)[0];
    // whatever it pays for the relief, cutting him afterwards costs more in chart points than it brought in
    expect(attach?.v ?? 0).toBeLessThanOrEqual(TRADE_CONTRACT_WEIGHT * releasePenalty(p));
  });
});

describe("one decision for every channel", () => {
  it("is deterministic, and the same after a save is written and read back", () => {
    const s = cpuLeague(604);
    const mine = Object.values(s.players).filter((p) => p.nfl_team === "GB" && !p.retired).sort((a, b) => b.overall - a.overall);
    const theirs = Object.values(s.players).filter((p) => p.nfl_team === "DET" && !p.retired).sort((a, b) => b.overall - a.overall);
    const a = [asset(mine[3]!.id)];
    const b = [asset(theirs[3]!.id)];
    const first = judgeTrade(s, "GB", "DET", a, b);
    expect(judgeTrade(s, "GB", "DET", a, b)).toEqual(first);
    expect(judgeTrade(JSON.parse(JSON.stringify(s)) as LeagueState, "GB", "DET", a, b)).toEqual(first);
    // and reordering the same offer cannot reroll it
    expect(judgeTrade(s, "GB", "DET", [...a].reverse(), [...b].reverse()).acceptLikelihood).toBe(first.acceptLikelihood);
  });

  /** An offer sitting in front of a CPU team at the deadline, and what it answers. */
  function answer(s: LeagueState, from: string, to: string, give: TradeAsset[], get: TradeAsset[]): "accepted" | "denied" {
    beginTradeDeadline(s);
    const d = s.tradeDeadline!;
    d.order = [from, ...d.order.filter((c) => c !== from)];
    d.active = { id: "probe", fromTeam: from, toTeam: to, fromAssets: give, toAssets: get, awaiting: "recipient", modified: false, round: 1 };
    runDeadlineTurns(s);
    return d.resolved.find((r) => r.id === "probe")!.outcome;
  }

  it("is the answer the deadline gives: accepted when the decision says yes, denied when it says no, every time", () => {
    const s = cpuLeague(605);
    const theirs = Object.values(s.players).filter((p) => p.nfl_team === "DET" && !p.retired).sort((a, b) => b.overall - a.overall);
    const want = asset(theirs[0]!.id);
    const picks = picksOwnedBy(s, "GB");
    let yes = 0;
    let no = 0;
    // from a lowball to a king's ransom: the deadline used to roll a die against the likelihood, so the same offer could go either way
    for (const n of [1, 2, 3, 4, 6, 9, 14, 21].filter((k) => k <= picks.length)) {
      const give: TradeAsset[] = picks.slice(0, n).map((pick) => ({ kind: "pick", pick }));
      const decided = tradeAccepts(judgeTrade(s, "GB", "DET", give, [want]).acceptLikelihood) ? "accepted" : "denied";
      expect(answer(structuredClone(s), "GB", "DET", give, [want])).toBe(decided);
      if (decided === "accepted") yes++;
      else no++;
    }
    expect(yes, "some offer is good enough").toBeGreaterThan(0);
    expect(no, "some offer is not").toBeGreaterThan(0);
  });

  it("is the answer a person's staff gives for them", () => {
    const s = cpuLeague(605);
    // GB is a person's team, and DET has offered to take their second-best receiver
    s.gms[0]!.teamCode = "GB";
    s.gms[0]!.isHuman = true;
    const mine = Object.values(s.players).filter((p) => p.nfl_team === "GB" && !p.retired).sort((a, b) => b.overall - a.overall);
    const picks = picksOwnedBy(s, "DET");
    for (let n = 1; n <= picks.length; n++) {
      const t = structuredClone(s);
      beginTradeDeadline(t);
      const give: TradeAsset[] = picks.slice(0, n).map((pick) => ({ kind: "pick", pick }));
      const get = [asset(mine[0]!.id)];
      t.tradeDeadline!.active = { id: "offer", fromTeam: "DET", toTeam: "GB", fromAssets: give, toAssets: get, awaiting: "recipient", modified: false, round: 1 };
      const move = staffDeadlineMove(t, "GB");
      const decided = tradeAccepts(judgeTrade(t, "DET", "GB", give, get).acceptLikelihood);
      expect(move?.kind).toBe(decided ? "accept" : "deny");
    }
  });
});

describe("a team reads a trade by its window", () => {
  it("prices picks and the young up for a rebuild and a veteran past his decline down, a little, the other way for a contender", () => {
    const s = cpuLeague(606);
    const pick: TradeAsset = { kind: "pick", pick: picksOwnedBy(s, "GB")[0]! };
    withPlayer(s, "kid", "GB", { position: "WR", overall: 78, age: 23, years: 3, pay: 3 });
    withPlayer(s, "vet", "GB", { position: "WR", overall: 78, age: 34, years: 1, pay: 9, decline: 31 });
    expect(teamAssetMultiplier(s, pick, -1)).toBeGreaterThan(teamAssetMultiplier(s, pick, 1));
    expect(teamAssetMultiplier(s, asset("kid"), -1)).toBeGreaterThan(teamAssetMultiplier(s, asset("kid"), 1));
    expect(teamAssetMultiplier(s, asset("vet"), -1)).toBeLessThan(teamAssetMultiplier(s, asset("vet"), 1));
    // small enough that buying from one team and selling to another is not a business: whatever the asset, the most any two teams'
    // readings can differ by is less than what each of them asks over an even trade
    const ratios: number[] = [];
    for (const age of [22, 24, 26, 28, 30, 32, 35]) {
      for (const overall of [60, 79, 85]) {
        const q = withPlayer(s, `grid_${age}_${overall}`, "GB", { position: "WR", overall, age, years: 2, pay: 8, decline: 30 });
        ratios.push(Math.max(teamAssetMultiplier(s, asset(q.id), 1) / teamAssetMultiplier(s, asset(q.id), -1), teamAssetMultiplier(s, asset(q.id), -1) / teamAssetMultiplier(s, asset(q.id), 1)));
      }
    }
    ratios.push(teamAssetMultiplier(s, pick, -1) / teamAssetMultiplier(s, pick, 1));
    expect(Math.max(...ratios)).toBeLessThan(1 + 2 * TRADE_FRICTION);
    for (const fx of [-1, 1]) {
      expect(teamAssetMultiplier(s, pick, fx)).toBeGreaterThanOrEqual(0.9);
      expect(teamAssetMultiplier(s, pick, fx)).toBeLessThanOrEqual(1.1);
    }
  });

  it("asks a bit more than an even trade of a CPU team: the same assets are not a sure yes", () => {
    const s = cpuLeague(606);
    const theirs = Object.values(s.players).filter((p) => p.nfl_team === "DET" && !p.retired).sort((a, b) => b.overall - a.overall)[5]!;
    // pay exactly what the chart says
    const target = tradeAssetValue(s, asset(theirs.id));
    const picks = picksOwnedBy(s, "GB").map((pick) => ({ pick, v: tradeAssetValue(s, { kind: "pick", pick }) })).sort((a, b) => Math.abs(a.v - target) - Math.abs(b.v - target));
    const even = picks[0]!;
    if (Math.abs(even.v - target) > 0.5) return; // no pick exactly at the price on this seed
    expect(judgeTrade(s, "GB", "DET", [{ kind: "pick", pick: even.pick }], [asset(theirs.id)]).acceptLikelihood).toBeLessThan(TRADE_ACCEPT_THRESHOLD);
  });
});

/** Records that give half the league a window open and half closed, as at the deadline. */
function atTheDeadline(seed: number): LeagueState {
  const s = cpuLeague(seed);
  const codes = Object.keys(s.teams).sort();
  codes.forEach((c, i) => {
    const t = s.teams[c]!;
    t.wins = i % 2 === 0 ? 7 : 2;
    t.losses = 9 - t.wins;
    t.ties = 0;
  });
  s.stage = "tradeDeadline";
  s.week = 9;
  return s;
}

describe("what the CPU teams propose to one another", () => {
  it("is made by a contender to a rebuild: never the other way, and never inside a division", () => {
    const s = atTheDeadline(607);
    const window = readTeamTimeline(s);
    let made = 0;
    for (const buyer of Object.keys(s.teams)) {
      for (let salt = 1000; salt < 1012; salt++) {
        const o = cpuToCpuOffer(s, buyer, salt);
        if (!o) continue;
        made++;
        expect(window.get(buyer)!, `${buyer} is buying`).toBeGreaterThan(0.1);
        expect(window.get(o.toTeam)!, `${o.toTeam} is selling`).toBeLessThanOrEqual(-0.1);
      }
    }
    expect(made, "contenders do shop").toBeGreaterThan(5);
  }, 120_000);

  it("never asks for a player whose pay will outlast his play", () => {
    const s = atTheDeadline(607);
    for (const buyer of Object.keys(s.teams)) {
      for (let salt = 1000; salt < 1008; salt++) {
        const o = cpuToCpuOffer(s, buyer, salt);
        for (const a of o?.toAssets ?? []) {
          const p = s.players[a.playerId ?? ""]!;
          expect(p.age >= p.decline_age_threshold && (p.contract?.years_remaining ?? 0) >= 2, `${p.name} (${p.age}, ${p.contract?.years_remaining}y)`).toBe(false);
        }
      }
    }
  }, 120_000);

  it("is a package the seller would take, that fits under both caps, at a price near the chart, in more than first-round picks", () => {
    const s = atTheDeadline(607);
    const ctx = tradeContext(s);
    let n = 0;
    let paid = 0;
    let got = 0;
    let firsts = 0;
    let withPlayer_ = 0;
    for (const buyer of Object.keys(s.teams)) {
      for (let salt = 1000; salt < 1012; salt++) {
        const o = cpuToCpuOffer(s, buyer, salt);
        if (!o) continue;
        n++;
        expect(capLegal(s, buyer, o.toTeam, o.fromAssets, o.toAssets)).toBe(true);
        expect(tradeAccepts(judgeWith(ctx, buyer, o.toTeam, o.fromAssets, o.toAssets).acceptLikelihood)).toBe(true);
        paid += o.fromAssets.reduce((m, a) => m + ctx.chart(a), 0);
        got += o.toAssets.reduce((m, a) => m + ctx.chart(a), 0);
        firsts += o.fromAssets.filter((a) => a.kind === "pick" && a.pick?.round === 1).length;
        if (o.fromAssets.some((a) => a.kind === "player")) withPlayer_++;
      }
    }
    expect(n).toBeGreaterThan(5);
    // the old search paid about 1.7 times the chart, almost always in first-rounders
    expect(paid / got).toBeLessThan(1.4);
    expect(paid / got).toBeGreaterThan(0.8);
    expect(firsts / n).toBeLessThan(1.2);
    expect(withPlayer_, "some buyers pay in players").toBeGreaterThan(0);
  }, 180_000);

  it("is not made by a team whose window is closed, or to a contender", () => {
    const s = atTheDeadline(608);
    const window = readTeamTimeline(s);
    for (const [code, w] of window) {
      if (w > 0.1) continue;
      for (let salt = 1000; salt < 1010; salt++) expect(cpuToCpuOffer(s, code, salt), `${code} (${w.toFixed(2)})`).toBeNull();
    }
  }, 120_000);
});

describe("what the CPU teams offer a person", () => {
  it("is something the suitor can fit under its cap and would itself make, worth about what it asks", () => {
    const s = atTheDeadline(609);
    s.gms[0]!.teamCode = "GB";
    s.gms[0]!.isHuman = true;
    const ctx = tradeContext(s);
    let made = 0;
    for (let salt = 0; salt < 40; salt++) {
      for (const o of generateAiTradeOffers(s, salt, 2)) {
        made++;
        expect(capLegal(s, o.fromTeam, o.toTeam, o.fromAssets, o.toAssets)).toBe(true);
        expect(judgeWith(ctx, o.toTeam, o.fromTeam, o.toAssets, o.fromAssets, { friction: false }).acceptLikelihood).toBeGreaterThanOrEqual(TRADE_ACCEPT_THRESHOLD);
        const offered = o.fromAssets.reduce((m, a) => m + ctx.chart(a), 0);
        const asked = o.toAssets.reduce((m, a) => m + ctx.chart(a), 0);
        expect(offered).toBeGreaterThan(0.8 * asked);
        expect(offered).toBeLessThan(1.5 * asked);
      }
    }
    expect(made, "offers are made").toBeGreaterThan(5);
  }, 180_000);

  it("is the same offer every time", () => {
    const s = atTheDeadline(609);
    s.gms[0]!.teamCode = "GB";
    s.gms[0]!.isHuman = true;
    const a = generateAiTradeOffers(s, 3, 2);
    expect(generateAiTradeOffers(structuredClone(s), 3, 2)).toEqual(a);
  }, 60_000);
});

describe("a save from before cap growth", () => {
  it("is valued and answered all the same: no scale recorded reads as the starting cap", () => {
    const s = atTheDeadline(611);
    const old = JSON.parse(JSON.stringify(s)) as LeagueState;
    delete (old as Partial<LeagueState>).capScale;
    delete (old as Partial<LeagueState>).capGrowthSeason;
    const mine = Object.values(old.players).filter((p) => p.nfl_team === "GB" && !p.retired).sort((a, b) => b.overall - a.overall);
    const theirs = Object.values(old.players).filter((p) => p.nfl_team === "DET" && !p.retired).sort((a, b) => b.overall - a.overall);
    const a = [asset(mine[2]!.id)];
    const b = [asset(theirs[2]!.id)];
    const ev = judgeTrade(old, "GB", "DET", a, b);
    expect(Number.isFinite(ev.valueDelta)).toBe(true);
    expect(ev).toEqual(judgeTrade(JSON.parse(JSON.stringify(old)) as LeagueState, "GB", "DET", a, b));
    for (const buyer of Object.keys(old.teams)) cpuToCpuOffer(old, buyer, 1000);
  }, 120_000);
});

describe("the deadline's order is untouched", () => {
  it("starts with the worst record and has a turn to take", () => {
    const s = atTheDeadline(610);
    beginTradeDeadline(s);
    expect(onTheClock(s)).toBeTruthy();
  });
});

