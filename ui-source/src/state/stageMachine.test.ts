import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { PRESEASON_WEEKS, REGULAR_SEASON_WEEKS, resolveTransition } from "./stageMachine.ts";

function base(p: Partial<LeagueState>): LeagueState {
  return {
    schemaVersion: 1,
    season: 2026,
    stage: "setup",
    week: 0,
    config: {
      humanGmCount: 3,
      fantasyDraft: true,
      draftOrder: "randomized",
      draftType: "linear",
    draftSimulateAfterPicks: 5,
      gameDayDeadlineHours: 12,
      offseasonStageDeadlineHours: 24,
      randomEvents: "some",
      difficulty: "normal",
    },
    gms: [],
    viewerGmId: "gm_you",
    teams: {},
    players: {},
    coaches: {},
    schedule: [],
    games: [],
    draftClass: [],
    draft: null,
    coachingDraft: null,
    freeAgencyEvent: null,
    trainingCamp: null,
  tradeDeadline: null,
    reveal: null,
    rookieOutcomes: {},
    freeAgency: null,
    standingFreeAgents: [],
    depthChart: {},
    draftPicks: {},
    coachingHire: null,
    bracket: null,
    trades: [],
    readiness: {},
    stageDeadlineAt: null,
    pendingGameDay: null,
    returnTo: null,
    history: [],
    ...p,
  };
}

describe("resolveTransition", () => {
  it("setup → fantasyDraft when fantasy draft is on", () => {
    expect(resolveTransition(base({ stage: "setup" })).stage).toBe("fantasyDraft");
  });

  it("setup → coaching draft when the fantasy draft is off", () => {
    const s = base({ stage: "setup" });
    s.config.fantasyDraft = false;
    // Turning off the *player* draft does not skip the coaching one. A staff
    // is drafted in this league rather than inherited, so every league passes
    // through it however it chose to fill its roster.
    expect(resolveTransition(s).stage).toBe("coachingDraft");
  });

  it("runs the coaching draft between the player summary and its own summary", () => {
    expect(resolveTransition(base({ stage: "fantasyDraftSummary" })).stage).toBe("coachingDraft");
    expect(resolveTransition(base({ stage: "coachingDraft" })).stage).toBe("coachingDraftSummary");
  });

  it("preseason advances week by week then resets stats entering regular week 1", () => {
    const mid = resolveTransition(base({ stage: "preseason", week: 1 }));
    expect(mid).toMatchObject({ stage: "preseason", week: 2 });

    const last = resolveTransition(base({ stage: "preseason", week: PRESEASON_WEEKS }));
    expect(last).toMatchObject({ stage: "regularSeason", week: 1, resetStats: true });
  });

  it("regular season rolls into playoffs after the final week", () => {
    const t = resolveTransition(base({ stage: "regularSeason", week: REGULAR_SEASON_WEEKS }));
    expect(t.stage).toBe("playoffs");
  });

  it("playoffs stays until the Super Bowl is played, then advances to the announce", () => {
    const midPlayoffs = resolveTransition(
      base({ stage: "playoffs", bracket: { currentRound: "SB", champion: null } as LeagueState["bracket"] }),
    );
    expect(midPlayoffs.stage).toBe("playoffs");

    const done = resolveTransition(
      base({ stage: "playoffs", bracket: { currentRound: "SB", champion: "KC" } as LeagueState["bracket"] }),
    );
    expect(done.stage).toBe("endOfSeasonAnnounce");
  });

  it("announce → win screen on a human SB win, else consolation", () => {
    expect(
      resolveTransition(base({ stage: "endOfSeasonAnnounce" }), { humanGmWonSuperBowl: true }).stage,
    ).toBe("endOfSeasonWin");
    expect(
      resolveTransition(base({ stage: "endOfSeasonAnnounce" }), { humanGmWonSuperBowl: false }).stage,
    ).toBe("endOfSeasonConsolation");
  });

  it("offseason order: retirement → draft prep → draft → summary → free agency", () => {
    const chain = [
      "offseasonRetirement",
      "offseasonDraftPrep",
      "offseasonDraft",
      "offseasonDraftSummary",
      "offseasonDepthChart",
    ] as const;
    const nexts = chain.map((stage) => resolveTransition(base({ stage })).stage);
    expect(nexts).toEqual([
      "offseasonDraftPrep",
      "offseasonDraft",
      // Change 13: the rookie draft ends at a summary, and rookie signings
      // are the second per-GM step of that same stage
      "offseasonDraftSummary",
      // which leads into annual free agency rather than the depth chart —
      // from there the circuit is the one Changes 4 and 5 built
      "freeAgency",
      "preseason",
    ]);
  });

  it("leaves a league caught mid-window a way out", () => {
    // nothing routes into these any more, but a save made before the windows
    // were removed can still be sitting in one
    expect(resolveTransition(base({ stage: "coachingHiring" })).stage).toBe("preseason");
    expect(resolveTransition(base({ stage: "offseasonFreeAgency" })).stage).toBe(
      "offseasonDepthChart",
    );
  });

  it("depth chart loops back to preseason with a season rollover", () => {
    const t = resolveTransition(base({ stage: "offseasonDepthChart" }));
    expect(t).toMatchObject({ stage: "preseason", week: 1, seasonRollover: true });
  });
});
