import { describe, expect, it } from "vitest";

import { allStaffs } from "../src/engine/staff-data.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";

/**
 * The staff table is real people, so it can be wrong in ways a made-up one
 * cannot.
 *
 * It went wrong exactly once and quietly: the coordinator rows were refreshed
 * for the 2026 season and the head-coach rows were not, leaving ten teams on
 * the previous year's coach. The tell was five people apparently holding two
 * jobs at once — Brian Daboll as both the Giants' head coach and the Titans'
 * OC, Mike McDaniel as both the Dolphins' head coach and the Chargers' OC.
 * Nothing crashed and no rating looked odd; the league was simply staffed by
 * a mix of two different years.
 */
const staffs = allStaffs();

describe("the authored coaching staffs", () => {
  it("covers all thirty-two teams", () => {
    expect(Object.keys(staffs).sort()).toEqual([...NFL_TEAMS].sort());
  });

  it("gives every team a named head coach and both coordinators", () => {
    for (const team of NFL_TEAMS) {
      const s = staffs[team]!;
      for (const [role, name] of [
        ["HC", s.headCoach.name],
        ["OC", s.oc.name],
        ["DC", s.dc.name],
      ] as const) {
        expect(name, `${team} ${role}`).toBeTruthy();
        // a real person, not a placeholder
        expect(name.trim().split(/\s+/).length, `${team} ${role} "${name}"`).toBeGreaterThan(1);
      }
    }
  });

  it("never has one person coaching two different teams", () => {
    const jobs = new Map<string, string[]>();
    for (const team of NFL_TEAMS) {
      const s = staffs[team]!;
      for (const [role, who] of [
        ["HC", s.headCoach.name],
        ["OC", s.oc.name],
        ["DC", s.dc.name],
      ] as const) {
        jobs.set(who, [...(jobs.get(who) ?? []), `${team} ${role}`]);
      }
    }
    for (const [name, held] of jobs) {
      if (held.length === 1) continue;
      // A head coach calling his own defense is a real thing (Todd Bowles in
      // Tampa). Holding jobs at two different clubs is not.
      const teams = new Set(held.map((h) => h.split(" ")[0]));
      expect(teams.size, `${name} coaches ${held.join(" and ")}`).toBe(1);
    }
  });

  it("keeps every rating inside the compressed band the effect was tuned for", () => {
    for (const team of NFL_TEAMS) {
      const s = staffs[team]!;
      expect(s.headCoach.gameManagement, team).toBeGreaterThanOrEqual(40);
      expect(s.headCoach.gameManagement, team).toBeLessThanOrEqual(70);
      expect(s.headCoach.discipline, team).toBeGreaterThanOrEqual(40);
      expect(s.headCoach.discipline, team).toBeLessThanOrEqual(70);
      expect(s.headCoach.aggression, team).toBeGreaterThanOrEqual(0);
      expect(s.headCoach.aggression, team).toBeLessThanOrEqual(1);
      expect(s.oc.rating, team).toBeGreaterThanOrEqual(40);
      expect(s.oc.rating, team).toBeLessThanOrEqual(70);
      expect(s.dc.rating, team).toBeGreaterThanOrEqual(40);
      expect(s.dc.rating, team).toBeLessThanOrEqual(70);
    }
  });
});
