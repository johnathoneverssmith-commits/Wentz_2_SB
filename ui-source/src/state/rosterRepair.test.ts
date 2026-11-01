import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { ROSTER_SIZE } from "@/sim/roster-template";
import { beginFreeAgencyEvent } from "./freeAgencyEvent.ts";
import { rosterOf } from "./reconciliation.ts";
import * as repair from "./rosterRepair.ts";
import { emergencyPrice, repairAllRosters, repairBlockedBy, repairRoster, repairsFor, rosterMinimumViolations, runRepairCheckpoint } from "./rosterRepair.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { minSalaryM } from "./capEconomy.ts";

const cfg = { ...DEFAULT_CONFIG, humanGmCount: 0, playerPool: "legacy" as const };

/** A league in the regular season, every team full, with plenty of unsigned kickers and linemen. */
function season(): LeagueState {
  const s = createLeague(41, cfg);
  fillRosterGaps(s);
  s.stage = "regularSeason";
  recomputeTeamRatings(s);
  return s;
}

/** Take every player at `position` off `team` so the team is short, returning how many went. */
function strip(s: LeagueState, team: string, position: string, keep = 0): number {
  const at = rosterOf(s, team).filter((p) => p.position === position).sort((a, b) => b.overall - a.overall);
  const drop = at.slice(keep);
  for (const p of drop) {
    p.free_agent = false;
    delete s.players[p.id];
  }
  return drop.length;
}

describe("rosterMinimumViolations", () => {
  it("is empty for a full roster and names the position and count for a short one", () => {
    const s = season();
    expect(rosterMinimumViolations(s, "KC")).toEqual([]);
    strip(s, "KC", "K");
    expect(rosterMinimumViolations(s, "KC")).toEqual([{ position: "K", have: 0, need: 1 }]);
  });
});

