import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";

import type { LeagueState, Player, TradeAsset } from "@/domain";
import {
  MockSimulationService,
  TRADE_POSITION_VALUE,
  contractValueFor,
  franchiseQbPremium,
  playerTradeBase,
  tradeAgeFactor,
  tradeAssetValue,
} from "@/sim/MockSimulationService";
import { discountRateFor, projectRatings, survivalByYear, termSubject } from "@/state/contractValue.ts";
import { expectedSalary } from "@/state/freeAgencyValues.ts";
import { marketScale } from "@/state/capEconomy.ts";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";
import { readTeamTimeline } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

/**
 * The CPU trade metrics behind the trade-intelligence work: whole all-CPU leagues through the server's own stage machine, so
 * every team's deadline turn is played (a league with a person in it is stopped at their turn by the forced advance the
 * harness uses, and the CPU turns after theirs never run).
 *
 *   TRADE_METRICS=1 TRADE_OUT=out.json npx vitest run --root online test/trade-metrics.test.ts
 *
 * Off unless TRADE_METRICS is set, so it reports as skipped in CI. Run it on two checkouts with the same seeds and compare.
 * Values are reported on two charts: the legacy one (the trade chart as it stood before contract-aware valuation, copied here so
 * both sides of a comparison are measured the same way) and the checkout's own `tradeAssetValue`.
 */
const ON = !!process.env.TRADE_METRICS;
const SEEDS = (process.env.TRADE_SEEDS ?? "9301,9302,9303").split(",").map(Number);
const SEASONS = Number(process.env.TRADE_SEASONS ?? 5);
const sim = new MockSimulationService();

function league(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[1]!.teamCode = "BUF";
  // every team is a CPU team: the deadline plays out in full
  for (const g of s.gms) g.isHuman = false;
  for (const t of Object.values(s.teams)) t.controlledBy = { kind: "ai" };
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  clearReadinessOnline(s);
  return s;
}

const legacyContractFactor = (p: Player, scale: number): number => {
  const years = p.contract?.years_remaining ?? 1;
  const pay = p.contract?.cap_hit_by_year?.[0] ?? 0;
  const market = contractValueFor(p.overall, p.position, scale);
  const control = 0.85 + 0.05 * Math.max(1, Math.min(4, years));
  const surplus = market > 0 && pay > 0 ? Math.max(-1, Math.min(1, (market - pay) / market)) : 0;
  return control * (1 + 0.25 * surplus);
};
const legacyPlayerValue = (s: LeagueState, p: Player): number =>
  playerTradeBase(p.overall) * (TRADE_POSITION_VALUE[p.position] ?? 1) * franchiseQbPremium(s, p) * tradeAgeFactor(p.age, p.position) * legacyContractFactor(p, s.capScale ?? 1);

/** A package on the legacy chart: the best player in full, each next at 70% of the one before; picks add. */
function legacyPackage(s: LeagueState, assets: TradeAsset[]): number {
  let picks = 0;
  const players: number[] = [];
  for (const a of assets) {
    if (a.kind === "player") {
      const p = s.players[a.playerId ?? ""];
      players.push(p ? legacyPlayerValue(s, p) : 0);
    } else picks += tradeAssetValue(s, a);
  }
  players.sort((x, y) => y - x);
  return picks + players.reduce((sum, v, k) => sum + v * 0.7 ** k, 0);
}

/** What the rest of his contract is worth to a team, $M: what his projected rating costs on the market each year, less his pay. */
function projectedSurplusM(s: LeagueState, p: Player): number {
  const c = p.contract;
  if (!c) return 0;
  const years = Math.min(c.years_remaining, c.cap_hit_by_year.length);
  if (years <= 0) return 0;
  const sub = termSubject(p, p.age);
  const ratings = projectRatings(sub, years);
  const alive = survivalByYear(sub, ratings);
  const rate = discountRateFor(1);
  let total = 0;
  for (let t = 0; t < years; t++) {
    const fair = expectedSalary({ overall: ratings[t]!, position: p.position, age: 26 } as Player, marketScale(s) * 1.075 ** t);
    total += (alive[t]! * (fair - (c.cap_hit_by_year[t] ?? 0))) / (1 + rate) ** t;
  }
  return total;
}

const mean = (a: number[]): number => (a.length ? Math.round((100 * a.reduce((x, y) => x + y, 0)) / a.length) / 100 : 0);

/** Each team's starting lineup, as the mean rating of its starters by the roster template (what a team's window is read from). */
function overalls(s: LeagueState): Record<string, number> {
  const byTeam = new Map<string, Map<string, number[]>>();
  for (const p of Object.values(s.players)) {
    if (p.retired || p.free_agent || !s.teams[p.nfl_team]) continue;
    let m = byTeam.get(p.nfl_team);
    if (!m) byTeam.set(p.nfl_team, (m = new Map()));
    const l = m.get(p.position);
    if (l) l.push(p.overall);
    else m.set(p.position, [p.overall]);
  }
  const out: Record<string, number> = {};
  for (const code of Object.keys(s.teams)) {
    let sum = 0;
    let n = 0;
    for (const row of ROSTER_TEMPLATE) {
      if (row.starters === 0) continue;
      const l = [...(byTeam.get(code)?.get(row.pos) ?? [])].sort((a, b) => b - a).slice(0, row.starters);
      while (l.length < row.starters) l.push(42);
      for (const v of l) {
        sum += v;
        n++;
      }
    }
    out[code] = sum / n;
  }
  return out;
}

