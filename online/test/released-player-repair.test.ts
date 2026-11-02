import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, expireContracts, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { reconciliationIssues, rosterOf } from "@/state/reconciliation.ts";
import { upgradeLeagueState } from "@/state/saveMigration.ts";
import { rosterMinimumViolations, repairRoster, runRepairCheckpoint } from "@/state/rosterRepair.ts";

import { decideRelease, decideStaffFix, type Actor } from "../src/decide.js";
import { onStageEntered } from "../src/phases.js";
import { takeNotes } from "../src/notes.js";

/**
 * A GM deliberately releases a surplus star; the rest of that position then leaves through contract expiration (a
 * natural hole). Neither the checkpoint repair nor the human-requested staff-fix may hand the star a discounted
 * contract back; other free agents fill the hole; the franchise can still advance.
 */
const actor = (s: LeagueState): Actor => ({ userId: "u", leagueId: "l", teamCode: "GB", gmId: s.gms[0]!.id });
function league(): LeagueState {
  const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
  fillRosterGaps(s);
  const gm = s.gms[0]!;
  gm.isHuman = true;
  gm.teamCode = "GB";
  recomputeTeamRatings(s);
  return s;
}
const qbs = (s: LeagueState) => rosterOf(s, "GB").filter((p) => p.position === "QB");

/** The scenario up to the moment the hole exists: release the star, expire the rest, the year turns. */
function setUp(): { s: LeagueState; star: string } {
  const s = league();
  s.stage = "freeAgencySummary"; // a stage where a GM may release
  const all = qbs(s).sort((a, b) => b.overall - a.overall);
  expect(all.length).toBeGreaterThan(1);
  const star = all[0]!;
  star.overall = 95; // a star, so he would top any market
  decideRelease(s, actor(s), star.id); // the real action: surplus, so allowed, and recorded
  // everyone else at the position runs out of contract at the season's end (the real expiry)
  for (const p of qbs(s)) p.contract!.years_remaining = 1;
  expireContracts(s);
  s.season += 1; // the rollover increments the year after expiry has stamped the old one
  expect(qbs(s)).toHaveLength(0);
  return { s, star: star.id };
}

describe("a released star is never re-signed by the staff", () => {
  it("not by the checkpoint repair, across the season rollover; others fill the hole; the franchise advances", () => {
    const { s, star } = setUp();
    s.stage = "regularSeason"; // the checkpoint the repair runs at
    takeNotes(s);
    onStageEntered(s, "leagueDevelopments");
    const now = qbs(s);
    expect(now).toHaveLength(1);
    expect(now[0]!.id).not.toBe(star);
    expect(s.players[star]!.free_agent).toBe(true);
    expect(rosterMinimumViolations(s, "GB")).toEqual([]);
    expect(reconciliationIssues(s, "GB")).toEqual([]); // nothing left to block a check-in
  });

  it("not by the preseason roster fill, either", () => {
    const { s, star } = setUp();
    s.stage = "preseason";
    onStageEntered(s, "offseasonDepthChart");
    expect(qbs(s).map((p) => p.id)).not.toContain(star);
    expect(rosterMinimumViolations(s, "GB")).toEqual([]);
  });

  it("not by the human-requested staff-fix at a summary, which stays functional", () => {
    const { s, star } = setUp();
    s.stage = "freeAgencySummary";
    expect(rosterMinimumViolations(s, "GB").some((v) => v.position === "QB")).toBe(true);
    const out = decideStaffFix(s, actor(s));
    expect(out.unchanged).not.toBe(true);
    expect(qbs(s)).toHaveLength(1);
    expect(qbs(s)[0]!.id).not.toBe(star);
    expect(reconciliationIssues(s, "GB")).toEqual([]);
  });

  it("is idempotent: repeating every repair path changes nothing", () => {
    const { s } = setUp();
    s.stage = "regularSeason";
    onStageEntered(s, "leagueDevelopments");
    const snap = () => JSON.stringify(rosterOf(s, "GB").map((p) => [p.id, p.contract?.cap_hit_by_year]).sort());
    const before = snap();
    runRepairCheckpoint(s, "regularSeason");
    onStageEntered(s, "leagueDevelopments");
    expect(repairRoster(s, "GB")).toBeNull();
    s.stage = "freeAgencySummary";
    decideStaffFix(s, actor(s));
    expect(snap()).toBe(before);
    const ids = rosterOf(s, "GB").map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate signings
  });

  it("survives a save and reload, and the season rollover", () => {
    const { s, star } = setUp();
    const reloaded = JSON.parse(JSON.stringify(s)) as LeagueState;
    upgradeLeagueState(reloaded);
    reloaded.stage = "regularSeason";
    onStageEntered(reloaded, "leagueDevelopments");
    expect(qbs(reloaded).map((p) => p.id)).not.toContain(star);
    expect(qbs(reloaded)).toHaveLength(1);
  });

  it("holds on a frozen snapshot (the single-player planner) and never mutates the shared history", () => {
    const s = league();
    s.stage = "freeAgencySummary";
    const star = qbs(s).sort((a, b) => b.overall - a.overall)[0]!;
    decideRelease(s, actor(s), star.id); // same season: the history exists and will be frozen
    const history = s.recentReleases!;
    Object.freeze(history);
    Object.freeze(history.byTeam);
    for (const l of Object.values(history.byTeam)) Object.freeze(l);
    const before = JSON.stringify(history);
    const spare = rosterOf(s, "GB").filter((p) => p.position === "WR").sort((a, b) => a.overall - b.overall)[0]!;
    // the trim planner's move: release on a shallow copy of the frozen league
    expect(() => decideRelease({ ...s } as LeagueState, actor(s), spare.id)).not.toThrow();
    expect(JSON.stringify(history)).toBe(before);
  });

  it("does not disturb other teams: a CPU club may still sign the released star", () => {
    const { s, star } = setUp();
    s.stage = "regularSeason";
    for (const p of Object.values(s.players)) if (p.nfl_team === "KC" && p.position === "QB") { p.nfl_team = "FA"; p.free_agent = true; p.contract = null as never; }
    onStageEntered(s, "leagueDevelopments");
    // KC (a CPU team) was short at QB and the best free agent is the star: it may take him
    expect(rosterMinimumViolations(s, "KC")).toEqual([]);
    expect(s.players[star]!.nfl_team === "KC" || s.players[star]!.nfl_team === "FA").toBe(true);
  });
});
