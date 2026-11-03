import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { reconciliationIssues } from "@/state/reconciliation.ts";
import { rosterCountOf, rosterLimitFor } from "@/state/rules.ts";
import { runRepairCheckpoint } from "@/state/rosterRepair.ts";
import type { LeagueState } from "@/domain";

import { decideRelease, decideStaffFix } from "../src/decide.js";
import { applyRosterRepair, authorizeRosterRepair } from "../src/rosterRepair.js";

/**
 * Every way the staff can repair a roster — the human's staff-fix button, the repair on leaving a free-agency summary
 * (commissioner force, absent GM, autopilot), and the checkpoint repair before a block of games — must apply the same
 * own-departure exclusion and the same authorization. Found by the PR #77 + #73 integration audit: the first two used a
 * narrower rule and re-signed a star the club had let expire, or an earlier repair had cut, on the $1M minimum.
 * No database needed.
 */
type Departure = "released" | "expired" | "repairCut";
type Path = "staff-fix button" | "leaving the summary" | "checkpoint repair";

const league = (stage: string) => {
  const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
  fillRosterGaps(s);
  const gm = s.gms[0]!;
  gm.isHuman = true;
  gm.teamCode = "GB";
  s.stage = stage as LeagueState["stage"];
  return { s, a: { userId: "u", leagueId: "l", teamCode: "GB", gmId: gm.id } };
};
const mine = (s: LeagueState, pos: string) =>
  Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === pos && !x.retired);
/** the cap measure the rules enforce at a summary: the roster's contract hits this year */
const hits = (s: LeagueState, team: string) =>
  Math.round(Object.values(s.players).filter((p) => p.nfl_team === team && !p.retired && !p.free_agent).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0) * 10) / 10;
const reload = (s: LeagueState): LeagueState => JSON.parse(JSON.stringify(s)) as LeagueState;

/** GB's best QB leaves in the given way; then the rest of the QB room empties by itself (retirement / expiry / trade). */
function starLeftBy(how: Departure) {
  const { s, a } = league("freeAgencySummary");
  const star = mine(s, "QB").sort((x, y) => y.overall - x.overall)[0]!;
  star.overall = 99; // unmistakably the best QB on the street
  if (how === "released") decideRelease(s, a, star.id); // surplus depth: a legitimate release
  else {
    star.nfl_team = "FA";
    star.free_agent = true;
    star.contract = null;
    if (how === "expired") {
      star.expired_from = "GB";
      star.expired_season = s.season; // stamped with the season that ended, before the year turns
    } else {
      (s.rosterRepairs ??= []).push({
        id: `${s.season}|preseason|GB`, season: s.season, stage: "preseason", team: "GB", human: true,
        signed: [], released: [{ playerId: star.id, name: star.name, position: "QB", overall: 99 }], unresolved: [],
      });
    }
  }
  for (const q of mine(s, "QB")) {
    q.nfl_team = "FA";
    q.free_agent = true;
    q.contract = null;
  }
  return { s, a, star };
}

function repair(path: Path, s: LeagueState, a: ReturnType<typeof league>["a"]): void {
  if (path === "staff-fix button") decideStaffFix(s, a);
  else if (path === "leaving the summary") applyRosterRepair(s, authorizeRosterRepair(s, "GB", "freeAgencySummary"));
  else {
    s.stage = "preseason";
    runRepairCheckpoint(s);
  }
}

describe("the same own-departure exclusion on every repair path", () => {
  for (const how of ["released", "expired", "repairCut"] as const) {
    for (const path of ["staff-fix button", "leaving the summary", "checkpoint repair"] as const) {
      it(`${path}: a star the club ${how} is not signed back, and the hole is still filled`, () => {
        const { s, a, star } = starLeftBy(how);
        repair(path, s, a);
        expect(star.nfl_team, "the departed star stays on the street").toBe("FA");
        expect(star.free_agent).toBe(true);
        const qbs = mine(s, "QB");
        expect(qbs.length, "the QB room is filled by someone else").toBeGreaterThan(0);
        expect(qbs.every((q) => q.id !== star.id)).toBe(true);
        expect(reconciliationIssues(s, "GB").filter((i) => i.kind === "position")).toEqual([]);
      });
    }
  }

  it("survives a save and reload between the departure and the repair", () => {
    for (const how of ["released", "expired", "repairCut"] as const) {
      const { s, a, star } = starLeftBy(how);
      const loaded = reload(s);
      decideStaffFix(loaded, a);
      expect(loaded.players[star.id]!.nfl_team, how).toBe("FA");
    }
  });

  it("survives the season rollover (the exclusion spans the year turning)", () => {
    for (const how of ["released", "expired"] as const) {
      const { s, a, star } = starLeftBy(how);
      s.season += 1; // contracts expire and the year turns between the departure and the next repair
      decideStaffFix(s, a);
      expect(s.players[star.id]!.nfl_team, how).toBe("FA");
    }
  });

  it("an old saved league without the field repairs normally", () => {
    const { s, a } = league("freeAgencySummary");
    delete (s as { recentReleases?: unknown }).recentReleases;
    for (const p of mine(s, "OG")) {
      p.nfl_team = "FA";
      p.free_agent = true;
      p.contract = null;
    }
    decideStaffFix(reload(s), a);
    const t = reload(s);
    decideStaffFix(t, a);
    expect(reconciliationIssues(t, "GB")).toEqual([]);
  });
});

