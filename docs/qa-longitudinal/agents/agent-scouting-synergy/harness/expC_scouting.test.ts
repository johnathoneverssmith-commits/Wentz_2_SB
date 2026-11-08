/**
 * Experiment C: value of scouting information and of scouting-resource allocation. Real draft machinery, real class generator,
 * real CPU drafts for the 21 untreated teams, real roster-rating recompute; NO games are simulated (see EXPERIMENTS.md for why
 * the game-level link is taken from PR #105's X2 and the engine experiments).
 * Copy to online/test/_ss_c.test.ts and run:
 *   SS=1 SS_SEEDS=1,...,N SS_ARMS=public,top24,... SS_OUT=out.json NFL_POOL_PATH=... npx vitest run --root online test/_ss_c.test.ts
 *
 * Scouting model (a PROPOSAL, implemented here only in the harness):
 *   E_pub  = the public board's projection (expectedRatings, accuracy 1)         what the CPU reads today
 *   eps    = trueOverall - E_pub                                                  the part public information cannot see
 *   report = eps + N(0, sigma_tier^2)                                             tier: basic 7, deep 3.5 (rating points)
 *   est    = E_pub + k * report,  k = tau^2 / (tau^2 + sigma^2),  tau = tauOf(public rank) (measured 6.6 .. 11.2)
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { POSITION_VALUE } from "@/sim/MockSimulationService";
import { expectedRatings } from "@/state/draftBoard.ts";
import { applyPick, runAiPicks, signAiDraftPicks, signUnresolvedHumanPicks } from "@/state/rules.ts";
import { onStageEntered } from "../src/phases.js";

const ON = !!process.env.SS;
const SEEDS = (process.env.SS_SEEDS ?? "1").split(",").map(Number);
const ARMS = (process.env.SS_ARMS ?? "public").split(",");
/** Measured sd of eps (= true - public projection) by public-rank bucket of 32 (30 classes, 9,600 prospects): 6.6 7.7 8.7 8.9 10.0 10.4 11.0 11.0 11.2 */
const TAU_BY_BUCKET = [6.6, 7.7, 8.7, 8.9, 10.0, 10.4, 11.0, 11.0, 11.2];
const tauOf = (rank: number): number => TAU_BY_BUCKET[Math.min(8, Math.floor((rank - 1) / 32))]!;
const phi = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
const Phi = (z: number) => 0.5 * (1 + (z >= 0 ? 1 : -1) * Math.sqrt(1 - Math.exp(-2 * z * z / Math.PI)));
const CAP: Record<string, number> = { QB: 1, RB: 1, WR: 2, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, OLB: 2, ILB: 1, CB: 2, S: 2, K: 0, P: 0 };
const POS12 = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "ILB", "CB", "S"];
const hash = (str: string) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function gauss(key: string): number { let a = hash(key + "a") / 4294967296 || 1e-9, b = hash(key + "b") / 4294967296; return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }

function fresh(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s); recomputeTeamRatings(s);
  s.stage = "offseasonDraft" as any;
  return s;
}
const treatedOf = (s: LeagueState) => Object.keys(s.teams).sort().filter((_, i) => i % 3 === 0);

