import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { createLeague, DEFAULT_CONFIG, depthAt, fillRosterGaps, recomputeTeamRatings, startingLineup } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * The depth chart lived in one screen's `useState`. Re-ordering it changed
 * nothing, survived nothing, and reached nothing — an entire stage of the
 * annual cycle whose output no other code read. It is now persisted state,
 * it decides who the starting lineup is (and so the team's rating), and it
 * rides along to the simulator, where `Roster` honours it instead of sorting
 * everyone by rating.
 */
function fixture(): { s: LeagueState; code: string } {
  const s = createLeague(13, DEFAULT_CONFIG);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  return { s, code: Object.keys(s.teams)[0]! };
}

describe("depth chart", () => {
  it("falls back to overall when the GM hasn't set one", () => {
    const { s, code } = fixture();
    const qbs = depthAt(s, code, "QB");
    expect(qbs.map((p) => p.overall)).toEqual([...qbs.map((p) => p.overall)].sort((a, b) => b - a));
  });

  it("puts the GM's pick first even when he isn't the best rated", () => {
    const { s, code } = fixture();
    const qbs = depthAt(s, code, "QB");
    const backup = qbs[1]!;
    s.depthChart[code] = { QB: [backup.id, qbs[0]!.id] };

    expect(depthAt(s, code, "QB")[0]!.id).toBe(backup.id);
    expect(startingLineup(s, code).find((p) => p.position === "QB")!.id).toBe(backup.id);
  });

  it("slots a player signed after the chart was set in behind it", () => {
    const { s, code } = fixture();
    const qbs = depthAt(s, code, "QB");
    s.depthChart[code] = { QB: [qbs[2]!.id] }; // only the third-stringer named
    expect(depthAt(s, code, "QB").map((p) => p.id)).toEqual([qbs[2]!.id, qbs[0]!.id, qbs[1]!.id]);
  });

  it("changes the team rating, because starters are what it averages", () => {
    const { s, code } = fixture();
    const before = (recomputeTeamRatings(s), s.teams[code]!.ratings.overall);
    const qbs = depthAt(s, code, "QB");
    s.depthChart[code] = { QB: [qbs[qbs.length - 1]!.id] }; // start the worst one
    recomputeTeamRatings(s);
    expect(s.teams[code]!.ratings.overall).toBeLessThan(before);
  });

  it("survives the screen: the store keeps it", () => {
    const s = useStore.getState();
    const code = Object.keys(s.teams)[0]!;
    s.setDepthOrder(code, "WR", ["a", "b", "c"]);
    expect(useStore.getState().depthChart[code]!.WR).toEqual(["a", "b", "c"]);
  });

  it("an empty order means 'go back to rating order'", () => {
    const s = useStore.getState();
    const code = Object.keys(s.teams)[0]!;
    s.setDepthOrder(code, "WR", ["a"]);
    s.setDepthOrder(code, "WR", []);
    expect(useStore.getState().depthChart[code]!.WR).toEqual([]);
    const after = useStore.getState();
    const wrs = depthAt(after, code, "WR");
    expect(wrs.map((p) => p.overall)).toEqual([...wrs.map((p) => p.overall)].sort((a, b) => b - a));
  });
});
