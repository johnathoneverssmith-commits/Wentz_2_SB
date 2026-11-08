/**
 * Agent 02: play-level forensic sample. Plays N traced engine games between random franchise teams (fictional-DNA league,
 * default Amplified talent unless A02_TALENT) and writes per-game scoring-event decomposition, drives, 4th-down calls.
 * Gameplay code is untouched. Copy to online/test/_agent02_forensics.test.ts and run with A02F=1.
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { beginDraft, completeDraft } from "@/state/rules.ts";
import { talentScaleOf } from "@/state/talentImpact.ts";
import { simulateGame } from "../../src/engine/sim.js";
import { Roster } from "../../src/engine/roster.js";
import { weatherFor } from "../../src/engine/weather.js";
import { toEngine } from "../src/blocks.js";
import { autopilotAbsent, isTurnStage, readyUpLocal } from "../src/phases.js";
import { emptyReveal } from "@/state/reveal.ts";

const ON = !!process.env.A02F;
const SEED = Number(process.env.A02_SEED ?? 7001);
const N = Number(process.env.A02_GAMES ?? 4000);
const TALENT = (process.env.A02_TALENT ?? "amplified") as "realistic" | "amplified" | "extreme";
const WARM = Number(process.env.A02_WARM ?? 0); // seasons to simulate through the real phase machine before sampling
const OUT = process.env.A02_OUT ?? `/tmp/a02/forensics_${SEED}_${TALENT}.json`;

describe.skipIf(!ON)("agent02 forensics", () => {
  it("runs", { timeout: 6 * 3_600_000 }, () => {
    const s: LeagueState = createLeague(SEED, { ...DEFAULT_CONFIG, humanGmCount: 1, talentImpact: TALENT });
    s.gms[0]!.teamCode = "KC"; s.gms[0]!.isHuman = true;
    beginDraft(s, "fantasy"); completeDraft(s); fillRosterGaps(s); recomputeTeamRatings(s);
    if (WARM > 0) {
      const sim = new MockSimulationService();
      s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams)); s.stage = "preseason"; s.week = 1; s.reveal = emptyReveal();
      const target = s.season + WARM; let guard = 0;
      while (!(s.season >= target && s.stage === "preseason")) {
        if (guard++ > 6000) throw new Error(`warm-up stuck in ${s.stage}`);
        if (isTurnStage(s.stage)) autopilotAbsent(s);
        for (const g of s.gms) if (g.isHuman) s.readiness[g.id] = true;
        readyUpLocal(s);
      }
    }
    const codes = Object.keys(s.teams);
    const rosters: Record<string, Roster> = {};
    for (const c of codes) {
      const squad = Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired && !p.free_agent);
      rosters[c] = new Roster(toEngine(c), squad as any, s.depthChart[c] as any);
    }
    const games: unknown[] = [];
    let k = 0;
    for (let i = 0; i < N; i++) {
      const h = codes[(i * 7 + (i >> 5)) % 32]!; let a = codes[(i * 13 + 5 + (i >> 3)) % 32]!;
      if (a === h) a = codes[(codes.indexOf(h) + 1) % 32]!;
      const seed = 880000 + SEED * 100000 + k++;
      const g = simulateGame(seed, toEngine(h), toEngine(a), {
        homeRoster: rosters[h], awayRoster: rosters[a], trace: true, injuries: true,
        talentScale: talentScaleOf(s.config), overtime: "nfl", weather: weatherFor(toEngine(h), "REG", 1 + (i % 18), seed),
      } as any);
      const ev = ((g as any).eventLog ?? []).filter((e: any) => e.type === "score").map((e: any) => [e.side, e.points, e.kind, e.quarter]);
      const ot = ((g as any).eventLog ?? []).some((e: any) => e.type === "overtime_start" || e.type === "overtime");
      const tr = (g as any).playTrace ?? [];
      const fourth = tr.filter((p: any) => p.down === 4).map((p: any) => [p.call, p.ydstogo, p.ballOn, p.outcome, p.team, p.quarter, g.score[p.team] - g.score[1 - p.team]]);
      const drives = ((g as any).drivesLog ?? []).map((d: any) => [d.team, d.startYl, d.result, d.plays, d.points]);
      games.push({ h, a, score: g.score, ev, ot, fourth, drives, nplays: tr.length, evTypes: [...new Set(((g as any).eventLog ?? []).map((e: any) => e.type))] });
    }
    writeFileSync(OUT, JSON.stringify({ seed: SEED, talent: TALENT, games }));
  });
});
