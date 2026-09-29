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

import { NFL_SEASON_SHAPE, seasonShape } from "./leagueFormat";
import { isHoodedFigureEligible, leagueDevelopmentsFor } from "./hoodedFigure";

/**
 * The NFL format's season. A league's own shape comes from `seasonShape` —
 * a humans-only round robin is a different length — so these are kept for
 * NFL-only callers and tests, not read by the season logic below.
 */
export const PRESEASON_WEEKS = NFL_SEASON_SHAPE.preseasonWeeks;
export const REGULAR_SEASON_WEEKS = NFL_SEASON_SHAPE.regularSeasonWeeks;
/**
 * The last week of the first precomputed regular-season block.
 *
 * Nine, not ten, because the trade deadline sits between them. A block is
 * only sound while nothing can change its inputs, and a deadline trade
 * changes both rosters — so the block has to stop before it.
 */
export const FIRST_BLOCK_LAST_WEEK = NFL_SEASON_SHAPE.deadlineWeek;

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
  hoodedFigureEncounter: "/hooded-figure",
  coachingHiring: "/coaching",
  preseason: "/hub",
  leagueDevelopments: "/league-developments",
  regularSeason: "/hub",
  tradeDeadline: "/trade-deadline",
  tradeDeadlineSummary: "/trade-summary",
  // Change 9 deliberately reuses Change 4's screens rather than copying them:
  // it is the same market, the same reconciliation and the same depth chart,
  // and a second set would be two implementations of one set of rules.
  midseasonFreeAgency: "/free-agency-board",
  midseasonFreeAgencySummary: "/free-agency-summary",
  midseasonDepthChart: "/roster",
  playoffs: "/bracket",
  endOfSeasonAnnounce: "/end-of-season",
  endOfSeasonWin: "/season-complete",
  endOfSeasonConsolation: "/season-complete",
  offseasonRetirement: "/retirement",
  offseasonDraftPrep: "/draft-preview",
  offseasonDraft: "/draft",
  offseasonDraftSummary: "/rookie-draft-summary",
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
  trainingCampResults: "Advance",
  hoodedFigureEncounter: "Advance to Re-order Depth Chart",
  coachingHiring: "Ready to advance to the preseason",
  preseason: "Ready for Game Day",
  leagueDevelopments: "Continue",
  regularSeason: "Ready for Game Day",
  tradeDeadline: "Trade deadline in progress",
  tradeDeadlineSummary: "Advance to Mid-Season Free Agency",
  midseasonFreeAgency: "Free agency in progress",
  midseasonFreeAgencySummary: "Advance to Re-order Depth Chart",
  midseasonDepthChart: "Ready for Week 10",
  playoffs: "Ready to simulate this round",
  endOfSeasonAnnounce: "Continue",
  endOfSeasonWin: "Ready to advance to the offseason",
  endOfSeasonConsolation: "Ready to advance to the offseason",
  offseasonRetirement: "Ready to advance to the draft",
  offseasonDraftPrep: "Ready to advance to the NFL Draft",
  offseasonDraft: "Ready to advance to signings",
  offseasonDraftSummary: "Continue to Rookie Signings",
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
  hoodedFigureEncounter: "Hooded Figure",
  coachingHiring: "Coaching Staff — Hiring Window",
  preseason: "Preseason",
  leagueDevelopments: "League Developments",
  regularSeason: "Regular Season",
  tradeDeadline: "Trade Deadline",
  tradeDeadlineSummary: "Trade Summary",
  midseasonFreeAgency: "Mid-Season Free Agency",
  midseasonFreeAgencySummary: "Mid-Season Free Agency Summary",
  midseasonDepthChart: "Depth Chart",
  playoffs: "Playoffs",
  endOfSeasonAnnounce: "Season Complete",
  endOfSeasonWin: "Season Complete",
  endOfSeasonConsolation: "Season Complete",
  offseasonRetirement: "Retirement Review",
  offseasonDraftPrep: "Draft Preview",
  offseasonDraft: "NFL Draft",
  offseasonDraftSummary: "Rookie Draft Summary",
  offseasonSignings: "Rookie Signings",
  offseasonFreeAgency: "Free Agency",
  offseasonDepthChart: "Depth Chart",
};

