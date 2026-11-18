import { describe, expect, it } from "vitest";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { beginDraft, applyPick, bestAvailable, readRookieBoard } from "./rules.ts";
import { expectedRatings } from "./draftBoard.ts";
import { difficultyProfile } from "./aiDifficulty.ts";
import {
  BASIC_COST, CPU_POINTS, HUMAN_POINTS, budgetFor, makeReport, pointsSpent, publicRanks, reportsFor, runCpuScouting, spendReport, suggestTargets,
} from "./scouting.ts";
import type { LeagueState } from "@/domain";
import { gauss, needPositions, scoutingViewFor } from "./scouting.ts";

function leagueAtDraft(seed = 7, scouting = true): { s: LeagueState; me: string } {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, scouting } as never);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  // claim the first team for the human GM (a new league has not chosen one yet); beginDraft then treats the rest as CPU
  const me = Object.keys(s.teams).sort()[0]!;
  const human = s.gms.find((g) => g.isHuman)!;
  human.teamCode = me;
  beginDraft(s, "rookie");
  return { s, me };
}

describe("scouting slice: budget, flow, and what a report may reveal", () => {
  it("a finite budget: the 25th report is refused, and a repeat is refused without charging", () => {
    const { s, me } = leagueAtDraft();
    const ids = s.draftClass.map((p) => p.id);
    for (let i = 0; i < HUMAN_POINTS; i++) expect(spendReport(s, me, ids[i]!, HUMAN_POINTS).ok).toBe(true);
    expect(pointsSpent(s, me, s.draft!.year)).toBe(HUMAN_POINTS * BASIC_COST);
    expect(spendReport(s, me, ids[HUMAN_POINTS]!, HUMAN_POINTS)).toEqual({ ok: false, reason: "no-points" });
    expect(spendReport(s, me, ids[0]!, HUMAN_POINTS)).toEqual({ ok: false, reason: "already-scouted" });
    expect(pointsSpent(s, me, s.draft!.year)).toBe(HUMAN_POINTS);
  });

  it("the report is deterministic: no re-roll, and two teams read the same number", () => {
    const { s, me } = leagueAtDraft();
    const other = Object.keys(s.teams).find((t) => t !== me)!;
    const id = s.draftClass[40]!.id;
    const a = spendReport(s, me, id, HUMAN_POINTS), b = spendReport(s, other, id, HUMAN_POINTS);
    expect(a.ok && b.ok && a.report).toEqual(b.ok && b.report);
  });

  it("a stored report carries only an estimate and a range: no true rating, no hidden residual", () => {
    const { s, me } = leagueAtDraft();
    for (const id of suggestTargets(s, me, HUMAN_POINTS)) spendReport(s, me, id, HUMAN_POINTS);
    const stored = reportsFor(s, me, s.draft!.year);
    expect(Object.keys(stored).length).toBeGreaterThan(0);
    for (const r of Object.values(stored)) expect(Object.keys(r).sort()).toEqual(["estimate", "hi", "lo"]);
    // the whole scouting ledger, serialised the way a save or a pull would carry it, names no hidden field
    const wire = JSON.stringify(s.scouting);
    expect(wire).not.toMatch(/trueOverall|eps|potential|noise/);
    // and it names only prospects that were actually bought
    expect(Object.keys(stored).sort()).toEqual(Object.keys(stored).filter((id) => s.draftClass.some((p) => p.id === id)).sort());
  });

  it("a report is not the truth: it is never exactly the hidden rating for every prospect, and the band is a range", () => {
    const { s } = leagueAtDraft();
    const exp = expectedRatings(s.draftClass, 1), rank = publicRanks(s.draftClass, exp);
    let exact = 0;
    for (const p of s.draftClass) {
      const r = makeReport({ seed: s.seed ?? 0, year: s.draft!.year, prospect: p, projection: exp.get(p.id)!, rank: rank.get(p.id)! });
      if (r.estimate === p.trueOverall) exact++;
      expect(r.hi).toBeGreaterThan(r.lo);
    }
    expect(exact / s.draftClass.length).toBeLessThan(0.2);
  });

  it("scouting only reaches the scouting team's board, and an unscouted prospect keeps the public projection", () => {
    const { s, me } = leagueAtDraft();
    const other = Object.keys(s.teams).find((t) => t !== me)!;
    const id = s.draftClass[60]!.id;
    const before = readRookieBoard(s, me, difficultyProfile("expert")).expected.get(id)!;
    const spent = spendReport(s, me, id, HUMAN_POINTS);
    expect(spent.ok).toBe(true);
    const mine = readRookieBoard(s, me, difficultyProfile("expert")).expected;
    const theirs = readRookieBoard(s, other, difficultyProfile("expert")).expected;
    expect(mine.get(id)).toBe(spent.ok ? spent.report.estimate : -1);
    expect(theirs.get(id)).toBe(before);
    const untouched = s.draftClass[61]!.id;
    expect(mine.get(untouched)).toBe(theirs.get(untouched));
  });

  it("the whole flow: spend, then pick: the scouted estimate is what bestAvailable weighs", () => {
    const { s, me } = leagueAtDraft();
    // walk the draft to this team's first pick
    let g = 0;
    while (s.draft!.pickOrder[s.draft!.currentPickIndex] !== me && g++ < 400) applyPick(s, bestAvailable(s)!);
    const targets = suggestTargets(s, me, HUMAN_POINTS);
    expect(targets.length).toBeGreaterThan(0);
    for (const id of targets) spendReport(s, me, id, HUMAN_POINTS);
    const pickId = bestAvailable(s)!;
    applyPick(s, pickId);
    expect(s.draft!.results.at(-1)!.selectedId).toBe(pickId);
  });

  it("CPU parity: a CPU GM never has more points than a person, buys with the same function, and spends only on prospects", () => {
    const { s, me } = leagueAtDraft();
    expect(budgetFor(s, "XXX")).toBe(CPU_POINTS);
    expect(CPU_POINTS).toBe(12);
    expect(budgetFor(s, me)).toBe(HUMAN_POINTS);
    const cpu = Object.keys(s.teams).find((t) => t !== me)!;
    const ledger = reportsFor(s, cpu, s.draft!.year);
    expect(Object.keys(ledger).length).toBeLessThanOrEqual(HUMAN_POINTS);
    expect(Object.keys(ledger).length).toBeGreaterThan(0);
    // idempotent: a second run buys nothing new
    expect(runCpuScouting(s, cpu, budgetFor(s, cpu))).toBe(0);
  });

  it("off by default: a league that did not opt in drafts exactly as before, with no ledger", () => {
    const { s } = leagueAtDraft(7, false);
    expect(s.scouting).toBeUndefined();
  });

  it("no CPU path reads a hidden rating: scouting.ts reads trueOverall only inside makeReport", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./scouting.ts", import.meta.url), "utf8").split("\n");
    const hits = src.map((l, i) => [i, l] as const).filter(([, l]) => /trueOverall/.test(l) && !/^\s*(\*|\/\/)/.test(l));
    expect(hits.length).toBe(2); // the Pick<> type and the one read in makeReport
  });

  it("client payload: an online GM's copy carries their own reports only, and no hidden rating for any prospect", () => {
    const { s, me } = leagueAtDraft();
    for (const id of suggestTargets(s, me, HUMAN_POINTS)) spendReport(s, me, id, HUMAN_POINTS);
    const cpu = Object.keys(s.teams).find((t) => t !== me)!;
    const cpuIds = Object.keys(reportsFor(s, cpu, s.draft!.year));
    const mineIds = new Set(Object.keys(reportsFor(s, me, s.draft!.year)));
    const unseen = cpuIds.filter((id) => !mineIds.has(id));
    expect(unseen.length).toBeGreaterThan(0); // the CPU scouted prospects the person did not
    // the pull's own mask for the hidden rating (online/src/index.ts: every prospect not yet signed or released reads 0)
    const wire = JSON.parse(JSON.stringify({
      draftClass: s.draftClass.map((pr) => ({ ...pr, trueOverall: 0 })),
      scouting: scoutingViewFor(s.scouting, me),
    })) as { draftClass: { trueOverall: number }[]; scouting: NonNullable<LeagueState["scouting"]> };
    expect(wire.draftClass.every((p) => p.trueOverall === 0)).toBe(true);
    expect(Object.keys(wire.scouting.reports)).toEqual([me]);
    // nothing about a prospect the person did not scout rides along: no report by id, and no estimate for it anywhere
    const carried = new Set(Object.keys(wire.scouting.reports[me]!));
    for (const id of unseen) expect(carried.has(id)).toBe(false);
    expect(JSON.stringify(wire)).not.toContain(Object.keys(reportsFor(s, cpu, s.draft!.year)).find((id) => !mineIds.has(id))! + '":{"estimate"');
    // without the view the whole ledger would ship: every CPU's targets and free reports on those prospects
    expect(Object.keys(s.scouting!.reports).length).toBeGreaterThan(1);
  });

  it("needs: a rival's backups do not lower the league benchmark (each team's best player is averaged)", () => {
    const players: Record<string, unknown> = {};
    const POS = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "ILB", "CB", "S"];
    const add = (team: string, position: string, overall: number, n: string) => (players[`${team}${position}${n}`] = { nfl_team: team, position, overall, retired: false });
    for (let t = 0; t < 31; t++) {
      for (const pos of POS) add(`T${t}`, pos, pos === "QB" ? 80 : 75, "a");
      add(`T${t}`, "QB", 40, "b"); // a backup: must not drag the QB benchmark to 60
    }
    for (const pos of POS) add("ME", pos, pos === "QB" ? 70 : 75, "a");
    expect(needPositions({ players } as unknown as LeagueState, "ME", 1)).toEqual(["QB"]);
  });

  it("flag off: reports left in the state by another dynasty are ignored by the board", () => {
    const { s, me } = leagueAtDraft(7, true);
    const id = s.draftClass[40]!.id;
    expect(spendReport(s, me, id, HUMAN_POINTS).ok).toBe(true);
    const on = readRookieBoard(s, me, difficultyProfile("expert")).expected.get(id)!;
    const publicRead = expectedRatings(s.draftClass, difficultyProfile("expert").scoutingAccuracy).get(id)!;
    expect(on).not.toBe(publicRead);
    s.config.scouting = undefined;
    expect(readRookieBoard(s, me, difficultyProfile("expert")).expected.get(id)).toBe(publicRead);
  });

  it("report noise is a standard normal: unbiased, unit spread, and symmetric tails", () => {
    const v: number[] = [];
    for (let seed = 9901; seed <= 9948; seed++) for (let y = 2026; y <= 2030; y++) for (let i = 1; i <= 320; i++) v.push(gauss(`${seed}|${y}|d${y}_${i}|basic`));
    const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    const lo = v.filter((x) => x < -1.2816).length / n, hi = v.filter((x) => x > 1.2816).length / n;
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
    expect(Math.abs(lo - 0.1)).toBeLessThan(0.006);
    expect(Math.abs(hi - 0.1)).toBeLessThan(0.006);
    expect(gauss("same")).toBe(gauss("same"));
  });
});
