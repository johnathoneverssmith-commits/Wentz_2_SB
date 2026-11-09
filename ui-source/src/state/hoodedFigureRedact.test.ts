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

/**
 * `hoodedFigure.unavailable` names the players a negative bargain sidelined —
 * so the team that was hit and for how long. It used to ride along to every GM
 * before the reveal.
 */
describe("the sidelined list, as one GM sees it", () => {
  /** GB pays an amount whose seeded outcome names players; NYJ pays nothing. */
  function sabotaged() {
    for (let pay = 1; pay <= 60; pay += 0.5) {
      const s = league();
      s.hoodedFigure!.encountersBySeason[s.season]!.GB!.resolved = false;
      s.hoodedFigure!.unavailable = [];
      s.hoodedFigure!.firstNegativeConsumed = false;
      const e = resolveHoodedFigureEncounter(s, "GB", pay);
      if (e.branch === "negative" && e.outcome?.negativePlayers?.length) return s;
    }
    throw new Error("no negative bargain found");
  }
  const ids = (s: ReturnType<typeof league>) => s.hoodedFigure!.unavailable.map((u) => u.playerId);

  it("is hidden from another GM until the reveal, then shows the same player and duration", () => {
    const s = sabotaged();
    const stored = structuredClone(s.hoodedFigure!.unavailable);
    expect(stored.length).toBeGreaterThan(0);
    for (const stage of ["hoodedFigureEncounter", "offseasonDepthChart"] as const) {
      const v = structuredClone(s);
      v.stage = stage;
      redactHoodedFigureFor(v, "NYJ");
      expect(ids(v), stage).toEqual([]);
    }
    s.season += 1;
    s.stage = "preseason";
    const pre = structuredClone(s);
    redactHoodedFigureFor(pre, "NYJ");
    expect(ids(pre), "preseason").toEqual([]);
    for (const stage of ["leagueDevelopments", "regularSeason"] as const) {
      const v = structuredClone(s);
      v.stage = stage;
      redactHoodedFigureFor(v, "NYJ");
      expect(v.hoodedFigure!.unavailable, stage).toEqual(stored);
    }
  });

  it("stays visible to the GM who struck the bargain", () => {
    const s = sabotaged();
    s.season += 1;
    s.stage = "preseason";
    redactHoodedFigureFor(s, "GB");
    expect(s.hoodedFigure!.unavailable.length).toBeGreaterThan(0);
  });

  it("keeps a whole-roster absence for the payer only, by the team it hit", () => {
    const s = league();
    const target = "DEN";
    const out = Object.values(s.players).filter((p) => p.nfl_team === target).slice(0, 5);
    s.hoodedFigure!.unavailable = out.map((p) => ({ playerId: p.id, untilWeek: null }));
    s.hoodedFigure!.encountersBySeason[s.season]!.GB!.outcome = {
      eventId: "the_team_plane", publicText: "", targetTeam: target, wholeRosterOut: true, absenceWeeks: null,
    };
    const other = structuredClone(s);
    redactHoodedFigureFor(other, "NYJ");
    expect(other.hoodedFigure!.unavailable).toEqual([]);
    redactHoodedFigureFor(s, "GB");
    expect(s.hoodedFigure!.unavailable).toHaveLength(out.length);
  });

  it("keys on the newest year: an older revealed encounter neither exposes a new effect nor hides a public one", () => {
    const s = sabotaged();
    const year = s.season;
    // an older, long-public encounter filed two years back
    s.hoodedFigure!.encountersBySeason[year - 2] = { GB: { ...s.hoodedFigure!.encountersBySeason[year]!.GB! } };
    const stored = structuredClone(s.hoodedFigure!.unavailable);
    const early = structuredClone(s);
    early.stage = "hoodedFigureEncounter";
    redactHoodedFigureFor(early, "NYJ");
    expect(early.hoodedFigure!.unavailable, "newer effect, older public year present").toEqual([]);
    s.season += 1;
    s.stage = "regularSeason";
    redactHoodedFigureFor(s, "NYJ");
    expect(s.hoodedFigure!.unavailable, "already public").toEqual(stored);
  });
});
