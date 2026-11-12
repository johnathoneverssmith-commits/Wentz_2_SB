/**
 * Scouting pilot: budget harness (opt-in; skipped unless SS=1, so CI never runs it).
 *
 * For each seed it drafts the same class under matched arms and records team ratings after rookies sign:
 *   control        nobody scouts (today's draft)
 *   B<n>_skip      each CPU GM buys n reports; the 11 scripted-human teams buy none
 *   B<n>_need24    same, and the scripted-human teams buy 24 reports at their positions of need
 *   B<n>_top24     same, but the scripted-human teams buy the 24 best-ranked prospects
 * Scripted-human teams are every third team by sorted code. Rating = team ratings.exact.overall.
 *
 *   SS=1 SS_SEEDS=9901,9902,... SS_ARMS=B12_skip,B12_need24 SS_OUT=/tmp/out.json \
 *     npx vitest run --root online test/scouting-budget.test.ts
 *   node analysis/scouting-pilot/summarize.cjs /tmp/out.json
 *
 * Reads hidden ratings only to score reports (q); that is allowed in a harness, never in the product path.
 */
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
  // arm = "control" | "B<cpuBudget>_<policy>", policy in skip|need24|top24
  const s = fresh(seed);
  const m = /^B(\d+)_(skip|need24|top24)$/.exec(arm);
  const B = m ? Number(m[1]) : 0, pol = m ? m[2]! : "skip";
  const humans = new Set(treatedOf(s));
  const fake = Object.keys(s.teams).map((t, i) => ({ ...s.gms[0]!, id: `ss_${i}`, teamCode: t, isHuman: true }));
  s.gms.push(...fake);
  for (const g of s.gms) s.readiness[g.id] = true;
  onStageEntered(s, "offseasonRetirement");
  // the draft has opened without buying anything (the flag was off); the harness buys by hand, so switch the flag on for the arms
  if (arm !== "control") s.config.scouting = true;
  const exp = expectedRatings(s.draftClass, 1), rank = publicRanks(s.draftClass, exp);
  const t0 = performance.now();
  let cpuMs = 0; const spent: Record<string, number> = {};
  if (arm !== "control") for (const t of Object.keys(s.teams)) {
    if (humans.has(t)) {
      if (pol === "need24") runCpuScouting(s, t, HUMAN_POINTS);
      else if (pol === "top24") for (const id of [...s.draftClass].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!).slice(0, HUMAN_POINTS).map((p) => p.id)) spendReport(s, t, id, HUMAN_POINTS);
    } else { const c0 = performance.now(); if (B > 0) runCpuScouting(s, t, B); cpuMs += performance.now() - c0; }
    spent[t] = Object.keys(reportsFor(s, t, s.draft!.year)).length;
  }
  const covered = new Set<string>(); const q: number[][] = [];
  for (const t of Object.keys(s.teams)) for (const [id, r] of Object.entries(reportsFor(s, t, s.draft!.year))) { if (!humans.has(t)) covered.add(id); const p = s.draftClass.find((x) => x.id === id)!; q.push([humans.has(t) ? 1 : 0, exp.get(id)!, r.estimate, p.trueOverall, r.lo, r.hi]); }
  s.gms = s.gms.filter((g) => !g.id.startsWith("ss_"));
  const d0 = performance.now(); let g = 0;
  while (s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && g++ < 600) runAiPicks(s);
  const draftMs = performance.now() - d0;
  signAiDraftPicks(s); signUnresolvedHumanPicks(s); recomputeTeamRatings(s);
  const picks: Record<string, string[]> = {};
  for (const r of s.draft!.results) if (r.selectedId) (picks[r.teamCode] ??= []).push(r.selectedId);
  return { seed, arm, humans: [...humans], cpu: Object.keys(s.teams).filter((t) => !humans.has(t)), spent, q, picks, covered: covered.size, cpuScoutMs: cpuMs, draftMs, totalMs: performance.now() - t0, rating: snap(s) };
}
describe.skipIf(!ON)("scouting slice", () => {
  it("runs", () => {
    const out: any[] = [];
    for (const seed of SEEDS) { out.push(run(seed, "control")); for (const a of ARMS) out.push(run(seed, a)); writeFileSync(process.env.SS_OUT ?? "slice.json", JSON.stringify(out)); }
  }, 7_200_000);
});
