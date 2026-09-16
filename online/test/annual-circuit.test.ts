import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { draftThresholdMet } from "@/state/rules.ts";
import { resolveTransition } from "@/state/stageMachine.ts";

/**
 * Change 13 — the circuit closes.
 *
 * With every change in, a season is a loop: the offseason feeds the
 * preseason, the preseason feeds the season, and the season feeds the next
 * offseason. This walks the whole thing once. It is the test that would
 * notice a stage wired to the wrong successor, which is the one bug in this
 * area that cannot be found by looking at a single change.
 */
function league(stage: Stage, week = 0, patch: Partial<LeagueState> = {}): LeagueState {
  const s = createLeague(31337, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.stage = stage;
  s.week = week;
  Object.assign(s, patch);
  return s;
}

const finishedDeadline = {
  order: [],
  round: 4,
  index: 0,
  active: null,
  resolved: [],
  drafts: {},
  done: true,
};

describe("a season, end to end", () => {
  it("runs the offseason into the preseason", () => {
    const steps: Stage[] = [];
    let s = league("offseasonRetirement");
    for (let i = 0; i < 12 && s.stage !== "preseason"; i++) {
      const t = resolveTransition(s);
      steps.push(t.stage);
      s = league(t.stage, t.week);
    }
    expect(steps).toEqual([
      "offseasonDraftPrep",
      "offseasonDraft",
      "offseasonDraftSummary",
      // Change 13: signings and free agency, then the circuit Changes 4 and 5
      // already built
      "freeAgency",
      "freeAgencySummary",
      "trainingCamp",
      "trainingCampResults",
      "offseasonDepthChart",
      "preseason",
    ]);
  });

  it("runs the preseason into the offseason again", () => {
    const steps: Stage[] = [];
    let s = league("preseason", 3);
    for (let i = 0; i < 20 && s.stage !== "offseasonRetirement"; i++) {
      const t = resolveTransition(s);
      steps.push(t.stage);
      s = league(t.stage, t.week, {
        // the deadline happens once; after it the season runs to week 18
        ...(steps.includes("tradeDeadline") ? { tradeDeadline: finishedDeadline } : {}),
        // Change 11 plays the whole postseason at the checkpoint, so by the
        // time the league is in the playoffs stage there is already a champion
        ...(t.stage === "playoffs"
          ? {
              bracket: {
                seeds: { AFC: [], NFC: [] },
                currentRound: "SB" as const,
                matchups: [],
                champion: "KC",
              },
            }
          : {}),
      });
      // jump the weeks the reveal controls would walk
      if (t.stage === "regularSeason" && t.week > 9) s.week = 18;
    }
    expect(steps).toEqual([
      "regularSeason",
      "tradeDeadline",
      "tradeDeadlineSummary",
      "midseasonFreeAgency",
      "midseasonFreeAgencySummary",
      "midseasonDepthChart",
      "regularSeason",
      "playoffs",
      "endOfSeasonAnnounce",
      "endOfSeasonConsolation",
      "offseasonRetirement",
    ]);
  });
});

describe("the rookie draft's manual round", () => {
  it("hands over to the machine once round one is done", () => {
    const s = league("offseasonDraft");
    const teams = Object.keys(s.teams).length;
    s.draft = {
      mode: "rookie",
      year: s.season,
      order: "linear",
      pickOrder: Array.from({ length: teams * 7 }, (_, i) => Object.keys(s.teams)[i % teams]!),
      currentPickIndex: teams - 1,
      results: [],
      targetsByGm: {},
    };
    expect(draftThresholdMet(s)).toBe(false);

    s.draft.currentPickIndex = teams;
    expect(draftThresholdMet(s)).toBe(true);
  });

  it("leaves the fantasy draft on the commissioner's setting", () => {
    const s = league("fantasyDraft", 0, {
      config: { ...DEFAULT_CONFIG, humanGmCount: 2, draftSimulateAfterPicks: null },
    });
    s.draft = {
      mode: "fantasy",
      year: s.season,
      order: "snake",
      pickOrder: [],
      currentPickIndex: 500,
      results: [],
      targetsByGm: {},
    };
    // a rookie-draft rule must not decide a fantasy draft
    expect(draftThresholdMet(s)).toBe(false);
  });
});
