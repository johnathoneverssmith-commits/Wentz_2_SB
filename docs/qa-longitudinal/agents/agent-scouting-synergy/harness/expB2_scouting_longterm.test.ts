/**
 * Experiment B2 (multi-season): does scouting DEVELOPMENT (hidden potential gap) add value over 1-5 offseasons beyond the rating reports? Derived from Experiment C. Real draft machinery, real class generator,
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
import { upsertRookiePlayer, applyPick, runAiPicks, signAiDraftPicks, signUnresolvedHumanPicks } from "@/state/rules.ts";
import { applySeasonAging } from "@/state/seed.ts";
import { fittedAttributes } from "@/sim/attributeFit";
import { archetypeById } from "@/sim/leagueDna/archetypes";
import { Rng } from "@/sim/rng";
import { onStageEntered } from "../src/phases.js";


const ON = !!process.env.SS;
const SEEDS = (process.env.SS_SEEDS ?? "1").split(",").map(Number);
const ARMS = (process.env.SS_ARMS ?? "public").split(",");
const BETA3 = 0.458;          // measured: 3-year change in overall per point of (potential - overall)  (data/expB2_pre.json)
const SIGMA_D = 1.0;          // basic development report noise, in sd of the hidden dev draw (k = 0.5)
const CAP: Record<string, number> = { QB: 1, RB: 1, WR: 2, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, OLB: 2, ILB: 1, CB: 2, S: 2, K: 0, P: 0 };
const POS12 = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "ILB", "CB", "S"];
const STARTERS: Record<string, number> = { QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, ILB: 2, CB: 2, S: 2 };
const hash = (str: string) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
function gauss(key: string): number { const a = hash(key + "a") / 4294967296 || 1e-9, b = hash(key + "b") / 4294967296; return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); }
/** Replays upsertRookiePlayer's RNG stream to recover the hidden development draw z (potential = true + max(2, round(mu + sd z))). */
function devZ(s: LeagueState, id: string): number {
  const pr = s.draftClass.find((d) => d.id === id)!;
  const rng = new Rng(fnv(id));
  fittedAttributes(pr.position, pr.trueOverall, () => rng.normal(0, 1));
  if (archetypeById(pr.archetype)) rng.float(0, 0.5);
  return rng.normal(0, 1);
}
const gapOf = (round: number, age: number, z: number) => Math.max(2, Math.round(9 + Math.max(0, 3 - round) - Math.max(0, age - 21) * 1.5 + (round <= 2 ? 6 : 4.5) * z));
const Z_GRID = [-1.6, -1.0, -0.5, 0, 0.5, 1.0, 1.6];
const expGap = (round: number, age: number) => Z_GRID.reduce((a, z) => a + gapOf(round, age, z), 0) / Z_GRID.length;
const treatedOf = (s: LeagueState) => Object.keys(s.teams).sort().filter((_, i) => i % 3 === 0);
function fresh(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s); recomputeTeamRatings(s);
  s.stage = "offseasonDraft" as any;
  return s;
}
const TAU_BY_BUCKET = [6.6, 7.7, 8.7, 8.9, 10.0, 10.4, 11.0, 11.0, 11.2];
const tauOf = (rank: number): number => TAU_BY_BUCKET[Math.min(8, Math.floor((rank - 1) / 32))]!;
function needPositions(s: LeagueState, team: string): string[] {
  const best = new Map<string, number>(); const lg = new Map<string, number[]>();
  for (const p of Object.values(s.players)) { if (p.retired) continue; if (p.nfl_team === team) best.set(p.position, Math.max(best.get(p.position) ?? 0, p.overall)); else if (p.nfl_team !== "FA") { const l = lg.get(p.position) ?? []; l.push(p.overall); lg.set(p.position, l); } }
  return POS12.map((pos) => { const l = (lg.get(pos) ?? [70]).sort((a, b) => b - a); const top = l.filter((_, i) => i % 31 === 0).slice(0, 32); const mean = top.reduce((a, b) => a + b, 0) / top.length; return [pos, (best.get(pos) ?? 40) - mean] as const; }).sort((a, b) => a[1] - b[1]).slice(0, 4).map((x) => x[0]);
}
// arm grammar: public | R24 | RD24 | D24 | Rperf | RDperf | Dperf   (R = rating report, D = development report; 24 basic reports at positions of need)
function run(seed: number, arm: string) {
  const s = fresh(seed);
  const T = new Set(arm === "control" ? [] : treatedOf(s));
  const fake = [...T].map((t, i) => ({ ...s.gms[0]!, id: `ss_${i}`, teamCode: t, isHuman: true }));
  s.gms.push(...fake); for (const g of s.gms) s.readiness[g.id] = true;
  onStageEntered(s, "offseasonRetirement");
  const ePub = expectedRatings(s.draftClass, 1);
  const eps = new Map(s.draftClass.map((p) => [p.id, p.trueOverall - ePub.get(p.id)!]));
  const ranked = [...s.draftClass].sort((a, b) => (ePub.get(b.id)! - ePub.get(a.id)!) || (a.id < b.id ? -1 : 1));
  const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const roundPub = (id: string) => Math.min(7, Math.ceil(rankOf.get(id)! / 32));
  const zTrue = new Map(s.draftClass.map((p) => [p.id, devZ(s, p.id)]));
  const useR = /R/.test(arm), useD = /D/.test(arm);
  const perfect = /perf/.test(arm);
  const scouted = new Map<string, Set<string>>();
  for (const t of T) { const need = needPositions(s, t); scouted.set(t, new Set(ranked.filter((p) => need.includes(p.position)).slice(0, 24).map((p) => p.id))); }
  const drafted = new Map<string, number>(); const pickIds: Record<string, string[]> = {};
  let guard = 0;
  while (s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && guard++ < 600) {
    const team = s.draft.pickOrder[s.draft.currentPickIndex]!;
    if (!T.has(team)) { runAiPicks(s); continue; }
    const taken = new Set(s.draft.results.map((r) => r.selectedId));
    let best: any = null, bs = -1e9;
    for (const p of s.draftClass) {
      if (taken.has(p.id)) continue;
      if ((drafted.get(`${team}|${p.position}`) ?? 0) >= (CAP[p.position] ?? 1)) continue;
      const sc = scouted.get(team)!.has(p.id);
      const tau = tauOf(rankOf.get(p.id)!);
      let est = ePub.get(p.id)!;
      if (arm !== "public") {
        if (useR && perfect) est = p.trueOverall;
        else if (useR && sc) { const k = tau * tau / (tau * tau + 49); est = ePub.get(p.id)! + k * (eps.get(p.id)! + 7 * gauss(`${seed}|${p.id}|b`)); }
      }
      const r0 = roundPub(p.id);
      let gap = expGap(r0, p.age);
      if (useD && (perfect ? true : sc)) { const zhat = perfect ? zTrue.get(p.id)! : (1 / (1 + SIGMA_D * SIGMA_D)) * (zTrue.get(p.id)! + SIGMA_D * gauss(`${seed}|${p.id}|d`)); gap = gapOf(r0, p.age, zhat); }
      const score = (est + BETA3 * gap - 50) * (POSITION_VALUE[p.position] ?? 1);
      if (score > bs) { bs = score; best = p; }
    }
    drafted.set(`${team}|${best.position}`, 1 + (drafted.get(`${team}|${best.position}`) ?? 0));
    (pickIds[team] ??= []).push(best.id);
    applyPick(s, best.id);
  }
  s.gms = s.gms.filter((g) => !g.id.startsWith("ss_"));
  signAiDraftPicks(s); signUnresolvedHumanPicks(s);
  const out: any = { arm, treated: [...T], rating: {} as any, pickOvr: {} as any, rookieStarters: {} as any };
  const snap = (y: number) => {
    recomputeTeamRatings(s);
    out.rating[y] = Object.fromEntries(Object.keys(s.teams).map((c) => [c, s.teams[c]!.ratings.exact?.overall ?? s.teams[c]!.ratings.overall]));
    out.pickOvr[y] = Object.fromEntries([...T].map((t) => [t, (pickIds[t] ?? []).map((id) => s.players[`p_rookie_${id}`]?.overall ?? 0)]));
    out.rookieStarters[y] = Object.fromEntries([...T].map((t) => {
      const mine = new Set((pickIds[t] ?? []).map((id) => `p_rookie_${id}`)); let n = 0, tot = 0;
      for (const [pos, k] of Object.entries(STARTERS)) { const top = Object.values(s.players).filter((p) => !p.retired && p.nfl_team === t && p.position === pos).sort((a, b) => b.overall - a.overall).slice(0, k); tot += top.length; n += top.filter((p) => mine.has(p.id)).length; }
      return [t, n / Math.max(1, tot)];
    }));
  };
  snap(0);
  for (let y = 1; y <= 5; y++) { applySeasonAging(s, s.season + y); if (y === 1 || y === 3 || y === 5) snap(y); }
  return out;
}
describe.skipIf(!ON)("scouting B2", () => {
  it("replay check", () => {
    const s = fresh(9901); const pr = s.draftClass[40]!;
    const z = devZ(s, pr.id); upsertRookiePlayer(s, pr.id, "FA", 3, true);
    const p = s.players[`p_rookie_${pr.id}`]!;
    if (p.potential! !== Math.min(99, pr.trueOverall + gapOf(3, pr.age, z))) throw new Error(`replay mismatch ${p.potential} vs ${pr.trueOverall + gapOf(3, pr.age, z)}`);
  });
  it("runs", () => {
    const out: any[] = [];
    for (const seed of SEEDS) {
      const ctrl = run(seed, "control"); out.push({ seed, ...ctrl });
      for (const arm of ARMS) out.push({ seed, ...run(seed, arm) });
      writeFileSync(process.env.SS_OUT ?? "expB2.json", JSON.stringify(out));
    }
  }, 7_200_000);
});