describe("repairRoster", () => {
  it("does nothing, and records nothing, for a legal roster", () => {
    const s = season();
    expect(repairRoster(s, "KC")).toBeNull();
    expect(s.rosterRepairs ?? []).toEqual([]);
  });

  it("signs the best affordable player at the short position on a one-year deal at the emergency price", () => {
    const s = season();
    strip(s, "KC", "K");
    const market = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.nfl_team === "FA" && p.position === "K");
    expect(market.length).toBeGreaterThan(2);
    const best = [...market].sort((a, b) => b.overall - a.overall)[0]!;
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed).toHaveLength(1);
    expect(rec.signed[0]!.playerId).toBe(best.id);
    const p = s.players[best.id]!;
    expect(p.nfl_team).toBe("KC");
    expect(p.free_agent).toBe(false);
    expect(p.contract!.years_remaining).toBe(1);
    expect(p.contract!.cap_hit_by_year).toEqual([emergencyPrice(s, { ...p, free_agent: true } as Player)]);
    expect(p.contract!.cap_hit_by_year[0]!).toBeGreaterThanOrEqual(minSalaryM(s));
    expect(rosterMinimumViolations(s, "KC")).toEqual([]);
    expect(rec.unresolved).toEqual([]);
    expect(repairsFor(s, "KC")[0]!.id).toBe(rec.id);
    expect(repair.describeRepair(rec)).toMatch(/Your staff signed .*K \d+/);
  });

  it("fills exactly the shortfall — a team short two guards gets two, not a roster", () => {
    const s = season();
    const before = rosterOf(s, "KC").length;
    const removed = strip(s, "KC", "OG", 0);
    expect(removed).toBeGreaterThanOrEqual(2);
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed.every((x) => x.position === "OG")).toBe(true);
    expect(rec.signed).toHaveLength(2);
    expect(rosterOf(s, "KC").length).toBe(before - removed + 2);
  });

  it("is idempotent: a second pass on the repaired roster signs no one", () => {
    const s = season();
    strip(s, "KC", "K");
    repairRoster(s, "KC");
    const n = Object.values(s.players).filter((p) => p.nfl_team === "KC").length;
    expect(repairRoster(s, "KC")).toBeNull();
    expect(Object.values(s.players).filter((p) => p.nfl_team === "KC").length).toBe(n);
  });

  it("prices a better player higher, so cutting a kicker to buy the best one is no bargain", () => {
    const s = season();
    const ks = Object.values(s.players).filter((p) => p.free_agent && p.position === "K").sort((a, b) => b.overall - a.overall);
    expect(emergencyPrice(s, ks[0]!)).toBeGreaterThanOrEqual(emergencyPrice(s, ks[ks.length - 1]!));
    const q = Object.values(s.players).filter((p) => p.position === "QB" && p.overall >= 85)[0]!;
    expect(emergencyPrice(s, q)).toBeGreaterThan(minSalaryM(s) * 3);
  });

  it("skips what the team cannot afford and reports the hole instead of overspending", () => {
    const s = season();
    strip(s, "KC", "QB");
    s.teams["KC"]!.cap.total = 0; // no room at all
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed).toEqual([]);
    expect(rec.unresolved).toEqual([{ position: "QB", have: 0, need: 1 }]);
    expect(rosterMinimumViolations(s, "KC")).toHaveLength(1);
  });

  it("counts practice-squad salaries and dead money in the room (review finding)", () => {
    const s = season();
    strip(s, "KC", "K");
    const active = rosterOf(s, "KC").reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    const ps = Object.values(s.players).find((p) => p.free_agent && !p.retired && p.position === "WR")!;
    ps.free_agent = false;
    ps.nfl_team = "PS:KC";
    ps.contract = { team_id: "KC", years_remaining: 1, total_value: 3.2, guaranteed: 0, cap_hit_by_year: [3.2], signing_bonus: 0 };
    s.teams["KC"]!.cap.dead = 0;
    s.teams["KC"]!.cap.total = active + 3.2 + 0.5; // active contracts alone leave room; with the squad there is half a million
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed).toEqual([]);
    expect(rec.unresolved).toEqual([{ position: "K", have: 0, need: 1 }]);
  });

  it("steps down to the best player it CAN afford", () => {
    const s = season();
    strip(s, "KC", "OT", 1); // a market with a spread of prices
    const market = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.nfl_team === "FA" && p.position === "OT");
    const prices = market.map((p) => emergencyPrice(s, p)).sort((a, b) => a - b);
    const cheapest = prices[0]!;
    const dearest = prices[prices.length - 1]!;
    expect(dearest).toBeGreaterThan(cheapest); // otherwise this proves nothing
    const used = rosterOf(s, "KC").reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    s.teams["KC"]!.cap.total = used + (s.teams["KC"]!.cap.dead ?? 0) + cheapest;
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed.length).toBeGreaterThanOrEqual(1);
    expect(rec.signed[0]!.salary).toBeLessThanOrEqual(cheapest + 1e-9);
    expect(rec.signed[0]!.salary).toBeLessThan(dearest);
    // and it never takes the team over the cap
    const after = rosterOf(s, "KC").reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    expect(after + (s.teams["KC"]!.cap.dead ?? 0)).toBeLessThanOrEqual(s.teams["KC"]!.cap.total + 1e-6 + (rec.unresolved.length ? 0 : 0));
  });

  it("respects the roster limit by releasing the cheapest surplus player, and says so", () => {
    const s = season();
    strip(s, "KC", "K");
    // fill the last open spots with surplus bodies at another position
    const extra = Object.values(s.players).filter((p) => p.free_agent && p.position === "WR" && !p.retired);
    let i = 0;
    while (rosterOf(s, "KC").length < ROSTER_SIZE && i < extra.length) {
      const p = extra[i++]!;
      p.free_agent = false;
      p.nfl_team = "KC";
      p.contract = { team_id: "KC", years_remaining: 1, total_value: 1, guaranteed: 0, cap_hit_by_year: [1], signing_bonus: 0 };
    }
    expect(rosterOf(s, "KC").length).toBe(ROSTER_SIZE);
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed).toHaveLength(1);
    expect(rec.released.length).toBeGreaterThanOrEqual(1);
    expect(rosterOf(s, "KC").length).toBeLessThanOrEqual(ROSTER_SIZE);
    expect(rosterMinimumViolations(s, "KC")).toEqual([]);
    expect(repair.describeRepair(rec)).toMatch(/released/);
  });

  it("is deterministic: the same league repairs the same way", () => {
    const run = () => {
      const s = season();
      strip(s, "KC", "OT");
      strip(s, "GB", "K");
      return repairAllRosters(s).map((r) => [r.team, r.signed.map((x) => `${x.playerId}:${x.salary}`)]);
    };
    expect(run()).toEqual(run());
  });
});