function runLeague(seed: number, seasons: number) {
  const s = league(seed);
  const rows: unknown[] = [];
  const signature: string[] = [];
  for (let y = 0; y < seasons; y++) {
    const ending = s.season;
    let snap: { rows: any[]; before: Record<string, number>; window: Map<string, number>; after: Record<string, number> } | null = null;
    // the lineups and windows as they stood going into the call that plays the deadline (it plays inside one stage change)
    let before: Record<string, number> = overalls(s);
    let beforeWindow = readTeamTimeline(s);
    const watch = (): void => {
      const d = s.tradeDeadline;
      if (!d || !d.resolved.length || snap) return;
      snap = {
        rows: d.resolved.map((r: any) => ({
          from: r.fromTeam,
          to: r.toTeam,
          outcome: r.outcome,
          fromAssets: structuredClone(r.fromAssets),
          toAssets: structuredClone(r.toAssets),
        })),
        before,
        window: beforeWindow,
        after: overalls(s),
      };
    };
    let g = 0;
    while (s.stage !== "playoffs") {
      if (g++ > 80) throw new Error("never reached the playoffs");
      before = overalls(s);
      beforeWindow = readTeamTimeline(s);
      finishPlayedWeek(s);
      watch();
    }
    // the cap after the deadline, before the offseason moves anything
    const overCap = Object.values(s.teams).filter((t) => t.cap.used > t.cap.total + 0.05).length;
    // dump probe: could a person hand a bad contract to a CPU team for nothing, or for a seventh-round pick?
    const probe = dumpProbe(s);
    const found = snap as { rows: any[]; before: Record<string, number>; window: Map<string, number>; after: Record<string, number> } | null;
    if (found) {
      const accepted = found.rows.filter((r) => r.outcome === "accepted");
      const players = (assets: TradeAsset[]): Player[] => assets.flatMap((a) => (a.kind === "player" && a.playerId && s.players[a.playerId] ? [s.players[a.playerId]!] : []));
      const picks = (assets: TradeAsset[]) => assets.filter((a) => a.kind === "pick");
      const paidLegacy = accepted.map((r) => legacyPackage(s, r.fromAssets));
      const gotLegacy = accepted.map((r) => legacyPackage(s, r.toAssets));
      const paidNow = accepted.map((r) => r.fromAssets.reduce((n: number, a: TradeAsset) => n + (a.kind === "pick" ? tradeAssetValue(s, a) : 0), 0));
      const acquired = accepted.flatMap((r) => players(r.toAssets));
      const firsts = accepted.reduce((n, r) => n + picks(r.fromAssets).filter((a) => a.pick?.round === 1).length + picks(r.toAssets).filter((a) => a.pick?.round === 1).length, 0);
      const buyerStrength = accepted.map((r) => found.after[r.from]! - found.before[r.from]!);
      const sellerStrength = accepted.map((r) => found.after[r.to]! - found.before[r.to]!);
      rows.push({
        seed,
        season: ending,
        offers: found.rows.length,
        accepted: accepted.length,
        ratioLegacy: paidLegacy.reduce((a, b) => a + b, 0) / Math.max(1e-9, gotLegacy.reduce((a, b) => a + b, 0)),
        paidLegacy: paidLegacy.reduce((a, b) => a + b, 0),
        gotLegacy: gotLegacy.reduce((a, b) => a + b, 0),
        paidNow: paidNow.reduce((a, b) => a + b, 0),
        firstRoundPicks: firsts,
        tradesWithAPlayerFromBuyer: accepted.filter((r) => players(r.fromAssets).length > 0).length,
        packagePickOnly: accepted.filter((r) => players(r.fromAssets).length === 0).length,
        packagePlayerOnly: accepted.filter((r) => picks(r.fromAssets).length === 0).length,
        packageMixed: accepted.filter((r) => players(r.fromAssets).length > 0 && picks(r.fromAssets).length > 0).length,
        acquired: acquired.length,
        acquiredAge: mean(acquired.map((p) => p.age)),
        acquiredPastDecline: acquired.filter((p) => p.age >= p.decline_age_threshold).length,
        acquiredPastDeclineMultiYear: acquired.filter((p) => p.age >= p.decline_age_threshold && (p.contract?.years_remaining ?? 0) >= 2).length,
        acquiredSurplusM: mean(acquired.map((p) => projectedSurplusM(s, p))),
        acquiredBadContract: acquired.filter((p) => projectedSurplusM(s, p) < -3).length,
        buyerWindowPositive: accepted.filter((r) => (found.window.get(r.from) ?? 0) > 0).length,
        sellerWindowNegative: accepted.filter((r) => (found.window.get(r.to) ?? 0) < 0).length,
        buyerStrengthChange: mean(buyerStrength),
        sellerStrengthChange: mean(sellerStrength),
        overCapAfterDeadline: overCap,
        ...probe,
      });
      signature.push(JSON.stringify(found.rows.map((r) => [r.from, r.to, r.outcome, r.fromAssets, r.toAssets])));
    } else {
      rows.push({ seed, season: ending, offers: 0, accepted: 0, overCapAfterDeadline: overCap, ...probe });
      signature.push("none");
    }
    s.bracket!.champion = "KC";
    g = 0;
    while (s.season === ending) {
      if (g++ > 40) throw new Error(`stuck in ${s.stage}`);
      for (const x of s.gms) s.readiness[x.id] = true;
      if (s.stage === "playoffs") finishPlayedWeek(s);
      else advanceStage(s);
    }
    g = 0;
    while ((s.stage as string) !== "preseason" && g++ < 60) {
      for (const x of s.gms) s.readiness[x.id] = true;
      advanceStage(s);
    }
  }
  return { rows, signature: signature.join("|") };
}

