/**
 * X2: does DRAFT QUALITY pay off over 3 drafts? REAL engine, headless, matched leagues.
 * Copy to online/test/_a2s_x02.test.ts and run:
 *  A2S=1 A2S_ARM=skilled|poor|oracle|base A2S_SEEDS=9401,9402 A2S_SEASONS=4 A2S_OUT=out.json NFL_POOL_PATH=... npx vitest run --root online test/_a2s_x02.test.ts
 * Treated teams (every third team in code order, 11 of 32) draft by policy; the other 21 and every other decision stay CPU-run.
 * All policies: at most CAP[pos] picks per position per draft (QB1 RB1 WR2 TE1 OT2 OG2 C1 EDGE2 DT2 OLB2 ILB1 CB2 S2 K0 P0).
 *  skilled: argmax (visible collegeOverall - 50) * engine-measured POSITION_VALUE      (information a human has)
 *  board  : same with the public board's projection (expectedRatings: projected round/slot, the CPU's information) instead of the headline college grade
 *  oracle : same with the hidden trueOverall                                            (diagnostic upper bound, not available to a human)
 *  poor   : best visible collegeOverall among low-value positions only (K,P,RB,TE,OLB,S,ILB) (a plausible position-blind mistake)
 * 'base' = nobody treated and must reproduce the X1 run for the same seed (determinism check).
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, capUsedOf } from "@/state/seed.ts";
import { MockSimulationService, POSITION_VALUE } from "@/sim/MockSimulationService";
import { expectedRatings } from "@/state/draftBoard.ts";
import { applyPick, runAiPicks } from "@/state/rules.ts";
import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

const ON = !!process.env.A2S;
const ARM = process.env.A2S_ARM ?? "base";
const SEEDS = (process.env.A2S_SEEDS ?? "9401").split(",").map(Number);
const SEASONS = Number(process.env.A2S_SEASONS ?? 4);
const sim = new MockSimulationService();
const LOW = new Set(["K", "P", "RB", "TE", "OLB", "S", "ILB"]);

function make(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s);
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason"; s.week = 1; clearReadinessOnline(s);
  return s;
}
const treated = (s: LeagueState) => Object.keys(s.teams).sort().filter((_, i) => i % 3 === 0);
const CAP: Record<string, number> = { QB: 1, RB: 1, WR: 2, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, OLB: 2, ILB: 1, CB: 2, S: 2, K: 0, P: 0 };
let drafted = new Map<string, number>(); // team|pos -> picks this draft (positional cap so no policy stacks a position)
function choose(s: LeagueState, team: string): string {
  const taken = new Set(s.draft!.results.map((r) => r.selectedId));
  const pool = s.draftClass.filter((p) => !taken.has(p.id));
  const val = (p: (typeof pool)[number], o: number) => (o - 50) * (POSITION_VALUE[p.position] ?? 1);
  const exp = ARM === "board" ? expectedRatings(pool, 1) : null;
  let best = pool[0]!, bs = -1e9;
  for (const p of pool) {
    if ((drafted.get(`${team}|${p.position}`) ?? 0) >= (CAP[p.position] ?? 1)) continue;
    let sc: number;
    if (ARM === "oracle") sc = val(p, p.trueOverall);
    else if (ARM === "poor") sc = LOW.has(p.position) ? p.collegeOverall : p.collegeOverall - 100;
    else if (exp) sc = val(p, exp.get(p.id) ?? 50);
    else sc = val(p, p.collegeOverall);
    if (sc > bs) { bs = sc; best = p; }
  }
  return best.id;
}
let treatedRookies: { true: number; college: number; pos: string }[] = [];
function treatedDraft(s: LeagueState, T: Set<string>) {
  drafted = new Map();
  const fake = [...T].map((t, i) => ({ ...s.gms[0]!, id: `a2s_${i}`, teamCode: t, isHuman: true }));
  s.gms.push(...fake);
  for (const g of s.gms) s.readiness[g.id] = true;
  advanceStage(s); // offseasonRetirement -> offseasonDraft; CPU picks run to the first treated pick
  let guard = 0;
  while (s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && guard++ < 400) {
    const team = s.draft.pickOrder[s.draft.currentPickIndex]!;
    if (T.has(team)) {
      const id = choose(s, team); drafted.set(`${team}|${s.draftClass.find((p) => p.id === id)!.position}`, 1 + (drafted.get(`${team}|${s.draftClass.find((p) => p.id === id)!.position}`) ?? 0)); const pr = s.draftClass.find((p) => p.id === id)!;
      treatedRookies.push({ true: pr.trueOverall, college: pr.collegeOverall, pos: pr.position });
      applyPick(s, id);
    } else runAiPicks(s);
  }
  s.gms = s.gms.filter((g) => !g.id.startsWith("a2s_"));
}
function wins(s: LeagueState): Record<string, number> {
  const w: Record<string, number> = Object.fromEntries(Object.keys(s.teams).map((c) => [c, 0]));
  for (const g of s.games) if (g.phase === "REG" && g.played) { if (g.homeScore > g.awayScore) w[g.homeTeam]!++; else if (g.awayScore > g.homeScore) w[g.awayTeam]!++; }
  return w;
}
function season(s: LeagueState) {
  const ending = s.season; let g = 0;
  while (s.stage !== "playoffs") { if (g++ > 80) throw new Error("no playoffs"); finishPlayedWeek(s); }
  const w = wins(s);
  const ovr = Object.fromEntries(Object.entries(s.teams).map(([c, t]) => [c, t.ratings.overall]));
  const pay = Object.fromEntries(Object.keys(s.teams).map((c) => [c, capUsedOf(s, c)]));
  const top24 = Object.fromEntries(Object.keys(s.teams).map((c) => { const ps = Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired && !p.free_agent).sort((a, b) => b.overall - a.overall).slice(0, 24); return [c, ps.reduce((a, p) => a + p.overall, 0) / Math.max(1, ps.length)]; }));
  const T = new Set(treated(s));
  let champ: string | null = null; g = 0;
  while (s.season === ending) {
    champ = s.bracket?.champion ?? champ; if (g++ > 80) throw new Error("stuck " + s.stage);
    if (ARM !== "base" && s.stage === ("offseasonRetirement" as any)) { treatedDraft(s, T); continue; }
    for (const x of s.gms) s.readiness[x.id] = true; advanceStage(s); champ = s.bracket?.champion ?? champ;
  }
  g = 0; while ((s.stage as string) !== "preseason" && g++ < 80) {
    if (ARM !== "base" && s.stage === ("offseasonRetirement" as any)) { treatedDraft(s, T); continue; }
    for (const x of s.gms) s.readiness[x.id] = true; advanceStage(s);
  }
  return { season: ending, wins: w, ovr, top24, pay, champion: champ };
}
describe.skipIf(!ON)("a2s x02", () => {
  it("runs", () => {
    const out: any[] = [];
    for (const seed of SEEDS) {
      const s = make(seed); treatedRookies = [];
      for (let y = 0; y < SEASONS; y++) { out.push({ arm: ARM, seed, treatedTeams: treated(s), ...season(s) }); }
      out.push({ arm: ARM, seed, rookies: treatedRookies });
      writeFileSync(process.env.A2S_OUT ?? "a2s_x02.json", JSON.stringify(out));
    }
  }, 7_200_000);
});
