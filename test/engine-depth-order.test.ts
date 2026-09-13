import { describe, expect, it } from "vitest";

import { Roster, type DepthOrder } from "../src/engine/roster.js";
import type { Player } from "../src/schema/player.js";

/**
 * The franchise UI has a depth-chart stage, and until now nothing read its
 * output: `Roster` sorted every position by `overall` and discarded whatever
 * order it was handed. A GM could promote a backup quarterback and watch the
 * starter take every snap anyway.
 *
 * Rating order stays the default — the pool carries no depth-chart data, and
 * no validation path supplies one, so every existing sim is untouched.
 */
function player(id: string, position: string, overall: number): Player {
  return { id, name: id, position, age: 26, nfl_team: "KC", overall } as unknown as Player;
}

const squad = [
  player("qb_best", "QB", 92),
  player("qb_mid", "QB", 78),
  player("qb_worst", "QB", 61),
  player("rb_a", "RB", 80),
  player("rb_b", "RB", 70),
];

describe("Roster depth order", () => {
  it("sorts by overall when no order is given, exactly as before", () => {
    const r = new Roster("KC", squad);
    expect(r.depth.get("QB")!.map((p) => p.id)).toEqual(["qb_best", "qb_mid", "qb_worst"]);
  });

  it("puts the named starter first even when he isn't the best rated", () => {
    const order: DepthOrder = { QB: ["qb_mid", "qb_worst", "qb_best"] };
    const r = new Roster("KC", squad, order);
    expect(r.depth.get("QB")!.map((p) => p.id)).toEqual(["qb_mid", "qb_worst", "qb_best"]);
  });

  it("leaves positions the order doesn't mention on rating order", () => {
    const r = new Roster("KC", squad, { QB: ["qb_mid"] });
    expect(r.depth.get("RB")!.map((p) => p.id)).toEqual(["rb_a", "rb_b"]);
  });

  it("slots a player the order doesn't name in behind those it does", () => {
    // he signed after the chart was set; he doesn't leapfrog it on rating
    const r = new Roster("KC", squad, { QB: ["qb_worst"] });
    expect(r.depth.get("QB")!.map((p) => p.id)).toEqual(["qb_worst", "qb_best", "qb_mid"]);
  });

  it("ignores an empty order rather than emptying the chart", () => {
    const r = new Roster("KC", squad, { QB: [] });
    expect(r.depth.get("QB")!.map((p) => p.id)).toEqual(["qb_best", "qb_mid", "qb_worst"]);
  });

  it("ignores ids for players who aren't on the roster", () => {
    const r = new Roster("KC", squad, { QB: ["someone_else", "qb_mid"] });
    expect(r.depth.get("QB")!.map((p) => p.id)).toEqual(["qb_mid", "qb_best", "qb_worst"]);
  });
});