/**
 * A person handing a CPU team a liability: a thirty-something receiver, corner, tackle, edge, safety or tight end rated 62 to 68
 * on three or four years at four times his market and six million besides, offered for nothing, with a seventh-round pick and with a fourth. Made-up players, so the
 * same thirty are asked of every checkout, and removed after.
 */
function dumpProbe(s: LeagueState): {
  dumpCandidates: number;
  dumpTakenFree: number;
  dumpTakenWithR7: number;
  dumpTakenWithR4: number;
  dumpChartNegative: number;
  dumpChartNegativeTakenFree: number;
} {
  const codes = Object.keys(s.teams);
  const positions = ["WR", "CB", "OT", "EDGE", "S", "TE"] as const;
  const pick = (round: number) => Object.values(s.draftPicks ?? {}).find((k: any) => k.round === round && k.year >= s.season);
  const r7 = pick(7) as any;
  const r4 = pick(4) as any;
  let free = 0;
  let with7 = 0;
  let with4 = 0;
  let negative = 0;
  let negativeTaken = 0;
  const n = 30;
  for (let i = 0; i < n; i++) {
    const pos = positions[i % positions.length]!;
    const from = codes[i % codes.length]!;
    const to = codes[(i * 7 + 3) % codes.length] === from ? codes[(i * 7 + 4) % codes.length]! : codes[(i * 7 + 3) % codes.length]!;
    const base = Object.values(s.players).find((p) => p.position === pos && !p.free_agent && p.contract)!;
    const overall = 62 + (i % 7);
    const years = 3 + (i % 2);
    // paid far above anything he can produce: four times his market and six million besides
    const pay = Math.round((contractValueFor(overall, pos, marketScale(s)) * 4 + 6) * 10) / 10;
    const id = `dump_probe_${i}`;
    s.players[id] = {
      ...structuredClone(base),
      id,
      nfl_team: from,
      overall,
      age: 33 + (i % 3),
      decline_age_threshold: 30,
      injury_status: null,
      contract: { ...base.contract!, team_id: from, years_remaining: years, cap_hit_by_year: Array(years).fill(pay), total_value: pay * years, guaranteed: 0, signing_bonus: 0 },
    } as Player;
    const give: TradeAsset[] = [{ kind: "player", playerId: id }];
    const takenFree = sim.evaluateTrade(s, from, to, give, []).acceptLikelihood >= 0.5;
    if (takenFree) free++;
    // on the checkout's own chart (the baseline's never goes below zero, so it reports none)
    if (tradeAssetValue(s, give[0]!) < 0) {
      negative++;
      if (takenFree) negativeTaken++;
    }
    const withPick = (k: any): boolean =>
      !!k && sim.evaluateTrade(s, from, to, [...give, { kind: "pick", pick: { year: k.year, round: k.round, originalTeam: k.originalTeam } as any }], []).acceptLikelihood >= 0.5;
    if (withPick(r7)) with7++;
    if (withPick(r4)) with4++;
    delete s.players[id];
  }
  return { dumpCandidates: n, dumpTakenFree: free, dumpTakenWithR7: with7, dumpTakenWithR4: with4, dumpChartNegative: negative, dumpChartNegativeTakenFree: negativeTaken };
}

describe.skipIf(!ON)("trade metrics (TRADE_METRICS=1)", () => {
  it("measures CPU trading across leagues and seasons", () => {
    const out: unknown[] = [];
    const signatures: Record<string, string> = {};
    for (const seed of SEEDS) {
      const r = runLeague(seed, SEASONS);
      out.push(...r.rows);
      let h = 0x811c9dc5;
      for (let i = 0; i < r.signature.length; i++) {
        h ^= r.signature.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      signatures[String(seed)] = (h >>> 0).toString(16);
    }
    // each league's trades, trade for trade, as one string per seed: two runs of the same checkout in separate processes must match
    // (a second league in the same process cannot be compared, the id counters of generated players carry over)
    writeFileSync(process.env.TRADE_OUT ?? "trade-metrics.json", JSON.stringify({ rows: out, signatures }, null, 1));
  }, 7_200_000);
});