/**
 * The screens a GM steps through inside one stage (see `stepOf`). Their
 * current screen is the step's, not the stage's: the rail used to send a
 * GM who had moved on to the draft preview back to the retirement list.
 */
const STEPS: Partial<Record<Stage, Record<string, { route: string; label: string }>>> = {
  offseasonRetirement: { draftPreview: { route: "/draft-preview", label: "Draft Preview" } },
  offseasonDraftSummary: { rookieSignings: { route: "/rookie-signings", label: "Rookie Signings" } },
  trainingCamp: { trainingCampResults: { route: "/training-camp-results", label: "Training Camp Results" } },
};

/** Where this GM's current screen is, and what to call it. */
export function currentScreen(stage: Stage, step: string | null): { route: string; label: string } {
  const at = step ? STEPS[stage]?.[step] : undefined;
  return at ?? { route: STAGE_HOME[stage], label: STAGE_LABEL[stage] };
}

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
      // Only when a human team is eligible. Otherwise every GM, every
      // season, pressed ready on an empty "Nothing unusual this year" screen
      // — one more gate for the whole league to wait on. Eligibility (the
      // league's losing human franchise two seasons running) is already
      // public in the standings, so skipping gives nothing away. The stage's
      // entry housekeeping runs on the depth chart instead.
      return state.gms.some((g) => g.isHuman && g.teamCode && isHoodedFigureEligible(state, g.teamCode))
        ? { stage: "hoodedFigureEncounter", week: 0 }
        : { stage: "offseasonDepthChart", week: 0 };
    // The catch-up mechanic's offer, resolved (or auto-skipped for a GM who
    // isn't eligible this season) before the depth chart re-order — always
    // before preseason simulation, per the mechanic's own timing rule.
    case "hoodedFigureEncounter":
      return { stage: "offseasonDepthChart", week: 0 };
    // Kept only so a league that was already sitting in the old timed hiring
    // window when this shipped has somewhere to go. Nothing routes into it.
    case "coachingHiring":
      return { stage: "preseason", week: 1 };

    case "preseason":
      return week < seasonShape(state).preseasonWeeks
        ? { stage: "preseason", week: week + 1 }
        : // the reveal only when there is something to reveal
          leagueDevelopmentsFor(state).length > 0
          ? { stage: "leagueDevelopments", week }
          : { stage: "regularSeason", week: 1, resetStats: true };
    // The league-wide reveal of this season's hooded-figure consequences,
    // shown once preseason has actually been simulated — never before.
    case "leagueDevelopments":
      return { stage: "regularSeason", week: 1, resetStats: true };

    case "regularSeason":
      // Changes 7 and 8: the season stops at the deadline on the way past
      // week 9, and only once. `tradeDeadline` being non-null is what says
      // the league has already been through it this year — the week alone
      // cannot say so, since the stage is `regularSeason` on both sides.
      //
      // "On the way past" means once the weeks before it have been played.
      // Online they all have been the moment the stage opens — the first
      // block is simulated on arrival and `state.week` deliberately stays at
      // 1 — so the first readiness gate is the right time. Locally the season
      // is played a week at a time, and checking the week number alone sent
      // the league to the deadline straight after week 1: weeks 2 to 9 were
      // never played, and every team reached the deadline 1-0 or 0-1.
      //
      // Online resolves an in-season transition against the block's last
      // week (`inSeasonTransition` in online/src/phases.ts), so it arrives
      // here at the deadline week itself; locally the league arrives there
      // after playing it. Either way it is the deadline week, or a block that
      // has already been played through, that opens the deadline.
      if (
        week <= seasonShape(state).deadlineWeek &&
        !state.tradeDeadline &&
        (week >= seasonShape(state).deadlineWeek || firstBlockPlayed(state, seasonShape(state).deadlineWeek))
      ) {
        return { stage: "tradeDeadline", week: seasonShape(state).deadlineWeek };
      }
      return week < seasonShape(state).regularSeasonWeeks
        ? { stage: "regularSeason", week: week + 1 }
        : { stage: "playoffs", week: 0 };

    case "tradeDeadline":
      return { stage: "tradeDeadlineSummary", week: seasonShape(state).deadlineWeek };
    case "tradeDeadlineSummary":
      return { stage: "midseasonFreeAgency", week: seasonShape(state).deadlineWeek };
    case "midseasonFreeAgency":
      return { stage: "midseasonFreeAgencySummary", week: seasonShape(state).deadlineWeek };
    case "midseasonFreeAgencySummary":
      return { stage: "midseasonDepthChart", week: seasonShape(state).deadlineWeek };
    case "midseasonDepthChart":
      return { stage: "regularSeason", week: seasonShape(state).deadlineWeek + 1 };

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

    // Straight to the draft: the draft preview is the second step of the
    // retirement stage now (Change 12), and routing through
    // `offseasonDraftPrep` showed every GM the same preview twice, with a
    // ready-up on each. The prep stage remains only for leagues already in it.
    case "offseasonRetirement":
      return { stage: "offseasonDraft", week: 0 };
    case "offseasonDraftPrep":
      return { stage: "offseasonDraft", week: 0 };
    case "offseasonDraft":
      return { stage: "offseasonDraftSummary", week: 0 };
    // Change 13: the summary and rookie signings are one stage and two
    // per-GM steps, like the retirement review and the draft preview — a GM
    // crosses between them alone, and the league only gathers again at free
    // agency. See `stepOf` in state/reveal.
    case "offseasonDraftSummary":
      return { stage: "freeAgency", week: 0 };
    // Change 13: signings lead into annual free agency rather than straight
    // to the depth chart. From free agency onward the circuit is the one
    // Changes 4 and 5 already built, which is why it rejoins it here.
    case "offseasonSignings":
      return { stage: "freeAgency", week: 0 };
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

