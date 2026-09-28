import { describe, expect, it } from "vitest";

import { ensureHoodedFigureEncounters, ensureHoodedFigureState, resolveHoodedFigureEncounter } from "./hoodedFigure.ts";
import { applyRelease, releasePenalty } from "./reconciliation.ts";
import { createLeague, DEFAULT_CONFIG, expireContracts, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";

/**
 * Money spent on nobody used to be added onto `cap.used`, which
 * recomputeTeamRatings rebuilt from contracts alone — so a release penalty
 * or a Hooded Figure payment vanished the next time anything recomputed,
 * usually in the same action.
 */
describe("dead money", () => {
  const league = () => {
    const s = createLeague(33, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
    fillRosterGaps(s);
    recomputeTeamRatings(s);
    return s;
  };

  it("stays on the books through a recompute, until the league year ends", () => {
    const s = league();
    const p = Object.values(s.players)
      .filter((x) => x.nfl_team === "GB" && x.contract && x.contract.years_remaining >= 2)
      .sort((a, b) => b.overall - a.overall)[0]!;
    const hit = p.contract!.cap_hit_by_year[0]!;
    const penalty = releasePenalty(p);
    const before = s.teams.GB!.cap.used;
    applyRelease(s, "GB", p.id);
    recomputeTeamRatings(s);
    expect(s.teams.GB!.cap.dead).toBeCloseTo(penalty, 1);
    expect(s.teams.GB!.cap.used).toBeCloseTo(before - hit + penalty, 1);
    expect(s.standingFreeAgents).toContain(p.id);

    expireContracts(s);
    recomputeTeamRatings(s);
    expect(s.teams.GB!.cap.dead).toBe(0);
  });

  it("charges the figure's price for the season", () => {
    const s = league();
    s.gms[0]!.teamCode = "GB";
    s.gms[0]!.isHuman = true;
    ensureHoodedFigureState(s).losingStreaks.GB = 2;
    s.stage = "hoodedFigureEncounter";
    ensureHoodedFigureEncounters(s);
    const before = s.teams.GB!.cap.used;
    resolveHoodedFigureEncounter(s, "GB", 5);
    recomputeTeamRatings(s);
    expect(s.teams.GB!.cap.used).toBeCloseTo(before + 5, 1);
  });
});
