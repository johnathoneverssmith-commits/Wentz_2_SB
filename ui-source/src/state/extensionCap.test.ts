import { describe, expect, it } from "vitest";

import { extendContract, extensionAsk, nextYearCommitments } from "./contracts";
import { applyDraftSetting, createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed";

function league() {
  const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
  applyDraftSetting(s);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  return s;
}

describe("extending a contract is judged against next year's cap", () => {
  it("a star can be extended in season, with this year's payroll at the cap, when next year has room", () => {
    const s = league();
    const star = Object.values(s.players).filter((p) => p.nfl_team === "GB" && p.contract).sort((a, b) => b.overall - a.overall)[0]!;
    star.contract!.years_remaining = 1;
    star.contract!.cap_hit_by_year = star.contract!.cap_hit_by_year.slice(0, 1);
    // in season the payroll sits just under the cap; that is this year's money, not next year's
    s.teams.GB!.cap.used = s.teams.GB!.cap.total - 1;
    expect(nextYearCommitments(s, "GB")).toBeLessThan(s.teams.GB!.cap.total - extensionAsk(star).baseSalary);
    expect(extendContract(s, star, extensionAsk(star)).ok).toBe(true);
    expect(star.contract!.years_remaining).toBeGreaterThan(1);
  });

  it("is refused when next year's commitments really cannot take it", () => {
    const s = league();
    const roster = Object.values(s.players).filter((p) => p.nfl_team === "GB" && p.contract);
    const star = roster.sort((a, b) => b.overall - a.overall)[0]!;
    star.contract!.years_remaining = 1;
    star.contract!.cap_hit_by_year = star.contract!.cap_hit_by_year.slice(0, 1);
    // everyone else is owed a fortune next year
    for (const p of roster) {
      if (p === star) continue;
      p.contract!.years_remaining = 3;
      p.contract!.cap_hit_by_year = [p.contract!.cap_hit_by_year[0] ?? 1, 10, 10];
    }
    const r = extendContract(s, star, extensionAsk(star));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/next year's cap/);
  });
});
