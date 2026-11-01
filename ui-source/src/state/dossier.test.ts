import { describe, expect, it } from "vitest";
import type { Player } from "@/domain";
import { buildDossier, signed } from "./dossier";

const mk = (id: string, position: Player["position"], overall: number, attributes: Record<string, number>, extra: Partial<Player> = {}): Player =>
  ({ id, name: id, position, age: 25, nfl_team: "FA", years_pro: 2, overall, attributes, scheme_tags: [], dev_age_threshold: 27, decline_age_threshold: 31, injury_history: [], contract: null, free_agent: true, injury_status: null, retired: false, ...extra }) as Player;

describe("scouting dossier", () => {
  const league: Record<string, Player> = {};
  for (const p of [
    mk("a", "QB", 90, { throw_power: 90, awareness: 80 }, { potential: 99 }),
    mk("b", "QB", 70, { throw_power: 70, awareness: 60 }),
    mk("c", "QB", 80, { throw_power: 80 }),
    mk("r", "QB", 99, { throw_power: 99 }, { retired: true }),
    mk("w", "WR", 95, { speed: 95 }),
  ]) league[p.id] = p;

  it("compares each skill with the same-position league average, excluding retirees and other positions", () => {
    const d = buildDossier(league.a!, league);
    const tp = d.skills.find((s) => s.key === "throw_power")!;
    expect(tp.average).toBe(80); // (90+70+80)/3
    expect(tp.diff).toBe(10);
    expect(d.sample).toBe(3);
    expect(d.overall.average).toBe(80);
  });
  it("averages a skill over the players who have it", () => {
    const d = buildDossier(league.a!, league);
    expect(d.skills.find((s) => s.key === "awareness")!.average).toBe(70);
  });
  it("lists only skills the player has and never exposes hidden potential", () => {
    const d = buildDossier(league.a!, league);
    expect(d.skills.map((s) => s.key).sort()).toEqual(["awareness", "throw_power"]);
    expect(JSON.stringify(d)).not.toContain("99");
  });
  it("gives no average rather than a made-up one when the position is too thin", () => {
    const d = buildDossier(league.w!, league);
    expect(d.skills[0]!.average).toBeNull();
    expect(d.skills[0]!.diff).toBeNull();
  });
  it("formats signed differences", () => {
    expect(signed(3.2)).toBe("+3.2");
    expect(signed(-1)).toBe("−1.0");
    expect(signed(0)).toBe("0.0");
    expect(signed(null)).toBe("—");
  });
});
