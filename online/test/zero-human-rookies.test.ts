import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { syncAiGms } from "@/state/aiGms.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { runPendingCpuTurns } from "../src/decide.js";
import { advanceStage, clearReadinessOnline, finishPlayedWeek, readyUpLocal } from "../src/phases.js";

/**
 * A league nobody is running. The last human leaving (`vacateSeat`) leaves one, and entering free agency used to
 * close the market on the spot and land on the summary stage before the draft class was signed: every drafted rookie
 * and every undrafted player of the year simply never existed.
 */
const sim = new MockSimulationService();

function league(humans: number): LeagueState {
  const s = createLeague(9301, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[1]!.teamCode = "BUF";
  for (let i = 0; i < s.gms.length; i++) s.gms[i]!.isHuman = i < humans;
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  clearReadinessOnline(s);
  return s;
}

/** What `vacateSeat` does to the league state (the database half is not under test here). */
function vacate(s: LeagueState, team: string): void {
  const gm = s.gms.find((g) => g.teamCode === team && g.isHuman);
  if (!gm) return;
  gm.isHuman = false;
  gm.name = "Open seat";
  delete s.readiness[gm.id];
  s.teams[team]!.controlledBy = { kind: "ai" };
  syncAiGms(s);
  runPendingCpuTurns(s);
  readyUpLocal(s);
}

const rookieIds = (s: LeagueState): string[] => Object.keys(s.players).filter((id) => id.startsWith("p_rookie_"));
const ready = (s: LeagueState): void => {
  for (const g of s.gms) s.readiness[g.id] = true;
};

/** Play to `stage`, the way the sweeper does (everyone ready). */
function playTo(s: LeagueState, stage: string): void {
  let guard = 0;
  while (s.stage !== stage) {
    if (guard++ > 200) throw new Error(`never reached ${stage}, stuck at ${s.stage}`);
    ready(s);
    if (s.stage === "playoffs") {
      if (s.bracket && !s.bracket.champion) s.bracket.champion = "KC";
      finishPlayedWeek(s);
    } else if (["regularSeason", "preseason"].includes(s.stage)) finishPlayedWeek(s);
    else advanceStage(s);
  }
}

/** One full offseason out of the draft summary: the class this season's draft produced must be fully accounted for. */
function checkClass(s: LeagueState, expectedTotal: number): void {
  const ids = rookieIds(s);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(expectedTotal);
  // every pick drafted is signed exactly once...
  const drafted = (s.draft?.results ?? []).filter((r) => r.selectedId);
  expect(drafted.length).toBe(224);
  for (const r of drafted) {
    expect(s.rookieOutcomes[r.selectedId!], r.selectedId!).toBe("signed");
    expect(s.players[`p_rookie_${r.selectedId}`], r.selectedId!).toBeDefined();
  }
  // ...and the rest of the class reached the market
  const taken = new Set(drafted.map((r) => r.selectedId));
  const undrafted = s.draftClass.filter((p) => !taken.has(p.id));
  expect(undrafted.length).toBe(96);
  for (const p of undrafted) expect(s.players[`p_rookie_${p.id}`], p.id).toBeDefined();
}

describe("a league with no human GM", () => {
  it("signs the whole draft class on the way into free agency (224 drafted, 96 undrafted, no duplicates)", () => {
    const s = league(0);
    playTo(s, "offseasonDraftSummary");
    expect(rookieIds(s)).toHaveLength(0);
    ready(s);
    advanceStage(s);
    checkClass(s, 320);
    // the market is over and the league is on its way, not stuck behind the rookies
    expect(["freeAgency", "freeAgencySummary"]).toContain(s.stage);
  }, 600_000);

  it("keeps doing it through two complete offseasons, and does not lose the class a second time", () => {
    const s = league(0);
    for (let year = 1; year <= 2; year++) {
      playTo(s, "offseasonDraftSummary");
      ready(s);
      advanceStage(s);
      checkClass(s, 320 * year);
      playTo(s, "preseason");
      expect(Object.values(s.teams).every((t) => t.cap.used <= t.cap.total + 0.05)).toBe(true);
    }
  }, 1_200_000);

  it("is the same league whether the last human left before the offseason or the league was never human", () => {
    const a = league(0);
    const b = league(2);
    playTo(b, "playoffs");
    for (const g of [...b.gms]) if (g.isHuman && g.teamCode) vacate(b, g.teamCode);
    playTo(a, "playoffs");
    // from here both leagues are all CPU; each must hand its whole class to the league
    for (const s of [a, b]) {
      playTo(s, "offseasonDraftSummary");
      ready(s);
      advanceStage(s);
      checkClass(s, 320);
    }
  }, 1_200_000);

  it("the last human leaving during free agency does not sign the class twice or skip a stage", () => {
    const s = league(2);
    playTo(s, "offseasonDraftSummary");
    ready(s);
    advanceStage(s);
    expect(s.stage).toBe("freeAgency");
    const before = rookieIds(s).length;
    expect(before).toBe(320);
    for (const g of [...s.gms]) if (g.isHuman && g.teamCode) vacate(s, g.teamCode);
    // the market closed on the CPU's behalf and the league carried on (the readiness gate has nobody left to wait for)
    expect(s.stage).not.toBe("freeAgency");
    checkClass(s, 320);
    playTo(s, "preseason");
    const ids = rookieIds(s);
    expect(ids).toHaveLength(320);
    expect(new Set(ids).size).toBe(320);
  }, 900_000);
});
