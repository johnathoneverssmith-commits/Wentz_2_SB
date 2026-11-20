import { describe, expect, it } from "vitest";
import type { Player, Position } from "@/domain";
import { depthInversionAt, INVERSION_GAP } from "./depthInversion";

const mk = (id: string, position: Position, overall: number, out = false): Player =>
  ({
    id, name: id, position, overall, retired: false,
    injury_status: out ? { status: "out", weeks_out_est: [3, 5], description: "x" } : null,
  }) as unknown as Player;

describe("depthInversionAt", () => {
  it("flags a severe worst-first chart", () => {
    const line = [mk("c", "CB", 55), mk("b", "CB", 70), mk("a", "CB", 88), mk("d", "CB", 90)];
    const r = depthInversionAt("CB", line);
    expect(r?.starter.id).toBe("c");
    expect(r?.reserve.id).toBe("d");
    expect(r?.gap).toBe(35);
  });
  it("is quiet for a normal best-first chart", () => {
    expect(depthInversionAt("QB", [mk("a", "QB", 85), mk("b", "QB", 70), mk("c", "QB", 60)])).toBeNull();
  });
  it("is quiet for a plausible intentional choice (small gap)", () => {
    const line = [mk("vet", "QB", 80), mk("young", "QB", 80 + INVERSION_GAP - 1)];
    expect(depthInversionAt("QB", line)).toBeNull();
  });
  it("ignores injured players on either side", () => {
    expect(depthInversionAt("QB", [mk("hurt", "QB", 50, true), mk("ok", "QB", 70), mk("b", "QB", 72)])).toBeNull();
    expect(depthInversionAt("QB", [mk("a", "QB", 60), mk("hurtStar", "QB", 95, true)])).toBeNull();
  });
  it("only counts starter slots and clears once corrected", () => {
    const bad = [mk("a", "WR", 60), mk("b", "WR", 80), mk("c", "WR", 82), mk("d", "WR", 90)];
    expect(depthInversionAt("WR", bad)?.starter.id).toBe("a");
    const fixed = [bad[3]!, bad[2]!, bad[1]!, bad[0]!];
    expect(depthInversionAt("WR", fixed)).toBeNull();
  });
  it("has nothing to say where nobody starts", () => {
    expect(depthInversionAt("OLB", [mk("a", "OLB", 40), mk("b", "OLB", 90)])).toBeNull();
  });
});
