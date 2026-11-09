import { describe, expect, it } from "vitest";

import type { LeagueState, Player, Position, TradeAsset } from "@/domain";
import { tradeAssetValue } from "@/sim/MockSimulationService";
import { ensureDraftPicks, picksOwnedBy } from "./draftPicks.ts";
import { expectedSalary } from "./freeAgencyValues.ts";
import { releasePenalty } from "./releaseCost.ts";
import { offerToContract } from "./rules.ts";
import { DEFAULT_CONFIG, createLeague, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { beginTradeDeadline, runCpuTurns } from "./tradeDeadline.ts";
import { judgeTrade, judgeWith, tradeAccepts, tradeContext } from "./tradeModel.ts";

/**
 * QA backlog rank 3 (STRAT-002, contract dumping) and rank 4 (COMP-002b / STRAT-010, kicker and punter need).
 *
 * Both are the CPU's reading of a trade, so both are checked through the one decision every channel uses (`judgeTrade` /
 * `judgeWith`), and the dump is also pushed through the real trade-deadline path (`runCpuTurns` -> `cpuRespond` ->
 * `respondAtDeadline`). Each negative case was run against the model before this change and fails there (see
 * docs/qa-longitudinal/trade-liability-and-specialists.md for the numbers); the controls below keep ordinary trades the same.
 */

const built = new Map<number, LeagueState>();
function league(seed: number): LeagueState {
  let base = built.get(seed);
  if (!base) {
    base = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, playerPool: "legacy" });
    fillRosterGaps(base);
    for (const g of base.gms) g.isHuman = false;
    for (const t of Object.values(base.teams)) t.controlledBy = { kind: "ai" };
    ensureDraftPicks(base, base.season);
    recomputeTeamRatings(base);
    built.set(seed, base);
  }
  return structuredClone(base);
}
/** The team making the offer: the first in the league. (Every team is a CPU team to the model; only the deadline path needs a person.) */
const humanTeam = (s: LeagueState): string => Object.keys(s.teams)[0]!;
const cpuTeams = (s: LeagueState): string[] => Object.keys(s.teams).filter((t) => t !== humanTeam(s));

/** The league a few years in: every CPU team has the cap room a fresh league's tight caps hide (backlog: "later-season franchise states"). */
function withRoom(s: LeagueState): LeagueState {
  for (const t of cpuTeams(s)) s.teams[t]!.cap.used = Math.round(s.teams[t]!.cap.total * 0.8 * 10) / 10;
  return s;
}

/** Put a player of the given shape on the human team, on the contract given. */
function plant(s: LeagueState, pos: Position, ovr: number, age: number, salary: number, years: number): Player {
  const H = humanTeam(s);
  const p = Object.values(s.players).find((q) => q.nfl_team === H && q.position === pos && !q.retired)!;
  p.age = age;
  p.overall = ovr;
  p.contract = offerToContract({ teamCode: H, baseSalary: salary, signingBonus: 0, years, guaranteed: salary * years * 0.5 } as never) as never;
  return p;
}
const give = (p: Player): TradeAsset[] => [{ kind: "player", playerId: p.id }];
const pickOf = (s: LeagueState, team: string, round: number): TradeAsset => {
  const pk = picksOwnedBy(s, team).filter((x) => x.round === round).sort((a, b) => a.year - b.year)[0]!;
  return { kind: "pick", pick: pk };
};
/** Teams that could take the player's hit under the cap (the deadline itself does not check). */
const roomFor = (s: LeagueState, p: Player): string[] =>
  cpuTeams(s).filter((t) => s.teams[t]!.cap.total - s.teams[t]!.cap.used >= (p.contract?.cap_hit_by_year[0] ?? 0));

const SEEDS = [9501, 9502, 9503];
const DUMP_POSITIONS: Position[] = ["EDGE", "CB", "OT", "ILB"];

