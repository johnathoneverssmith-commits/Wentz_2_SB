import { describe, expect, it } from "vitest";

import { TEAMS } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { allStaffs } from "../../../src/engine/staff-data.js";

/**
 * The coaches in the game are the real ones.
 *
 * Every coach used to be `fullPersonName(rng)` with random ratings — the
 * engine had carried the real thirty-two staffs the whole time and the UI
 * never read them, which is the same mistake the schedule made. A player
 * hired invented people to run real franchises.
 */
const sim = new MockSimulationService();
const coaches = sim.generateCoachMarket(7);
const staffs = allStaffs();
/** The engine spells the Rams "LA". */
const engineCode = (c: string) => (c === "LAR" ? "LA" : c);

describe("the coaching market", () => {
  it("staffs all thirty-two teams from the authored table", () => {
    for (const t of TEAMS) {
      const staff = staffs[engineCode(t.code)]!;
      const mine = coaches.filter((c) => c.team === t.code);
      expect(mine.map((c) => c.role).sort(), t.code).toEqual(["DC", "HC", "OC"]);
      expect(mine.find((c) => c.role === "HC")!.name, t.code).toBe(staff.headCoach.name);
      expect(mine.find((c) => c.role === "OC")!.name, t.code).toBe(staff.oc.name);
      expect(mine.find((c) => c.role === "DC")!.name, t.code).toBe(staff.dc.name);
    }
  });

  it("carries the scheme across unchanged — the vocabularies are the same", () => {
    for (const t of TEAMS) {
      const staff = staffs[engineCode(t.code)]!;
      const mine = coaches.filter((c) => c.team === t.code);
      expect(mine.find((c) => c.role === "OC")!.scheme, t.code).toBe(staff.oc.scheme);
      expect(mine.find((c) => c.role === "DC")!.scheme, t.code).toBe(staff.dc.scheme);
    }
  });

  it("preserves the order of the engine's ratings when it rescales them", () => {
    // Fangio is the lowest-blitz DC in the table and Flores the highest; if
    // the mapping ever inverts or flattens, that ordering is the tell.
    const dcs = TEAMS.map((t) => ({
      code: t.code,
      engine: staffs[engineCode(t.code)]!.dc.blitzBias,
      ui: coaches.find((c) => c.team === t.code && c.role === "DC")!.tendencyBlitzRate!,
    }));
    const byEngine = [...dcs].sort((a, b) => a.engine - b.engine).map((d) => d.ui);
    for (let i = 1; i < byEngine.length; i++) {
      expect(byEngine[i]!).toBeGreaterThanOrEqual(byEngine[i - 1]!);
    }
  });

  it("puts every coach on a 0–99 scale the rest of the app can show", () => {
    for (const c of coaches) {
      for (const v of [c.discipline, c.gameManagement, c.aggressiveness, c.playCallIq,
                       c.tendencyPassRate, c.tendencyBlitzRate]) {
        if (v === undefined) continue;
        expect(v, c.name).toBeGreaterThanOrEqual(0);
        expect(v, c.name).toBeLessThanOrEqual(99);
      }
    }
  });

  it("still offers an open market to hire from", () => {
    const free = coaches.filter((c) => !c.team);
    expect(free.length).toBeGreaterThan(0);
    expect(free.every((c) => c.contract === null)).toBe(true);
    // one of each role is available, or a vacancy could be unfillable
    for (const role of ["HC", "OC", "DC"]) {
      expect(free.some((c) => c.role === role), role).toBe(true);
    }
  });
});
