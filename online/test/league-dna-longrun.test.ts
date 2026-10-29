import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";

import type { LeagueState, Position } from "@/domain";
import { POSITIONS } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { beginDraft, completeDraft } from "@/state/rules.ts";
import { starterMeans } from "@/state/draftSupply.ts";
import { neutralStarterMeans } from "@/sim/leagueDna/targets";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

/**
 * Long-run stability of Seeded League DNA: whole league-years through the server's own stage machine, for a League DNA
 * league and a legacy one, with talent supply, positional drift and draft-class variation read off at every preseason.
 *
 *   LONGRUN=1 LONGRUN_OUT=out.json LONGRUN_SEEDS=9101,9102 LONGRUN_SEASONS=15 npx vitest run --root online test/league-dna-longrun.test.ts
 *
 * Off unless LONGRUN is set (a league-year takes about a minute), so it reports as skipped in CI.
 */
const ON = !!process.env.LONGRUN;
const SEEDS = (process.env.LONGRUN_SEEDS ?? "9101,9102,9103,9104").split(",").map(Number);
const SEASONS = Number(process.env.LONGRUN_SEASONS ?? 15);
const MODES = (process.env.LONGRUN_MODES ?? "fictional,legacy").split(",") as ("fictional" | "legacy")[];
const sim = new MockSimulationService();
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);

function league(seed: number, playerPool: "fictional" | "legacy"): LeagueState {
  const state = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 2, playerPool });
  state.gms[0]!.teamCode = "KC";
  state.gms[0]!.isHuman = true;
  state.gms[1]!.teamCode = "BUF";
  state.gms[1]!.isHuman = true;
  beginDraft(state, "fantasy");
  completeDraft(state);
  fillRosterGaps(state);
  recomputeTeamRatings(state);
  state.schedule = sim.generateSchedule(state.season, Object.keys(state.teams));
  state.stage = "preseason";
  state.week = 1;
  clearReadinessOnline(state);
  return state;
}

function rollOver(s: LeagueState): void {
  const ending = s.season;
  let g = 0;
  while (s.stage !== "playoffs") {
    if (g++ > 60) throw new Error("never reached the playoffs");
    finishPlayedWeek(s);
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

function snapshot(s: LeagueState) {
  const active = Object.values(s.players).filter((p) => !p.retired);
  const rostered = active.filter((p) => s.teams[p.nfl_team]);
  const sizes = Object.keys(s.teams).map((c) => rostered.filter((p) => p.nfl_team === c).length);
  const starters = starterMeans(s);
  const classByPos: Record<string, number> = {};
  for (const pos of POSITIONS) {
    const top = s.draftClass.filter((p) => p.position === pos).map((p) => p.trueOverall).sort((a, b) => b - a).slice(0, 12);
    classByPos[pos] = mean(top);
  }
  return {
    season: s.season,
    n85: active.filter((p) => p.overall >= 85).length,
    n90: active.filter((p) => p.overall >= 90).length,
    n75: active.filter((p) => p.overall >= 75).length,
    meanAge: mean(rostered.map((p) => p.age)),
    rosterMin: Math.min(...sizes),
    rosterMax: Math.max(...sizes),
    starters,
    classQuality: mean(s.draftClass.map((p) => p.trueOverall)),
    classByPos,
    classSize: s.draftClass.length,
    classTopPos: Object.fromEntries(POSITIONS.map((p) => [p, s.draftClass.filter((x) => x.position === p).length])),
  };
}

describe.skipIf(!ON)("League DNA long run", () => {
  it(
    "plays league-years and reports talent supply and drift",
    { timeout: 3_600_000 },
    () => {
      const out: Record<string, unknown[]> = {};
      for (const mode of MODES) {
        for (const seed of SEEDS) {
          const s = league(seed, mode);
          const rows: ReturnType<typeof snapshot>[] = [snapshot(s)];
          for (let y = 0; y < SEASONS; y++) {
            rollOver(s);
            rows.push(snapshot(s));
          }
          out[`${mode}:${seed}`] = rows;
          // eslint-disable-next-line no-console
          console.log(mode, seed, "n85", rows.map((r) => r.n85).join(","), "roster", rows.at(-1)!.rosterMin, rows.at(-1)!.rosterMax);
        }
      }
      (out as Record<string, unknown>).neutral = neutralStarterMeans() as unknown as unknown[];
      if (process.env.LONGRUN_OUT) writeFileSync(process.env.LONGRUN_OUT, JSON.stringify(out));
      void ({} as Position);
    },
  );
});