describe("STRAT-002: a cap mistake is not handed to the league for nothing", () => {
  it("a 32-year-old 70 on $20M x 3 (release penalty >= $10M) is taken free by at most 20% of the teams with room", () => {
    let yes = 0;
    let n = 0;
    for (const seed of SEEDS) {
      for (const pos of DUMP_POSITIONS) {
        const s = withRoom(league(seed));
        const p = plant(s, pos, 70, 32, 20, 3);
        expect(releasePenalty(p), "the probe contract must be one the backlog's target covers").toBeGreaterThanOrEqual(10);
        for (const t of roomFor(s, p)) {
          n++;
          if (tradeAccepts(judgeTrade(s, humanTeam(s), t, give(p), []).acceptLikelihood)) yes++;
        }
      }
    }
    expect(n).toBeGreaterThan(300);
    expect(yes / n).toBeLessThanOrEqual(0.2);
  });

  it("a token sweetener (a seventh) does not buy it either, and a $30M x 4 deal is not taken for a third", () => {
    let tokenYes = 0;
    let bigYes = 0;
    let n = 0;
    for (const seed of SEEDS) {
      for (const pos of DUMP_POSITIONS) {
        const s = withRoom(league(seed));
        const p = plant(s, pos, 70, 32, 20, 3);
        const sBig = withRoom(league(seed));
        const pBig = plant(sBig, pos, 70, 32, 30, 4);
        for (const t of cpuTeams(s)) {
          n++;
          if (tradeAccepts(judgeTrade(s, humanTeam(s), t, [...give(p), pickOf(s, humanTeam(s), 7)], []).acceptLikelihood)) tokenYes++;
          if (tradeAccepts(judgeTrade(sBig, humanTeam(sBig), t, [...give(pBig), pickOf(sBig, humanTeam(sBig), 3)], []).acceptLikelihood)) bigYes++;
        }
      }
    }
    expect(tokenYes / n).toBeLessThanOrEqual(0.1);
    expect(bigYes / n).toBeLessThanOrEqual(0.1);
  });

  it("but a meaningful sweetener (a second) still gets it done: a compensated dump is a trade, not an exploit", () => {
    let yes = 0;
    let n = 0;
    for (const seed of SEEDS) {
      const s = withRoom(league(seed));
      const p = plant(s, "EDGE", 70, 32, 20, 3);
      for (const t of roomFor(s, p)) {
        n++;
        if (tradeAccepts(judgeTrade(s, humanTeam(s), t, [...give(p), pickOf(s, humanTeam(s), 2)], []).acceptLikelihood)) yes++;
      }
    }
    expect(yes / n).toBeGreaterThanOrEqual(0.8);
  });

  it("the same holds for every difficulty and for rebuilding and contending teams", () => {
    for (const level of ["casual", "standard", "competitive", "expert", "master"] as const) {
      const s = withRoom(league(9501));
      s.config.difficulty = level;
      const p = plant(s, "EDGE", 70, 32, 20, 3);
      const ctx = tradeContext(s);
      const teams = roomFor(s, p);
      const yes = teams.filter((t) => tradeAccepts(judgeWith(ctx, humanTeam(s), t, give(p), []).acceptLikelihood)).length;
      expect(yes / teams.length, level).toBeLessThanOrEqual(0.2);
    }
  });

  it("through the real trade-deadline path: the CPU team answers the dump with a no", () => {
    let accepted = 0;
    let asked = 0;
    for (const seed of SEEDS) {
      const base = withRoom(league(seed));
      const H = humanTeam(base);
      const targets = cpuTeams(base).slice(0, 8);
      for (const t of targets) {
        const s = structuredClone(base);
        s.stage = "tradeDeadline";
        s.gms[0]!.isHuman = true;
        s.gms[0]!.teamCode = H;
        const p = plant(s, "CB", 70, 32, 20, 3);
        beginTradeDeadline(s);
        const d = s.tradeDeadline!;
        d.active = { id: "probe", fromTeam: H, toTeam: t, fromAssets: give(p), toAssets: [], awaiting: "recipient", modified: false, round: 1 };
        runCpuTurns(s);
        const res = d.resolved.find((r) => r.id === "probe");
        expect(res, "the CPU team must have answered").toBeTruthy();
        asked++;
        if (res!.outcome === "accepted") {
          accepted++;
          expect(s.players[p.id]!.nfl_team).toBe(t);
        }
      }
    }
    expect(asked).toBe(24);
    expect(accepted / asked).toBeLessThanOrEqual(0.2);
  });

  it("controls: a productive veteran on a big deal is still taken free, and a fair deal for a starter still goes through", () => {
    for (const seed of SEEDS) {
      const s = withRoom(league(seed));
      const vet = plant(s, "EDGE", 78, 30, 20, 3);
      const ctx = tradeContext(s);
      const teams = roomFor(s, vet);
      expect(teams.length).toBeGreaterThan(20);
      const yes = teams.filter((t) => tradeAccepts(judgeWith(ctx, humanTeam(s), t, give(vet), []).acceptLikelihood)).length;
      expect(yes / teams.length, `78/30 on $20M x 3, seed ${seed}`).toBeGreaterThanOrEqual(0.9);

      const young = plant(s, "OT", 75, 27, 10, 3);
      const yes2 = roomFor(s, young).filter((t) => tradeAccepts(judgeWith(ctx, humanTeam(s), t, give(young), []).acceptLikelihood)).length;
      expect(yes2 / roomFor(s, young).length, `75/27 on $10M x 3, seed ${seed}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("controls: buying a starter with picks at 1.15x his price is accepted", () => {
    let fair = 0;
    let fairYes = 0;
    for (const seed of SEEDS) {
      const s = league(seed);
      const H = humanTeam(s);
      const ctx = tradeContext(s);
      for (const t of cpuTeams(s).slice(0, 16)) {
        const target = Object.values(s.players)
          .filter((q) => q.nfl_team === t && !q.retired && !["QB", "K", "P"].includes(q.position) && q.overall >= 72 && q.overall <= 86)
          .sort((a, b) => b.overall - a.overall)[0];
        if (!target) continue;
        const want: TradeAsset[] = [{ kind: "player", playerId: target.id }];
        const price = tradeAssetValue(s, want[0]!);
        if (price < 8) continue;
        const mine = picksOwnedBy(s, H).map((pk) => ({ kind: "pick", pick: pk }) as TradeAsset).sort((a, b) => tradeAssetValue(s, b) - tradeAssetValue(s, a));
        const offerAt = (share: number): TradeAsset[] | null => {
          const out: TradeAsset[] = [];
          let v = 0;
          for (const a of mine) {
            if (v >= share * price) break;
            out.push(a);
            v += tradeAssetValue(s, a);
          }
          return v >= share * price ? out : null;
        };
        const f = offerAt(1.15);
        if (f) {
          fair++;
          if (tradeAccepts(judgeWith(ctx, H, t, f, want).acceptLikelihood)) fairYes++;
        }
      }
    }
    expect(fair).toBeGreaterThan(15);
    expect(fairYes / fair).toBeGreaterThanOrEqual(0.95);
  });

  it("controls: taking a CPU team's worst contract plus its pick for nothing is still refused (no pick-and-cut)", () => {
    for (const seed of SEEDS) {
      const s = league(seed);
      const H = humanTeam(s);
      const ctx = tradeContext(s);
      for (const t of cpuTeams(s)) {
        const bad = Object.values(s.players)
          .filter((q) => q.nfl_team === t && !q.retired && q.contract && releasePenalty(q) >= 5)
          .sort((a, b) => releasePenalty(b) - releasePenalty(a))[0];
        if (!bad) continue;
        const get: TradeAsset[] = [{ kind: "player", playerId: bad.id }, pickOf(s, t, 2)];
        const accepts = tradeAccepts(judgeWith(ctx, H, t, [], get).acceptLikelihood);
        if (accepts) {
          // were it ever accepted, it must not pay: the pick has to be worth no more than cutting him costs
          expect(tradeAssetValue(s, get[1]!)).toBeLessThanOrEqual(0.8 * releasePenalty(bad));
        }
      }
    }
  });
});

/** Sign the league's best free-agent-grade specialist for the human team at his asking price, then shop him to every CPU team. */
function shopSpecialist(s: LeagueState, pos: "K" | "P", rank: number): { chart: number; best: number; buyers: number; mean: number } {
  const H = humanTeam(s);
  const fa = Object.values(s.players)
    .filter((q) => !q.retired && q.nfl_team !== H && q.position === pos && q.age <= 33)
    .sort((a, b) => b.overall - a.overall)[rank]!;
  const salary = expectedSalary(fa);
  fa.contract = offerToContract({ teamCode: H, baseSalary: salary, signingBonus: 0, years: 3, guaranteed: salary * 1.5 * 3 } as never) as never;
  fa.nfl_team = H;
  fa.free_agent = false;
  const ctx = tradeContext(s);
  const asset: TradeAsset[] = [{ kind: "player", playerId: fa.id }];
  const chart = tradeAssetValue(s, asset[0]!);
  let best = 0;
  let buyers = 0;
  let total = 0;
  const teams = cpuTeams(s);
  for (const t of teams) {
    const mine = picksOwnedBy(s, t).map((pk) => ({ kind: "pick", pick: pk }) as TradeAsset).sort((a, b) => tradeAssetValue(s, b) - tradeAssetValue(s, a));
    const take: TradeAsset[] = [];
    for (const a of mine) if (tradeAccepts(judgeWith(ctx, H, t, asset, [...take, a]).acceptLikelihood)) take.push(a);
    const v = take.reduce((x, a) => x + tradeAssetValue(s, a), 0);
    total += v;
    if (v > 0) buyers++;
    best = Math.max(best, v);
  }
  return { chart, best, buyers, mean: total / teams.length };
}

describe("COMP-002b / STRAT-010: a specialist's need premium is bounded", () => {
  it("shopped league-wide, a signed kicker and punter return at most chart on average and no outlier pays far over it", () => {
    for (const pos of ["K", "P"] as const) {
      const ratios: number[] = [];
      const bests: number[] = [];
      for (const seed of [12, 13, 14, 15, 16, 17]) {
        for (const rank of [0, 3]) {
          const r = shopSpecialist(league(seed), pos, rank);
          expect(r.chart).toBeGreaterThan(1);
          ratios.push(r.mean / r.chart);
          bests.push(r.best / r.chart);
        }
      }
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(mean, `${pos}: mean paid over every team / chart`).toBeLessThanOrEqual(1);
      // the best buyer is the exploit: before, a team with a hole paid up to 2.3x
      expect(Math.max(...bests), `${pos}: best single offer / chart`).toBeLessThanOrEqual(1.3);
    }
  });

  it("a team with no kicker at all pays no more than a quarter over chart for one", () => {
    for (const pos of ["K", "P"] as const) {
      for (const seed of [12, 13, 14]) {
        const s = league(seed);
        const H = humanTeam(s);
        const target = cpuTeams(s)[3]!;
        for (const q of Object.values(s.players)) if (q.nfl_team === target && q.position === pos) q.retired = true;
        const fa = Object.values(s.players).filter((q) => !q.retired && q.nfl_team !== H && q.position === pos).sort((a, b) => b.overall - a.overall)[0]!;
        const sal = expectedSalary(fa);
        fa.contract = offerToContract({ teamCode: H, baseSalary: sal, signingBonus: 0, years: 3, guaranteed: sal * 4.5 } as never) as never;
        fa.nfl_team = H;
        fa.free_agent = false;
        const ctx = tradeContext(s);
        const asset: TradeAsset[] = [{ kind: "player", playerId: fa.id }];
        const chart = tradeAssetValue(s, asset[0]!);
        const mine = picksOwnedBy(s, target).map((pk) => ({ kind: "pick", pick: pk }) as TradeAsset).sort((a, b) => tradeAssetValue(s, b) - tradeAssetValue(s, a));
        const take: TradeAsset[] = [];
        for (const a of mine) if (tradeAccepts(judgeWith(ctx, H, target, asset, [...take, a]).acceptLikelihood)) take.push(a);
        const paid = take.reduce((x, a) => x + tradeAssetValue(s, a), 0);
        expect(paid / chart, `${pos} seed ${seed}`).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it("a specialist is still a fair trade: some team will pay real picks for a good one", () => {
    const r = shopSpecialist(league(12), "K", 0);
    expect(r.buyers).toBeGreaterThanOrEqual(20);
    expect(r.best / r.chart).toBeGreaterThanOrEqual(0.6);
  });
});
