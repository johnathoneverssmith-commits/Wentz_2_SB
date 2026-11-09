import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings, applySeasonAging } from "@/state/seed.ts";
import { expectedRatings } from "@/state/draftBoard.ts";
import { publicRanks, spendReport, suggestTargets, runCpuScouting, HUMAN_POINTS, reportsFor } from "@/state/scouting.ts";
import { difficultyFor } from "@/state/aiGms.ts";
import { runAiPicks, signAiDraftPicks, signUnresolvedHumanPicks } from "@/state/rules.ts";
import { onStageEntered } from "../src/phases.js";

const ON = !!process.env.SS;
const SEEDS = (process.env.SS_SEEDS ?? "1").split(",").map(Number);
const ARMS = (process.env.SS_ARMS ?? "need24").split(",");
function fresh(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s); recomputeTeamRatings(s);
  s.stage = "offseasonDraft" as any;
  return s;
}
const treatedOf = (s: LeagueState) => Object.keys(s.teams).sort().filter((_, i) => i % 3 === 0);
const snap = (s: LeagueState) => Object.fromEntries(Object.keys(s.teams).map((c) => [c, s.teams[c]!.ratings.exact?.overall ?? s.teams[c]!.ratings.overall]));

function run(seed: number, arm: string) {
  const s = fresh(seed);
  const T = arm === "control" ? [] : arm === "league" || arm === "mixed" || arm === "cpuonly" || arm === "mixedtop" ? Object.keys(s.teams) : treatedOf(s);
  const human = new Set(arm === "mixed" || arm === "cpuonly" || arm === "mixedtop" ? treatedOf(s) : []);
  // hold the draft at pick 0: a human GM on every team, removed once the reports are bought
  const fake = Object.keys(s.teams).map((t, i) => ({ ...s.gms[0]!, id: `ss_${i}`, teamCode: t, isHuman: true }));
  s.gms.push(...fake);
  for (const g of s.gms) s.readiness[g.id] = true;
  onStageEntered(s, "offseasonRetirement");
  const exp = expectedRatings(s.draftClass, 1), rank = publicRanks(s.draftClass, exp);
  const spent: Record<string, number> = {};
  for (const t of T) {
    if (arm === "cpuonly" && human.has(t)) continue;
    if (arm === "top24" || (arm === "mixedtop" && human.has(t))) {
      const ids = [...s.draftClass].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!).slice(0, HUMAN_POINTS).map((p) => p.id);
      for (const id of ids) spendReport(s, t, id, HUMAN_POINTS);
    } else if ((arm === "league" || arm === "mixed" || arm === "cpuonly" || arm === "mixedtop") && !human.has(t)) runCpuScouting(s, t, ((b) => b)(Math.min(HUMAN_POINTS, difficultyFor(s, t).scoutingAccuracy >= 0.9 ? 24 : difficultyFor(s, t).scoutingAccuracy >= 0.7 ? 18 : 12)));
    else runCpuScouting(s, t, HUMAN_POINTS);
    spent[t] = Object.keys(reportsFor(s, t, s.draft!.year)).length;
  }
  // report quality vs truth (harness only: the test may read truth, the product path may not)
  const q: any[] = [];
  for (const t of T) for (const [id, r] of Object.entries(reportsFor(s, t, s.draft!.year))) { const p = s.draftClass.find((x) => x.id === id)!; q.push({ t, id, rank: rank.get(id), pub: exp.get(id), est: r.estimate, lo: r.lo, hi: r.hi, tru: p.trueOverall, col: p.collegeOverall, pos: p.position }); }
  s.gms = s.gms.filter((g) => !g.id.startsWith("ss_"));
  let g = 0;
  while (s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && g++ < 600) runAiPicks(s);
  signAiDraftPicks(s); signUnresolvedHumanPicks(s); recomputeTeamRatings(s);
  const out: any = { seed, arm, treated: human.size ? [...human] : T, cpu: human.size ? T.filter((x) => !human.has(x)) : [], spent, q, rating: { 0: snap(s) } };
  const picks: Record<string, number[]> = {};
  for (const r of s.draft!.results) if (r.selectedId) { (picks[r.teamCode] ??= []).push(r.selectedId); }
  out.picks = picks; out.truth = Object.fromEntries(s.draftClass.map((p) => [p.id, p.trueOverall])); out.cls = s.draftClass.map((p) => [p.collegeOverall, p.trueOverall, exp.get(p.id)]);
  if (process.env.SS_YEARS) for (let y = 1; y <= 5; y++) { applySeasonAging(s, s.season + y); if (y === 1 || y === 3 || y === 5) { recomputeTeamRatings(s); out.rating[y] = snap(s); } }
  return out;
}
describe.skipIf(!ON)("scouting slice", () => {
  it("runs", () => {
    const out: any[] = [];
    for (const seed of SEEDS) { out.push(run(seed, "control")); for (const a of ARMS) out.push(run(seed, a)); writeFileSync(process.env.SS_OUT ?? "slice.json", JSON.stringify(out)); }
  }, 7_200_000);
});
