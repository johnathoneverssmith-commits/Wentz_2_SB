/**
 * The annual-cycle state machine. Each stage has a canonical screen and a
 * `next()` fired by the readiness gate.
 *
 * In-season weeks (preseason, regularSeason) and playoff rounds are NO LONGER
 * simulated inside the transition — the readiness gate on the hub/bracket runs
 * the sim and routes to the Game Day screen, and Game Day's "continue" button
 * calls `advanceAfterGameDay` which is what moves the week / round / stage.
 */
import type { LeagueState, Stage } from "@/domain";

export const PRESEASON_WEEKS = 3;
export const REGULAR_SEASON_WEEKS = 18;

export const STAGE_HOME: Record<Stage, string> = {
  setup: "/setup",
  fantasyDraft: "/draft",
  fantasyDraftSummary: "/fantasy-draft-summary",
  coachingHiring: "/coaching",
  preseason: "/hub",
  regularSeason: "/hub",
  playoffs: "/bracket",
  endOfSeasonAnnounce: "/end-of-season",
  endOfSeasonWin: "/season-complete",
  endOfSeasonConsolation: "/season-complete",
  offseasonRetirement: "/retirement",
  offseasonDraftPrep: "/draft-preview",
  offseasonDraft: "/draft",
  offseasonSignings: "/rookie-signings",
  offseasonFreeAgency: "/free-agency",
  offseasonDepthChart: "/roster",
};

export const STAGE_READY_LABEL: Record<Stage, string> = {
  setup: "I'm ready to begin",
  fantasyDraft: "Ready — start the draft",
  fantasyDraftSummary: "Ready to advance to coaching",
  coachingHiring: "Ready to advance to the preseason",
  preseason: "Ready for Game Day",
  regularSeason: "Ready for Game Day",
  playoffs: "Ready to simulate this round",
  endOfSeasonAnnounce: "Continue",
  endOfSeasonWin: "Ready to advance to the offseason",
  endOfSeasonConsolation: "Ready to advance to the offseason",
  offseasonRetirement: "Ready to advance to the draft",
  offseasonDraftPrep: "Ready to advance to the NFL Draft",
  offseasonDraft: "Ready to advance to signings",
  offseasonSignings: "Ready to advance to free agency",
  offseasonFreeAgency: "Ready to re-order the depth chart",
  offseasonDepthChart: "Ready to start the season",
};

export const STAGE_LABEL: Record<Stage, string> = {
  setup: "League Setup",
  fantasyDraft: "Fantasy Draft",
  fantasyDraftSummary: "Fantasy Draft Summary",
  coachingHiring: "Coaching Staff — Hiring Window",
  preseason: "Preseason",
  regularSeason: "Regular Season",
  playoffs: "Playoffs",
  endOfSeasonAnnounce: "Season Complete",
  endOfSeasonWin: "Season Complete",
  endOfSeasonConsolation: "Season Complete",
  offseasonRetirement: "Retirement Review",
  offseasonDraftPrep: "Draft Preview",
  offseasonDraft: "NFL Draft",
  offseasonSignings: "Rookie Signings",
  offseasonFreeAgency: "Free Agency",
  offseasonDepthChart: "Depth Chart",
};

export interface Transition {
  stage: Stage;
  week: number;
  resetStats?: boolean;
  seasonRollover?: boolean;
}

/**
 * The stage that follows `stage` once its readiness gate opens. Week-bearing
 * stages step their week here; the actual game sim already ran on the hub.
 */
export function resolveTransition(
  state: LeagueState,
  opts: { humanGmWonSuperBowl?: boolean } = {},
): Transition {
  const { stage, week, config } = state;

  switch (stage) {
    case "setup":
      return config.fantasyDraft
        ? { stage: "fantasyDraft", week: 0 }
        : { stage: "coachingHiring", week: 0 };
    case "fantasyDraft":
      return { stage: "fantasyDraftSummary", week: 0 };
    case "fantasyDraftSummary":
      return { stage: "coachingHiring", week: 0 };
    case "coachingHiring":
      return { stage: "preseason", week: 1 };

    case "preseason":
      return week < PRESEASON_WEEKS
        ? { stage: "preseason", week: week + 1 }
        : { stage: "regularSeason", week: 1, resetStats: true };

    case "regularSeason":
      return week < REGULAR_SEASON_WEEKS
        ? { stage: "regularSeason", week: week + 1 }
        : { stage: "playoffs", week: 0 };

    case "playoffs": {
      // leave the playoffs only once the Super Bowl has actually been played
      return state.bracket?.champion
        ? { stage: "endOfSeasonAnnounce", week: 0 }
        : { stage: "playoffs", week: 0 };
    }

    case "endOfSeasonAnnounce":
      return {
        stage: opts.humanGmWonSuperBowl ? "endOfSeasonWin" : "endOfSeasonConsolation",
        week: 0,
      };
    case "endOfSeasonWin":
    case "endOfSeasonConsolation":
      return { stage: "offseasonRetirement", week: 0 };

    case "offseasonRetirement":
      return { stage: "offseasonDraftPrep", week: 0 };
    case "offseasonDraftPrep":
      return { stage: "offseasonDraft", week: 0 };
    case "offseasonDraft":
      return { stage: "offseasonSignings", week: 0 };
    case "offseasonSignings":
      return { stage: "offseasonFreeAgency", week: 0 };
    case "offseasonFreeAgency":
      return { stage: "offseasonDepthChart", week: 0 };
    case "offseasonDepthChart":
      return { stage: "preseason", week: 1, seasonRollover: true };
  }
}

export function baseScreen(stage: Stage): "hub" | "bracket" {
  return stage === "playoffs" ? "bracket" : "hub";
}
