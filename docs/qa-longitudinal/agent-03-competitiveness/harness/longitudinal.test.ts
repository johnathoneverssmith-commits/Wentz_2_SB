/**
 * Agent 3 longitudinal harness — REAL engine (online/src/blocks.ts simulateBlock/simulatePlayoffBlock), headless, no DB, no browser.
 * To run: copy to online/test/_a3_longitudinal.test.ts (untracked scratch) and
 *   A3=1 A3_SEEDS=9301,9302,9303 A3_SEASONS=5 A3_OUT=out.json NFL_POOL_PATH=... npx vitest run --root online test/_a3_longitudinal.test.ts
 * Variants (same seed => same league, schedule start): "cpu" = KC run by the CPU like everyone else;
 * "sabotage" = KC's depth chart is re-set worst-first at QB/OL/EDGE/CB every step (a deliberately poor GM decision).
 * No human GM exists, so the CPU runs every team's draft / FA / trades. Not a substitute for UI play.
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

const ON = !!process.env.A3;
const SEEDS = (process.env.A3_SEEDS ?? "9301").split(",").map(Number);
const SEASONS = Number(process.env.A3_SEASONS ?? 5);
const TALENT = process.env.A3_TALENT; // optional talentImpact override
const FOCAL = "KC";
const sim = new MockSimulationService();

function make(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, ...(TALENT ? { talentImpact: Number(TALENT) } : {}) } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s);
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason"; s.week = 1; clearReadinessOnline(s);
  return s;
}
const SAB = ["QB", "OT", "OG", "C", "EDGE", "CB"];
function sabotage(s: LeagueState): void {
  const ps = Object.values(s.players).filter((p) => p.nfl_team === FOCAL && !p.retired && !p.free_agent);
  s.depthChart[FOCAL] ??= {} as any;
  for (const pos of SAB) (s.depthChart[FOCAL] as any)[pos] = ps.filter((p) => p.position === pos).sort((a, b) => a.overall - b.overall).map((p) => p.id);
}
function wins(s: LeagueState): Record<string, number> {
  const w: Record<string, number> = Object.fromEntries(Object.keys(s.teams).map((c) => [c, 0]));
  for (const g of s.games) if (g.phase === "REG" && g.played) { if (g.homeScore > g.awayScore) w[g.homeTeam]!++; else if (g.awayScore > g.homeScore) w[g.awayTeam]!++; }
  return w;
}
function season(s: LeagueState, variant: string) {
  const ending = s.season; let g = 0;
  while (s.stage !== "playoffs") { if (g++ > 80) throw new Error("no playoffs"); if (variant === "sabotage") sabotage(s); finishPlayedWeek(s); }
  const w = wins(s); const ovr = Object.fromEntries(Object.entries(s.teams).map(([c, t]) => [c, t.ratings.overall]));
  let champ: string | null = null; g = 0;
  while (s.season === ending) { champ = s.bracket?.champion ?? champ; if (g++ > 60) throw new Error("stuck " + s.stage); if (variant === "sabotage") sabotage(s);
    for (const x of s.gms) s.readiness[x.id] = true; advanceStage(s); champ = s.bracket?.champion ?? champ; }
  const champion = s.history?.[s.history.length - 1] ?? null;
  g = 0; while ((s.stage as string) !== "preseason" && g++ < 80) { for (const x of s.gms) s.readiness[x.id] = true; advanceStage(s); }
  return { season: ending, wins: w, ovr, champion: champ };
}
describe.skipIf(!ON)("agent3 longitudinal", () => {
  it("runs", () => {
    const out: any[] = [];
    for (const seed of SEEDS) for (const variant of ["cpu", "sabotage"]) {
      const s = make(seed);
      for (let y = 0; y < SEASONS; y++) { const r = season(s, variant); out.push({ seed, variant, ...r }); }
    }
    writeFileSync(process.env.A3_OUT ?? "a3_long.json", JSON.stringify(out));
  }, 7_200_000);
});
