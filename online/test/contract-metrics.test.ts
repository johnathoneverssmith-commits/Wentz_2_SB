import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";

import type { LeagueState, Player } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

/**
 * The contract metrics behind B2b: whole-league seasons through the server's own stage machine, the CPU teams' new
 * contracts read off the rosters at each preseason and set against the previous one.
 *
 *   B2B_METRICS=1 B2B_OUT=out.json npx vitest run --root online test/contract-metrics.test.ts
 *
 * Off unless B2B_METRICS is set (a league-year run takes minutes), so it reports as skipped in CI. Run it on two
 * checkouts, same seeds, and compare the files.
 */
const ON = !!process.env.B2B_METRICS;
const SEEDS = (process.env.B2B_SEEDS ?? "9101,9102,9103").split(",").map(Number);
const SEASONS = Number(process.env.B2B_SEASONS ?? 8);
const sim = new MockSimulationService();

function league(seed: number): LeagueState {
  const state = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(state);
  state.gms[0]!.teamCode = "KC";
  state.gms[0]!.isHuman = true;
  state.gms[1]!.teamCode = "BUF";
  state.gms[1]!.isHuman = true;
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

interface Held {
  team: string;
  years: number;
  free: boolean;
}
const mean = (a: number[]): number => (a.length ? Math.round((100 * a.reduce((x, y) => x + y, 0)) / a.length) / 100 : 0);
const pct = (n: number, d: number): number => (d ? Math.round((1000 * n) / d) / 10 : 0);
const bucket = (age: number): string => (age <= 25 ? "<=25" : age <= 28 ? "26-28" : age <= 30 ? "29-30" : age <= 33 ? "31-33" : "34+");

function held(s: LeagueState): Map<string, Held> {
  const m = new Map<string, Held>();
  for (const p of Object.values(s.players)) {
    if (p.retired) continue;
    m.set(p.id, { team: p.nfl_team, years: p.contract?.years_remaining ?? 0, free: p.free_agent });
  }
  return m;
}

function snapshot(s: LeagueState, prev: Map<string, Held> | null) {
  const human = new Set(s.gms.filter((x) => x.isHuman).map((x) => x.teamCode));
  const cpu = Object.keys(s.teams).filter((c) => !human.has(c));
  const cap = Object.values(s.teams)[0]!.cap.total;
  let dollars = 0;
  let beyond = 0;
  let old3 = 0;
  let over = 0;
  let dead = 0;
  let maxDead = 0;
  let deadOver10 = 0;
  const y2: number[] = [];
  const y3: number[] = [];
  const fa: Player[] = [];
  const re: Player[] = [];
  const lenByAge: Record<string, number[]> = {};
  const lenByPos: Record<string, number[]> = {};
  for (const code of cpu) {
    const t = s.teams[code]!;
    dead += t.cap.dead;
    maxDead = Math.max(maxDead, t.cap.dead);
    if (t.cap.dead > 10) deadOver10++;
    if (t.cap.used > t.cap.total + 0.05) over++;
    let a = 0;
    let b = 0;
    for (const p of Object.values(s.players)) {
      if (p.retired || p.free_agent || p.nfl_team !== code || !p.contract) continue;
      const c = p.contract;
      const dec = p.decline_age_threshold ?? 30;
      c.cap_hit_by_year.forEach((h, i) => {
        dollars += h;
        if (p.age + i > dec) beyond += h;
      });
      if (p.age >= 31 && c.years_remaining >= 3) old3++;
      a += c.cap_hit_by_year[1] ?? 0;
      b += c.cap_hit_by_year[2] ?? 0;
      const was = prev?.get(p.id);
      if (!was || p.id.startsWith("p_depth_")) continue;
      const fresh = c.years_remaining >= was.years || was.team !== code || was.free;
      if (!fresh) continue;
      if (was.free || was.team !== code) fa.push(p);
      else re.push(p);
      (lenByAge[bucket(p.age)] ??= []).push(c.years_remaining);
      (lenByPos[p.position] ??= []).push(c.years_remaining);
    }
    y2.push(a / (t.cap.total * (1 + 0.075)));
    y3.push(b / (t.cap.total * (1 + 0.075) ** 2));
  }
  const strength = cpu.map((c) => s.teams[c]!.ratings.overall).sort((x, y) => y - x);
  const eight = (xs: number[]): number[] => xs.slice(0, 8);
  const long = (ps: Player[]) => ps.filter((p) => p.contract!.years_remaining >= 3);
  const q = (ps: Player[]) => ({ n: ps.length, meanOverall: mean(ps.map((p) => p.overall)), meanYears: mean(ps.map((p) => p.contract!.years_remaining)), meanAge: mean(ps.map((p) => p.age)) });
  return {
    season: s.season,
    capM: cap,
    pctDollarsBeyondDeclineAge: pct(beyond, dollars),
    age31PlusWith3PlusYears: old3,
    nextYearCommitPctProjCap: mean(y2.map((x) => 100 * x)),
    year3CommitPctProjCap: mean(y3.map((x) => 100 * x)),
    teamsOverCap: over,
    avgDeadM: mean([dead / cpu.length]),
    maxTeamDeadM: mean([maxDead]),
    teamsDeadOver10M: deadOver10,
    faSignings: q(fa),
    faAge31PlusLong: long(fa).filter((p) => p.age >= 31).length,
    faPastDeclineLong: long(fa).filter((p) => p.age >= (p.decline_age_threshold ?? 30)).length,
    resigns: q(re),
    resignAge31PlusLong: long(re).filter((p) => p.age >= 31).length,
    lengthByAge: Object.fromEntries(Object.entries(lenByAge).map(([k, v]) => [k, mean(v)])),
    lengthByPos: Object.fromEntries(Object.entries(lenByPos).map(([k, v]) => [k, mean(v)])),
    topEightTeamOverall: mean(eight(strength)),
    bottomEightTeamOverall: mean(eight([...strength].reverse())),
    leagueTeamOverall: mean(strength),
  };
}

describe.skipIf(!ON)("contract metrics (B2B_METRICS=1)", () => {
  it("measures the CPU teams' contracts across seasons", () => {
    const out: unknown[] = [];
    for (const seed of SEEDS) {
      const s = league(seed);
      let prev = held(s);
      out.push({ seed, ...snapshot(s, null) });
      for (let y = 0; y < SEASONS; y++) {
        rollOver(s);
        out.push({ seed, ...snapshot(s, prev) });
        prev = held(s);
      }
    }
    writeFileSync(process.env.B2B_OUT ?? "contract-metrics.json", JSON.stringify(out, null, 1));
  }, 7_200_000);
});
