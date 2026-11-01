import { describe, expect, it } from "vitest";
import type { Player } from "@/domain";
import { reservesFor } from "./unitReserves";

const p = (id: string, position: string, overall: number, team = "SEA", extra: Partial<Player> = {}) => ({ id, name: id, position, overall, nfl_team: team, retired: false, ...extra }) as unknown as Player;

describe("unit reserves", () => {
  const players = Object.fromEntries([p("a", "WR", 90), p("b", "WR", 80), p("c", "WR", 70), p("d", "WR", 95, "KC"), p("e", "WR", 99, "SEA", { retired: true }), p("f", "TE", 60)].map((x) => [x.id, x]));
  it("derives reserves from the roster when no depth order was ever set", () => {
    expect(reservesFor(players, {}, "SEA", ["WR"], new Set(["a"])).map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("honours an explicit depth order, then overall", () => {
    expect(reservesFor(players, { SEA: { WR: ["c"] } }, "SEA", ["WR"], new Set(["a"])).map((x) => x.id)).toEqual(["c", "b"]);
  });
  it("excludes other teams, retirees and other positions, and caps the list", () => {
    expect(reservesFor(players, undefined, "SEA", ["WR"], new Set(), 2)).toHaveLength(2);
    expect(reservesFor(players, undefined, "SEA", ["WR"], new Set()).map((x) => x.id)).not.toContain("d");
    expect(reservesFor(players, undefined, "SEA", ["WR"], new Set()).map((x) => x.id)).not.toContain("e");
  });
});
