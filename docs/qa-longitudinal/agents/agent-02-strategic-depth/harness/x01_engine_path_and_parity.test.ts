/**
 * Agent 2 (strategic depth) X0 + X1. REAL engine, headless, no DB, no browser.
 * Copy to online/test/_a2s_x01.test.ts (scratch, untracked) and run:
 *   A2S=1 A2S_SEEDS=9401,... A2S_SEASONS=8 A2S_OUT=out.json NFL_POOL_PATH=$PWD/ui-source/src/data/pool-2026.json \
 *     npx vitest run --root online test/_a2s_x01.test.ts
 * X0: counts calls to the real engine's simulateGame and to every MockSimulationService method during one league-season.
 * X1: every team CPU-managed for N seasons; records wins, team overall, payroll, champion per team-season.
 */
import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";

const counts = { engine: 0, mock: {} as Record<string, number> };
vi.mock("../../src/engine/sim.js", async (orig) => {
  const m: any = await orig();
  return { ...m, simulateGame: (...a: any[]) => { counts.engine++; return m.simulateGame(...a); } };
});

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, capUsedOf } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

const ON = !!process.env.A2S;
const SEEDS = (process.env.A2S_SEEDS ?? "9401").split(",").map(Number);
const SEASONS = Number(process.env.A2S_SEASONS ?? 8);
const TALENT = process.env.A2S_TALENT;
const sim = new MockSimulationService();
for (const k of Object.getOwnPropertyNames(MockSimulationService.prototype)) {
  if (k === "constructor") continue;
  const f = (MockSimulationService.prototype as any)[k];
  if (typeof f !== "function") continue;
  (MockSimulationService.prototype as any)[k] = function (...a: any[]) { counts.mock[k] = (counts.mock[k] ?? 0) + 1; return f.apply(this, a); };
}

function make(seed: number): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, ...(TALENT ? { talentImpact: Number(TALENT) } : {}) } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s);
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason"; s.week = 1; clearReadinessOnline(s);
  return s;
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
  const roster = Object.fromEntries(Object.keys(s.teams).map((c) => {
    const ps = Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired && !p.free_agent);
    const top = ps.sort((a, b) => b.overall - a.overall).slice(0, 24);
    return [c, { n: ps.length, top24: top.reduce((a, p) => a + p.overall, 0) / Math.max(1, top.length), age: top.reduce((a, p) => a + (p.age ?? 0), 0) / Math.max(1, top.length) }];
  }));
  let champ: string | null = null; g = 0;
  while (s.season === ending) { champ = s.bracket?.champion ?? champ; if (g++ > 60) throw new Error("stuck " + s.stage);
    for (const x of s.gms) s.readiness[x.id] = true; advanceStage(s); champ = s.bracket?.champion ?? champ; }
  g = 0; while ((s.stage as string) !== "preseason" && g++ < 80) { for (const x of s.gms) s.readiness[x.id] = true; advanceStage(s); }
  return { season: ending, wins: w, ovr, pay, roster, champion: champ };
}
describe.skipIf(!ON)("a2s x0/x1", () => {
  it("X0 engine path: one league-season", () => {
    const s = make(9400); counts.engine = 0; counts.mock = {};
    const r = season(s);
    const games = Object.values(r.wins).reduce((a, b) => a + b, 0);
    writeFileSync((process.env.A2S_OUT ?? "a2s").replace(/\.json$/, "") + "_x0.json", JSON.stringify({ engineCalls: counts.engine, mockCalls: counts.mock, regSeasonWinsRecorded: games, champion: r.champion }));
    expect(counts.engine).toBeGreaterThan(250);
  }, 600_000);
  it("X1 parity run", () => {
    const out: any[] = [];
    for (const seed of SEEDS) { const s = make(seed); for (let y = 0; y < SEASONS; y++) { out.push({ seed, ...season(s) }); writeFileSync(process.env.A2S_OUT ?? "a2s_x1.json", JSON.stringify(out)); } }
  }, 7_200_000);
});
