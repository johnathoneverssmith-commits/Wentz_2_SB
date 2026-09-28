import { describe, expect, it } from "vitest";

import {
  ensureHoodedFigureEncounters,
  ensureHoodedFigureState,
  hoodedFigureEncounterFor,
  leagueDevelopmentsFor,
  redactHoodedFigureFor,
  resolveHoodedFigureEncounter,
} from "./hoodedFigure.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * Online, the league document goes to every GM. It used to carry each
 * encounter's hidden price points — pay exactly the top tier — and every
 * other GM's bargain the moment it was struck, ahead of the reveal.
 */
function league() {
  const s = createLeague(21, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "GB";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "NYJ";
  s.gms[1]!.isHuman = true;
  const hf = ensureHoodedFigureState(s);
  hf.losingStreaks.GB = 2;
  hf.losingStreaks.NYJ = 2;
  s.stage = "hoodedFigureEncounter";
  ensureHoodedFigureEncounters(s);
  resolveHoodedFigureEncounter(s, "GB", 6);
  return s;
}

describe("the figure, as one GM sees it", () => {
  it("never shows the price points, and hides the other GM's bargain until the reveal", () => {
    const s = league();
    const nyj = structuredClone(s);
    redactHoodedFigureFor(nyj, "NYJ");
    expect(hoodedFigureEncounterFor(nyj, "NYJ")!.thresholds).toEqual({ t1: 0, t2: 0, t3: 0 });
    expect(hoodedFigureEncounterFor(nyj, "GB"), "GB's bargain before the reveal").toBeNull();

    const gb = structuredClone(s);
    redactHoodedFigureFor(gb, "GB");
    expect(hoodedFigureEncounterFor(gb, "GB")!.resolved).toBe(true);
    expect(hoodedFigureEncounterFor(gb, "GB")!.thresholds.t3).toBe(0);
  });

  it("shows everyone the same League Developments once they're revealed", () => {
    const s = league();
    s.season += 1;
    s.stage = "preseason";
    const early = structuredClone(s);
    redactHoodedFigureFor(early, "NYJ");
    expect(leagueDevelopmentsFor(early)).toHaveLength(0);

    s.stage = "leagueDevelopments";
    const nyj = structuredClone(s);
    redactHoodedFigureFor(nyj, "NYJ");
    expect(leagueDevelopmentsFor(nyj)).toEqual(leagueDevelopmentsFor(s));
    expect(leagueDevelopmentsFor(s).length).toBeGreaterThan(0);
  });
});