describe("repair stays idempotent, legal and deadlock-free", () => {
  it("human and CPU holes are filled once; repeat and cross-path calls change nothing", () => {
    const { s, a } = league("freeAgencySummary");
    for (const team of ["GB", "KC"]) {
      for (const p of Object.values(s.players)) {
        if (p.nfl_team === team && p.position === "OG") {
          p.nfl_team = "FA";
          p.free_agent = true;
          p.contract = null;
        }
      }
    }
    const owners = () => JSON.stringify(Object.values(s.players).filter((p) => !p.free_agent).map((p) => [p.id, p.nfl_team]).sort());
    decideStaffFix(s, a);
    applyRosterRepair(s, authorizeRosterRepair(s, "KC", "freeAgencySummary"));
    const after = owners();
    expect(decideStaffFix(s, a)).toEqual({ events: [], unchanged: true });
    expect(decideStaffFix(s, a)).toEqual({ events: [], unchanged: true });
    applyRosterRepair(s, authorizeRosterRepair(s, "GB", "freeAgencySummary"));
    s.stage = "preseason";
    expect(runRepairCheckpoint(s).filter((r) => r.team === "GB" || r.team === "KC")).toEqual([]);
    expect(owners()).toBe(after);
    for (const t of ["GB", "KC"]) {
      expect(reconciliationIssues(s, t).filter((i) => i.kind === "position")).toEqual([]);
      expect(rosterCountOf(s, t)).toBeLessThanOrEqual(rosterLimitFor("freeAgencySummary"));
      expect(hits(s, t)).toBeLessThanOrEqual(s.teams[t]!.cap.total + 1e-6);
    }
  });

  it("a legitimate shortage (hole that opens by itself, nothing departed) is still repaired from the street", () => {
    const { s, a } = league("midseasonFreeAgencySummary");
    for (const p of mine(s, "OG")) {
      p.nfl_team = "FA";
      p.free_agent = true;
      p.contract = null;
    }
    const out = decideStaffFix(s, a);
    expect(out.unchanged).toBeUndefined();
    expect(reconciliationIssues(s, "GB")).toEqual([]);
    for (const p of mine(s, "OG")) expect(p.contract!.years_remaining).toBe(1);
  });

  it("a trade-created hole is filled only from the street, never with the players just traded away", () => {
    const { s, a } = league("freeAgencySummary");
    const ogs = mine(s, "OG");
    for (const p of ogs) p.nfl_team = "KC";
    const before = new Set(Object.keys(s.players).filter((id) => s.players[id]!.nfl_team === "GB"));
    decideStaffFix(s, a);
    const signed = Object.values(s.players).filter((p) => p.nfl_team === "GB" && !before.has(p.id));
    expect(signed.length).toBeGreaterThan(0);
    expect(signed.every((p) => p.position === "OG" && p.contract!.years_remaining === 1)).toBe(true);
    expect(signed.some((p) => ogs.some((o) => o.id === p.id))).toBe(false);
  });

  it("no readiness soft-lock: an unfillable position, and an over-the-cap roster, both reach a legal roster", () => {
    const k = league("freeAgencySummary");
    for (const p of Object.values(k.s.players)) {
      if (p.position !== "K") continue;
      if (p.nfl_team === "GB") { p.nfl_team = "FA"; p.free_agent = true; p.contract = null; }
      else if (p.free_agent) p.retired = true; // nobody left to sign
    }
    decideStaffFix(k.s, k.a);
    expect(reconciliationIssues(k.s, "GB")).toEqual([]);

    const c = league("freeAgencySummary");
    c.s.teams.GB!.cap.total = hits(c.s, "GB") - 8; // over the cap, every position at or near its minimum
    decideStaffFix(c.s, c.a);
    expect(reconciliationIssues(c.s, "GB")).toEqual([]);
    expect(hits(c.s, "GB")).toBeLessThanOrEqual(c.s.teams.GB!.cap.total + 1e-6);
  });

  it("releasing below the positional minimum is refused at every stage (no hole-digging)", () => {
    for (const stage of ["freeAgency", "freeAgencySummary", "trainingCamp", "midseasonFreeAgencySummary", "offseasonDraft"]) {
      const { s, a } = league(stage);
      for (const q of mine(s, "QB")) {
        try { decideRelease(s, a, q.id); } catch { /* refused or locked */ }
      }
      expect(reconciliationIssues(s, "GB").filter((i) => i.kind === "position"), stage).toEqual([]);
    }
  });
});