/** Whether every scheduled regular-season game up to `lastWeek` has a result. */
function firstBlockPlayed(state: LeagueState, lastWeek: number): boolean {
  const scheduled = state.schedule.filter((g) => g.phase === "REG" && g.week <= lastWeek).length;
  const played = state.games.filter((g) => g.phase === "REG" && g.played && g.week <= lastWeek).length;
  return played >= scheduled;
}

/**
 * The stages that get a team ready for a season rather than play one.
 *
 * `state.season` only turns over on the way into the preseason, so while a
 * league is in any of these it still holds the *previous* year — a new league
 * drafted in "2026" and then played 2027, and every later draft was labelled
 * with the season it followed rather than the one it fed. By NFL convention
 * the draft, free agency and camp before the 2027 season are all 2027's.
 */
const PREPARING_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "setup",
  "fantasyDraft",
  "fantasyDraftSummary",
  "coachingDraft",
  "coachingDraftSummary",
  "freeAgency",
  "freeAgencySummary",
  "trainingCamp",
  "trainingCampResults",
  "hoodedFigureEncounter",
  "coachingHiring",
  "offseasonRetirement",
  "offseasonDraftPrep",
  "offseasonDraft",
  "offseasonDraftSummary",
  "offseasonSignings",
  "offseasonFreeAgency",
  "offseasonDepthChart",
]);

/**
 * The year a screen should show: the season being prepared for during the
 * offseason, the season being played otherwise. Display only — every rule
 * keyed on `state.season` (contracts, pick years, aging, the Hooded Figure)
 * keeps using the real value.
 */
export function displaySeasonFor(season: number, stage: Stage): number {
  return PREPARING_STAGES.has(stage) ? season + 1 : season;
}

export function displaySeason(s: Pick<LeagueState, "season" | "stage">): number {
  return displaySeasonFor(s.season, s.stage);
}