describe("a person cannot choose or exploit it", () => {
  it("has no entry point that takes a player id", () => {
    // the whole public surface that changes a roster: none of these takes a player
    expect(repairRoster.length).toBe(2);
    expect(repairAllRosters.length).toBe(1);
    expect(runRepairCheckpoint.length).toBe(1);
    const mutating = Object.entries(repair).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(mutating).toEqual(
      ["describeRepair", "emergencyPrice", "repairAllRosters", "repairBlockedBy", "repairRoster", "repairsFor", "rosterMinimumViolations", "runRepairCheckpoint"].sort(),
    );
  });

  it("treats a human team exactly as it treats a CPU team", () => {
    const pick = (human: boolean) => {
      const s = season();
      if (human) {
        const gm = s.gms[0]!;
        gm.isHuman = true;
        gm.teamCode = "KC";
        s.teams["KC"]!.controlledBy = { kind: "human", gmId: gm.id } as never;
      }
      strip(s, "KC", "K");
      return repairRoster(s, "KC")!.signed.map((x) => x.playerId);
    };
    expect(pick(true)).toEqual(pick(false));
    const s = season();
    s.gms[0]!.isHuman = true;
    s.gms[0]!.teamCode = "KC";
    strip(s, "KC", "K");
    expect(repairRoster(s, "KC")!.human).toBe(true);
  });

  it("never runs during a scheduled free-agency window, and never touches a player with a live offer", () => {
    const s = season();
    strip(s, "KC", "K");
    s.stage = "freeAgency";
    expect(repairBlockedBy(s)).not.toBeNull();
    expect(repairRoster(s, "KC")).toBeNull();
    expect(runRepairCheckpoint(s, "freeAgency")).toEqual([]);

    // an event still running blocks it in any stage
    s.stage = "regularSeason";
    beginFreeAgencyEvent(s);
    expect(s.freeAgencyEvent!.complete).toBe(false);
    expect(repairBlockedBy(s)).not.toBeNull();
    expect(repairAllRosters(s)).toEqual([]);
    expect(rosterMinimumViolations(s, "KC")).toHaveLength(1);

    // once it is over, a player who still carries an offer is left alone
    const best = Object.values(s.players).filter((p) => p.free_agent && p.position === "K").sort((a, b) => b.overall - a.overall)[0]!;
    s.freeAgencyEvent!.complete = true;
    s.freeAgencyEvent!.offers[best.id] = [{ teamCode: "GB", salary: 1, years: 1, round: 1, sequence: 0 }];
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed[0]!.playerId).not.toBe(best.id);
  });

  it("only acts at a checkpoint stage", () => {
    const s = season();
    strip(s, "KC", "K");
    expect(runRepairCheckpoint(s, "trainingCamp")).toEqual([]);
    expect(rosterMinimumViolations(s, "KC")).toHaveLength(1);
    const made = runRepairCheckpoint(s, "regularSeason");
    expect(made.map((r) => r.team)).toEqual(["KC"]);
    expect(s.stage).toBe("regularSeason"); // the caller's stage is restored
    // a retry at the same checkpoint cannot double up
    strip(s, "KC", "K");
    runRepairCheckpoint(s, "regularSeason");
    expect(repairsFor(s, "KC").length).toBe(1);
  });
});
