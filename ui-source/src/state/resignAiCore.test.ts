import { describe, expect, it } from "vitest";

import { resignAiCore } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

/**
 * CPU teams keep their core. Every expiring deal used to go to the market, so
 * a first-round class was gone the offseason its rookie contracts ran out.
 */
describe("resignAiCore", () => {
  it("re-signs a CPU team's expiring star and leaves the human's alone", () => {
    const s = createLeague(11, { ...DEFAULT_CONFIG, fantasyDraft: false, humanGmCount: 1 });
    const gm = s.gms.find((g) => g.isHuman)!;
    gm.teamCode = "GB";
    s.teams.GB!.controlledBy = { kind: "human", gmId: gm.id };
    const human = "GB";
    const cpu = Object.keys(s.teams).find((c) => c !== human)!;
    const star = (team: string) =>
      Object.values(s.players)
        .filter((p) => p.nfl_team === team && !p.retired && p.contract && p.age <= 28)
        .sort((a, b) => b.overall - a.overall)[0]!;
    const theirs = star(cpu);
    const mine = star(human);
    for (const p of [theirs, mine]) p.contract!.years_remaining = 1;

    resignAiCore(s);

    expect(theirs.contract!.years_remaining).toBeGreaterThan(1);
    expect(mine.contract!.years_remaining).toBe(1);
  });

  it("does not spend next year's cap past the room the draft needs", () => {
    const s = createLeague(12, { ...DEFAULT_CONFIG, fantasyDraft: false, humanGmCount: 1 });
    for (const p of Object.values(s.players)) if (p.contract) p.contract.years_remaining = 1;
    resignAiCore(s);
    for (const code of Object.keys(s.teams)) {
      const next = Object.values(s.players)
        .filter((p) => p.nfl_team === code && p.contract && p.contract.years_remaining >= 2)
        .reduce((n, p) => n + (p.contract!.cap_hit_by_year[1] ?? 0), 0);
      expect(next, code).toBeLessThanOrEqual(s.teams[code]!.cap.total);
    }
  });
});
