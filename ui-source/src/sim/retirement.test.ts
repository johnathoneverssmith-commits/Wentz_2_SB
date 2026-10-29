import { describe, expect, it } from "vitest";

import { injuryAgeReduction, MockSimulationService } from "./MockSimulationService.ts";
import { RETIREMENT_AGE } from "./roster-template.ts";
import type { InjuryHistoryEntry, Player } from "@/domain";
import { DEFAULT_CONFIG, createLeague } from "../state/seed.ts";

/**
 * Retirement modeling: a player's effective retirement-age norm should fall
 * with a meaningful injury history (not just count injuries flatly), and the
 * probability of retiring should rise once a player is past their
 * (injury-adjusted) norm.
 */

function injury(type: string, severity: string): InjuryHistoryEntry {
  return { season: 2024, type, severity, weeks_out: 4 };
}

describe("injuryAgeReduction", () => {
  it("is 0 for a clean injury history", () => {
    expect(injuryAgeReduction([])).toBe(0);
  });

  it("weighs a significant concussion far more than a minor hamstring", () => {
    const concussion = injuryAgeReduction([injury("concussion", "significant")]);
    const hamstring = injuryAgeReduction([injury("hamstring", "minor")]);
    expect(concussion).toBeGreaterThan(hamstring * 3);
  });

  it("scales with severity for the same injury type", () => {
    const minor = injuryAgeReduction([injury("knee", "minor")]);
    const moderate = injuryAgeReduction([injury("knee", "moderate")]);
    const significant = injuryAgeReduction([injury("knee", "significant")]);
    expect(minor).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(significant);
  });

  it("compounds multiple injuries with diminishing returns, not linearly", () => {
    const one = injuryAgeReduction([injury("knee", "significant")]);
    const two = injuryAgeReduction([injury("knee", "significant"), injury("ankle", "minor")]);
    expect(two).toBeGreaterThan(one); // more injuries still costs more
    expect(two).toBeLessThan(one * 2); // but not proportionally
  });
});

describe("retirementOutcomes", () => {
  const sim = new MockSimulationService();
  const basePlayer = Object.values(createLeague(1, DEFAULT_CONFIG).players).find(
    (p) => p.position === "RB",
  )!;

  function playerAt(age: number, injury_history: InjuryHistoryEntry[] = []): Player {
    return { ...basePlayer, id: "test_player", age, injury_history };
  }

  it("a healthy player well under the position norm is not evaluated for retirement", () => {
    const norm = RETIREMENT_AGE.RB;
    const out = sim.retirementOutcomes(1, [playerAt(norm - 6)]);
    expect(out.find((o) => o.playerId === "test_player")).toBeUndefined();
  });

  it("an injury-laden player retires more often at the same age than a clean one", () => {
    const norm = RETIREMENT_AGE.RB;
    const age = norm; // right at the healthy norm
    let hurtRetirements = 0;
    let cleanRetirements = 0;
    const trials = 200;
    for (let seed = 0; seed < trials; seed++) {
      const hurt = playerAt(age, [
        injury("concussion", "significant"),
        injury("knee", "significant"),
      ]);
      const clean = playerAt(age, []);
      if (sim.retirementOutcomes(seed, [hurt])[0]?.decision === "retiring") hurtRetirements++;
      if (sim.retirementOutcomes(seed, [clean])[0]?.decision === "retiring") cleanRetirements++;
    }
    expect(hurtRetirements).toBeGreaterThan(cleanRetirements);
  });
});

describe("retirementOutcomes is independent of list order and membership", () => {
  const sim = new MockSimulationService();
  const league = () => createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
  const decide = (season: number, ps: Player[]) => new Map(sim.retirementOutcomes(season, ps).map((o) => [o.playerId, o.decision]));

  it("gives each player the same decision however the array is ordered", () => {
    const ps = Object.values(league().players).filter((p) => !p.retired);
    const a = decide(2030, ps);
    expect(a.size).toBeGreaterThan(50);
    expect([...decide(2030, [...ps].reverse())]).toEqual(expect.arrayContaining([...a]));
    const shuffled = [...ps].sort((x, y) => (x.id < y.id ? 1 : -1)).sort((x, y) => x.age - y.age);
    expect(decide(2030, shuffled)).toEqual(a);
  });

  it("does not change when other players are added or removed", () => {
    const ps = Object.values(league().players).filter((p) => !p.retired);
    const a = decide(2030, ps);
    const half = decide(2030, ps.filter((_, i) => i % 2 === 0));
    for (const [id, v] of half) expect(a.get(id)).toBe(v);
  });

  it("is the same after a save and reload (JSON round trip)", () => {
    const s = league();
    const before = decide(2030, Object.values(s.players));
    const reloaded = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(decide(2030, Object.values(reloaded.players))).toEqual(before);
  });

  it("varies across seasons, and does not decide every eligible player the same way", () => {
    const ps = Object.values(league().players);
    const a = decide(2030, ps);
    const b = decide(2031, ps);
    let differ = 0;
    for (const [id, v] of a) if (b.has(id) && b.get(id) !== v) differ++;
    expect(differ).toBeGreaterThan(0);
    const retiring = [...a.values()].filter((d) => d === "retiring").length;
    expect(retiring).toBeGreaterThan(0);
    expect(retiring).toBeLessThan(a.size);
  });
});