type Plan = { basic: Set<string>; deep: Set<string> };
function planScouting(arm: string, s: LeagueState, team: string, ePub: Map<string, number>): Plan {
  const plan: Plan = { basic: new Set(), deep: new Set() };
  const m = arm.match(/^(basic|deep)(\d+)-(top|window|need|needwin|random|voi)$/);
  if (!m) return plan;
  const [, tier, nStr, strat] = m; const n = Number(nStr);
  const ranked = [...s.draftClass].sort((a, b) => (ePub.get(b.id)! - ePub.get(a.id)!) || (a.id < b.id ? -1 : 1));
  const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
  let cand = ranked;
  if (strat === "window") {
    const picks = (s.draft!.pickOrder as string[]).map((t, i) => (t === team ? i + 1 : 0)).filter(Boolean).slice(0, 5);
    const inWin = (r: number) => picks.some((p) => r >= p - 8 && r <= p + 16);
    cand = ranked.filter((p) => inWin(rankOf.get(p.id)!));
  } else if (strat === "need" || strat === "needwin") {
    const best = new Map<string, number>(); const lg = new Map<string, number[]>();
    for (const p of Object.values(s.players)) if (!p.retired && p.nfl_team === team) best.set(p.position, Math.max(best.get(p.position) ?? 0, p.overall));
    for (const p of Object.values(s.players)) if (!p.retired && p.nfl_team !== team && p.nfl_team !== "FA") { const l = lg.get(p.position) ?? []; l.push(p.overall); lg.set(p.position, l); }
    const gap = POS12.map((pos) => { const l = (lg.get(pos) ?? [70]).sort((a, b) => b - a); const top = l.filter((_, i) => i % 31 === 0).slice(0, 32); const mean = top.reduce((a, b) => a + b, 0) / top.length; return [pos, (best.get(pos) ?? 40) - mean] as const; }).sort((a, b) => a[1] - b[1]).slice(0, 4).map((x) => x[0]);
    cand = ranked.filter((p) => gap.includes(p.position));
    if (strat === "needwin") {
      const picks = (s.draft!.pickOrder as string[]).map((t, i) => (t === team ? i + 1 : 0)).filter(Boolean).slice(0, 5);
      cand = cand.filter((p) => picks.some((pk) => rankOf.get(p.id)! >= pk - 8 && rankOf.get(p.id)! <= pk + 40));
    }
  } else if (strat === "random") {
    cand = [...ranked].sort((a, b) => hash(team + a.id) - hash(team + b.id));
  }
  if (strat === "voi") {
    // value of information: for each of my first 5 picks, how much could a report change the best option?
    const picks = (s.draft!.pickOrder as string[]).map((t, i) => (t === team ? i + 1 : 0)).filter(Boolean).slice(0, 5);
    const sigma = tier === "deep" ? 3.5 : 7;
    const scored = ranked.map((p) => {
      const r = rankOf.get(p.id)!, tau = tauOf(r), k = tau * tau / (tau * tau + sigma * sigma), sMove = tau * Math.sqrt(k);
      let v = 0;
      for (const pk of picks) { const eb = ePub.get(ranked[Math.min(ranked.length - 1, pk - 1 + 2)]!.id)!; const z = Math.abs(ePub.get(p.id)! - eb) / sMove; v += sMove * (phi(z) - z * (1 - Phi(z))); }
      return { p, v: v * Math.max(0.2, POSITION_VALUE[p.position] ?? 1) };
    }).sort((a, b) => b.v - a.v);
    cand = scored.map((x) => x.p);
  }
  for (const p of cand.slice(0, n)) (tier === "deep" ? plan.deep : plan.basic).add(p.id);
  return plan;
}
function run(seed: number, arm: string) {
  const s = fresh(seed);
  const T = new Set(arm === "control" ? [] : treatedOf(s));
  const fake = [...T].map((t, i) => ({ ...s.gms[0]!, id: `ss_${i}`, teamCode: t, isHuman: true }));
  s.gms.push(...fake);
  for (const g of s.gms) s.readiness[g.id] = true;
  onStageEntered(s, "offseasonRetirement");
  const ePub = expectedRatings(s.draftClass, 1);
  const eps = new Map(s.draftClass.map((p) => [p.id, p.trueOverall - ePub.get(p.id)!]));
  const rankOf = new Map([...s.draftClass].sort((a, b) => (ePub.get(b.id)! - ePub.get(a.id)!) || (a.id < b.id ? -1 : 1)).map((p, i) => [p.id, i + 1]));
  const plans = new Map([...T].map((t) => [t, planScouting(arm, s, t, ePub)]));
  const drafted = new Map<string, number>(); const picksOf: Record<string, number[]> = {};
  let guard = 0;
  while (s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && guard++ < 600) {
    const team = s.draft.pickOrder[s.draft.currentPickIndex]!;
    if (!T.has(team)) { runAiPicks(s); continue; }
    const taken = new Set(s.draft.results.map((r) => r.selectedId));
    const plan = plans.get(team)!; let best: any = null, bs = -1e9;
    for (const p of s.draftClass) {
      if (taken.has(p.id)) continue;
      if ((drafted.get(`${team}|${p.position}`) ?? 0) >= (CAP[p.position] ?? 1)) continue;
      let est = ePub.get(p.id)!;
      if (arm === "perfect") est = p.trueOverall;
      else if (plan.deep.has(p.id) || plan.basic.has(p.id)) {
        const sigma = plan.deep.has(p.id) ? 3.5 : 7; const tau = tauOf(rankOf.get(p.id)!); const k = tau * tau / (tau * tau + sigma * sigma);
        est = ePub.get(p.id)! + k * (eps.get(p.id)! + sigma * gauss(`${seed}|${p.id}|${plan.deep.has(p.id) ? "d" : "b"}`));
      }
      const sc = (est - 50) * (POSITION_VALUE[p.position] ?? 1);
      if (sc > bs) { bs = sc; best = p; }
    }
    drafted.set(`${team}|${best.position}`, 1 + (drafted.get(`${team}|${best.position}`) ?? 0));
    (picksOf[team] ??= []).push(best.trueOverall);
    applyPick(s, best.id);
  }
  s.gms = s.gms.filter((g) => !g.id.startsWith("ss_"));
  // the human flag is gone: every drafted player is signed the CPU way
  const hum = new Set<string>();
  signAiDraftPicks(s); signUnresolvedHumanPicks(s);
  recomputeTeamRatings(s);
  return { rating: Object.fromEntries(Object.keys(s.teams).map((c) => [c, s.teams[c]!.ratings.exact?.overall ?? s.teams[c]!.ratings.overall])), picks: picksOf, treated: [...T] };
}
describe.skipIf(!ON)("scouting experiment C", () => {
  it("runs", () => {
    const out: any[] = [];
    for (const seed of SEEDS) {
      const ctrl = run(seed, "control");
      out.push({ seed, arm: "control", rating: ctrl.rating });
      for (const arm of ARMS) { const r = run(seed, arm); out.push({ seed, arm, rating: r.rating, picks: r.picks, treated: r.treated }); }
      writeFileSync(process.env.SS_OUT ?? "expC.json", JSON.stringify(out));
    }
  }, 7_200_000);
});
