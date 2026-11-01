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

  it("never cuts a player the lineup needs to make room, even when injured-reserve teammates outrank him (review finding)", () => {
    const s = season();
    // KC's two guards: one on injured reserve, one active and the only active guard besides the starters needed
    const guards = rosterOf(s, "KC").filter((p) => p.position === "OG").sort((a, b) => b.overall - a.overall);
    expect(guards.length).toBeGreaterThanOrEqual(2);
    // leave exactly the minimum of active guards, with the rest of the position on IR and better rated
    const need = 2;
    guards.slice(need).forEach((p) => { p.injury_status = { status: "out", weeks_out_est: [10, 12] } as never; });
    guards.slice(0, need).forEach((p, i) => { p.overall = 40 + i; }); // the active ones rate below the IR players
    const cut = repair.repairCutCandidate(s, "KC", "K");
    expect(cut).not.toBeNull();
    expect(cut!.position).not.toBe("OG");
    // and no position is left below its minimum by the choice
    if (cut) {
      const left = rosterOf(s, "KC").filter((p) => p.id !== cut.id);
      expect(rosterMinimumViolations({ ...s, players: Object.fromEntries(left.map((p) => [p.id, p])) } as LeagueState, "KC")).toEqual(rosterMinimumViolations(s, "KC"));
    }
  });

  it("never cuts a player signed in the free-agency that just ended: that release lock holds (review finding)", () => {
    const s = season();
    const target = repair.repairCutCandidate(s, "KC", "K")!;
    expect(target).not.toBeNull();
    // the player the staff would cut was just signed in the event: he is locked, so someone else goes
    s.freeAgencyEvent = { signed: [{ playerId: target.id, teamCode: "KC", salary: 1, years: 1, round: 1 }] } as never;
    const next = repair.repairCutCandidate(s, "KC", "K");
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe(target.id);
  });

  it("does not cut a player whose release costs more cap than it frees (review finding)", () => {
    const s = season();
    strip(s, "KC", "K");
    // a full roster, room of 1, and every surplus player carries a big accelerated bonus: no cut helps
    const extra = Object.values(s.players).filter((p) => p.free_agent && p.position === "WR" && !p.retired);
    let i = 0;
    while (rosterOf(s, "KC").length < ROSTER_SIZE && i < extra.length) {
      const p = extra[i++]!;
      p.free_agent = false;
      p.nfl_team = "KC";
      p.contract = { team_id: "KC", years_remaining: 1, total_value: 1, guaranteed: 0, cap_hit_by_year: [1], signing_bonus: 0 };
    }
    for (const p of rosterOf(s, "KC")) {
      p.contract = { team_id: "KC", years_remaining: 3, total_value: 30, guaranteed: 0, cap_hit_by_year: [1, 10, 10], signing_bonus: 0, prorated_per_year: 6 } as never; // releasing costs far more than the hit
    }
    const used = rosterOf(s, "KC").reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    s.teams["KC"]!.cap.total = used + s.teams["KC"]!.cap.dead! + 2; // room of two
    const before = rosterOf(s, "KC").length;
    const rec = repairRoster(s, "KC")!;
    expect(rec.released).toEqual([]);
    expect(rec.signed).toEqual([]);
    expect(rosterOf(s, "KC").length).toBe(before); // nothing was cut for nothing
    expect(rec.unresolved).toEqual([{ position: "K", have: 0, need: 1 }]);
  });

  it("on a full roster tries cheaper replacements when the best one does not fit after the cut (review finding)", () => {
    const s = season();
    strip(s, "KC", "OT", 1);
    const extra = Object.values(s.players).filter((p) => p.free_agent && p.position === "WR" && !p.retired);
    let i = 0;
    while (rosterOf(s, "KC").length < ROSTER_SIZE && i < extra.length) {
      const p = extra[i++]!;
      p.free_agent = false;
      p.nfl_team = "KC";
      p.contract = { team_id: "KC", years_remaining: 1, total_value: 1, guaranteed: 0, cap_hit_by_year: [1], signing_bonus: 0 };
    }
    const market = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.nfl_team === "FA" && p.position === "OT");
    const prices = market.map((p) => emergencyPrice(s, p)).sort((a, b) => a - b);
    expect(prices[prices.length - 1]!).toBeGreaterThan(prices[0]!);
    // every surplus player's release eats 1M net (hit 1, penalty 2): room just covers the cheapest player only after the cut
    for (const p of rosterOf(s, "KC")) {
      p.contract = { team_id: "KC", years_remaining: 3, total_value: 3, guaranteed: 0, cap_hit_by_year: [1, 1, 1], signing_bonus: 0, prorated_per_year: 1 } as never;
    }
    const used = rosterOf(s, "KC").reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    // releasing any of them frees -2 (hit 1, penalty 3), so room must cover the price PLUS 2 before the cut
    s.teams["KC"]!.cap.total = used + (s.teams["KC"]!.cap.dead ?? 0) + prices[0]! + 2 + 0.01;
    const affordableBefore = market.filter((p) => emergencyPrice(s, p) <= prices[0]! + 2 + 0.01).sort((a, b) => b.overall - a.overall);
    expect(emergencyPrice(s, affordableBefore[0]!)).toBeGreaterThan(prices[0]! + 0.01); // the best player cannot fit after the cut
    const rec = repairRoster(s, "KC")!;
    expect(rec.released).toHaveLength(1);
    expect(rec.signed).toHaveLength(1);
    expect(rec.signed[0]!.salary).toBeLessThanOrEqual(prices[0]! + 0.01 + 1e-9);
    const after = Object.values(s.players).filter((p) => p.nfl_team === "KC" && !p.retired).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    expect(after + (s.teams["KC"]!.cap.dead ?? 0)).toBeLessThanOrEqual(s.teams["KC"]!.cap.total + 1e-6);
  });

  it("on a full roster counts the room a cut frees before ruling a replacement out (review finding)", () => {
    const s = season();
    strip(s, "KC", "K");
    const extra = Object.values(s.players).filter((p) => p.free_agent && p.position === "WR" && !p.retired);
    let i = 0;
    while (rosterOf(s, "KC").length < ROSTER_SIZE && i < extra.length) {
      const p = extra[i++]!;
      p.free_agent = false;
      p.nfl_team = "KC";
      p.contract = { team_id: "KC", years_remaining: 1, total_value: 4, guaranteed: 0, cap_hit_by_year: [4], signing_bonus: 0 };
    }
    for (const p of rosterOf(s, "KC")) p.contract = { team_id: "KC", years_remaining: 1, total_value: 4, guaranteed: 0, cap_hit_by_year: [4], signing_bonus: 0 };
    const used = rosterOf(s, "KC").reduce((n, p) => n + p.contract!.cap_hit_by_year[0]!, 0);
    s.teams["KC"]!.cap.dead = 0;
    s.teams["KC"]!.cap.total = used + 0.5; // half a million of room: the cheapest kicker costs more, a $4M cut frees 3.1
    const cheapest = Math.min(...Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.nfl_team === "FA" && p.position === "K").map((p) => emergencyPrice(s, p)));
    expect(cheapest).toBeGreaterThan(0.5);
    const rec = repairRoster(s, "KC")!;
    expect(rec.released).toHaveLength(1);
    expect(rec.signed).toHaveLength(1);
    expect(rec.unresolved).toEqual([]);
  });

  it("never signs back a player this franchise released, let expire, or cut in an earlier repair (PR #77 interplay)", () => {
    const s = season();
    strip(s, "KC", "K");
    const ks = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.nfl_team === "FA" && p.position === "K").sort((a, b) => b.overall - a.overall);
    expect(ks.length).toBeGreaterThan(3);
    // the best three kickers: one KC released (recorded by the league server), one KC let expire, one an earlier repair cut
    (s as unknown as { recentReleases: unknown }).recentReleases = { season: s.season, byTeam: { KC: [ks[0]!.id] } };
    ks[1]!.expired_from = "KC";
    ks[1]!.expired_season = s.season;
    s.rosterRepairs = [{ id: "x", season: s.season, stage: "regularSeason", team: "KC", human: true, signed: [], released: [{ playerId: ks[2]!.id, name: "x", position: "K", overall: 1 }], unresolved: [] }];
    const rec = repairRoster(s, "KC")!;
    expect([ks[0]!.id, ks[1]!.id, ks[2]!.id]).not.toContain(rec.signed[0]!.playerId);
    expect(rec.signed[0]!.playerId).toBe(ks[3]!.id);
    // another club may still sign any of them
    const s2 = season();
    strip(s2, "GB", "K");
    (s2 as unknown as { recentReleases: unknown }).recentReleases = { season: s2.season, byTeam: { KC: [ks[0]!.id] } };
    expect(repairRoster(s2, "GB")!.signed[0]!.playerId).toBe(ks[0]!.id);
    // and last season's release does not bar him
    const s3 = season();
    strip(s3, "KC", "K");
    (s3 as unknown as { recentReleases: unknown }).recentReleases = { season: s3.season - 1, byTeam: { KC: [ks[0]!.id] } };
    expect(repairRoster(s3, "KC")!.signed[0]!.playerId).toBe(ks[0]!.id);
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
      ["describeRepair", "emergencyPrice", "ownDepartures", "repairAllRosters", "repairBlockedBy", "repairCutCandidate", "repairRoster", "repairsFor", "rosterMinimumViolations", "runRepairCheckpoint"].sort(),
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

  it("never runs during a scheduled free-agency window or an unfinished event", () => {
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

    // once it is over, its unmatched offers are stale: a player who still carries one is an ordinary free agent (review finding)
    const best = Object.values(s.players).filter((p) => p.free_agent && p.position === "K").sort((a, b) => b.overall - a.overall)[0]!;
    s.freeAgencyEvent!.complete = true;
    s.freeAgencyEvent!.offers[best.id] = [{ teamCode: "GB", salary: 1, years: 1, round: 1, sequence: 0 }];
    const rec = repairRoster(s, "KC")!;
    expect(rec.signed[0]!.playerId).toBe(best.id);
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
