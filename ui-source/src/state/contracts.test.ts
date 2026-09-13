import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";

import { createLeague, DEFAULT_CONFIG, expireContracts } from "./seed.ts";

/**
 * Nothing decremented `years_remaining` anywhere in the app, so contracts were
 * permanent: the "2y" on the roster screen never changed, cap space never came
 * back, and the offseason market held nothing but the minimum-salary depth
 * whose deals happened to be written for one year. A team reached its second
 * offseason with $2.6M of room against a market asking $17M a year.
 */
function fixture(): LeagueState {
  return createLeague(3, DEFAULT_CONFIG);
}

function rostered(s: LeagueState): Player[] {
  return Object.values(s.players).filter((p) => !p.retired && !p.free_agent && p.contract);
}

describe("contract expiry", () => {
  it("takes a year off every deal on the books", () => {
    const s = fixture();
    const before = new Map(rostered(s).map((p) => [p.id, p.contract!.years_remaining]));
    expireContracts(s);
    for (const p of rostered(s)) {
      expect(p.contract!.years_remaining).toBe(before.get(p.id)! - 1);
    }
  });

  it("sends a player whose deal ran out to the open market", () => {
    const s = fixture();
    const p = rostered(s)[0]!;
    p.contract!.years_remaining = 1;
    const team = p.nfl_team;

    expireContracts(s);

    expect(p.free_agent).toBe(true);
    expect(p.contract).toBeNull();
    expect(p.nfl_team).not.toBe(team);
    expect(s.standingFreeAgents).toContain(p.id);
  });

  it("steps the cap hit forward, so an escalating deal escalates", () => {
    const s = fixture();
    const p = rostered(s).find((x) => (x.contract?.cap_hit_by_year.length ?? 0) > 2)!;
    const year2 = p.contract!.cap_hit_by_year[1]!;
    expireContracts(s);
    expect(p.contract!.cap_hit_by_year[0]).toBe(year2);
  });

  it("frees the cap room the expiring deals were taking up", () => {
    const s = fixture();
    const code = Object.keys(s.teams)[0]!;
    const squad = rostered(s).filter((p) => p.nfl_team === code);
    // flatten the deals that stay, so the only thing moving the team's number
    // is the departures rather than a surviving contract escalating
    for (const p of squad) {
      p.contract!.years_remaining = 3;
      p.contract!.cap_hit_by_year = [p.contract!.cap_hit_by_year[0] ?? 1];
    }
    const used = (): number =>
      rostered(s)
        .filter((p) => p.nfl_team === code)
        .reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);

    const leaving = squad.slice(0, 5);
    for (const p of leaving) p.contract!.years_remaining = 1;
    const owed = leaving.reduce((n, p) => n + (p.contract!.cap_hit_by_year[0] ?? 0), 0);
    const before = used();

    expireContracts(s);

    expect(used()).toBeCloseTo(before - owed, 1);
    for (const p of leaving) expect(p.free_agent).toBe(true);
  });

  it("leaves free agents and retirees alone", () => {
    const s = fixture();
    const fa = Object.values(s.players).find((p) => p.free_agent)!;
    const snapshot = JSON.stringify(fa);
    expireContracts(s);
    expect(JSON.stringify(fa)).toBe(snapshot);
  });
});
