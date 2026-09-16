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
/**
 * The last week of the first precomputed regular-season block.
 *
 * Nine, not ten, because the trade deadline sits between them. A block is
 * only sound while nothing can change its inputs, and a deadline trade
 * changes both rosters — so the block has to stop before it.
 */
export const FIRST_BLOCK_LAST_WEEK = 9;

export const STAGE_HOME: Record<Stage, string> = {
  setup: "/setup",
  fantasyDraft: "/draft",
  fantasyDraftSummary: "/fantasy-draft-summary",
  coachingDraft: "/coaching-draft",
  coachingDraftSummary: "/coaching-draft-summary",
  freeAgency: "/free-agency-board",
  freeAgencySummary: "/free-agency-summary",
  trainingCamp: "/training-camp",
  trainingCampResults: "/training-camp-results",
  coachingHiring: "/coaching",
  preseason: "/hub",
  regularSeason: "/hub",
  tradeDeadline: "/trade-deadline",
  tradeDeadlineSummary: "/trade-summary",
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
  fantasyDraftSummary: "Advance to Coaching",
  coachingDraft: "Coaching draft in progress",
  coachingDraftSummary: "Advance to Free Agency",
  freeAgency: "Free agency in progress",
  freeAgencySummary: "Advance to Training Camp",
  trainingCamp: "Advance to End of Training Camp",
  trainingCampResults: "Advance to Re-order Depth Chart",
  coachingHiring: "Ready to advance to the preseason",
  preseason: "Ready for Game Day",
  regularSeason: "Ready for Game Day",
  tradeDeadline: "Trade deadline in progress",
  tradeDeadlineSummary: "Advance to Mid-Season Free Agency",
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
  coachingDraft: "Coaching Fantasy Draft",
  coachingDraftSummary: "Coaching Draft Summary",
  freeAgency: "Free Agency",
  freeAgencySummary: "Free Agency Summary",
  trainingCamp: "Training Camp",
  trainingCampResults: "Training Camp Results",
  coachingHiring: "Coaching Staff — Hiring Window",
  preseason: "Preseason",
  regularSeason: "Regular Season",
  tradeDeadline: "Trade Deadline",
  tradeDeadlineSummary: "Trade Summary",
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
        : { stage: "coachingDraft", week: 0 };
    case "fantasyDraft":
      return { stage: "fantasyDraftSummary", week: 0 };
    case "fantasyDraftSummary":
      return { stage: "coachingDraft", week: 0 };
    case "coachingDraft":
      return { stage: "coachingDraftSummary", week: 0 };
    case "coachingDraftSummary":
      return { stage: "freeAgency", week: 0 };
    case "freeAgency":
      return { stage: "freeAgencySummary", week: 0 };
    case "freeAgencySummary":
      return { stage: "trainingCamp", week: 0 };
    case "trainingCamp":
      return { stage: "trainingCampResults", week: 0 };
    case "trainingCampResults":
      return { stage: "offseasonDepthChart", week: 0 };
    // Kept only so a league that was already sitting in the old timed hiring
    // window when this shipped has somewhere to go. Nothing routes into it.
    case "coachingHiring":
      return { stage: "preseason", week: 1 };

    case "preseason":
      return week < PRESEASON_WEEKS
        ? { stage: "preseason", week: week + 1 }
        : { stage: "regularSeason", week: 1, resetStats: true };

    case "regularSeason":
      // Changes 7 and 8: the season stops at the deadline on the way past
      // week 9, and only once. `tradeDeadline` being non-null is what says
      // the league has already been through it this year — the week alone
      // cannot say so, since the stage is `regularSeason` on both sides.
      if (week <= FIRST_BLOCK_LAST_WEEK && !state.tradeDeadline) {
        return { stage: "tradeDeadline", week: FIRST_BLOCK_LAST_WEEK };
      }
      return week < REGULAR_SEASON_WEEKS
        ? { stage: "regularSeason", week: week + 1 }
        : { stage: "playoffs", week: 0 };

    case "tradeDeadline":
      return { stage: "tradeDeadlineSummary", week: FIRST_BLOCK_LAST_WEEK };
    case "tradeDeadlineSummary":
      return { stage: "regularSeason", week: FIRST_BLOCK_LAST_WEEK + 1 };

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
      return { stage: "offseasonDepthChart", week: 0 };
    // As above: only a way out for a league caught mid-window.
    case "offseasonFreeAgency":
      return { stage: "offseasonDepthChart", week: 0 };
    case "offseasonDepthChart":
      return { stage: "preseason", week: 1, seasonRollover: true };
  }
}

export function baseScreen(stage: Stage): "hub" | "bracket" {
  return stage === "playoffs" ? "bracket" : "hub";
}
