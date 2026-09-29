import type { BracketState } from "./bracket.ts";
import type { Coach } from "./coach.ts";
import type { DraftProspect, DraftState, DraftPickAsset } from "./draft.ts";
import type { GameResult, ScheduledGame } from "./game.ts";
import type { HoodedFigureLeagueState } from "./hoodedFigure.ts";
import type { Player } from "./player.ts";
import type { PlayerStatLine, Position } from "./player.ts";
import type { TeamState } from "./team.ts";

/**
 * The annual-cycle stages. Every transition between stages is a readiness gate:
 * it fires when all human GMs are ready, or when the configured stage deadline
 * passes — except `endOfSeasonAnnounce`, which any GM clicks past on their own.
 *
 * Offseason order (per user revision): retirement → draft prep → draft → rookie
 * signings → free agency → depth chart → next preseason.
 */
export type Stage =
  | "setup"
  | "fantasyDraft"
  | "fantasyDraftSummary"
  | "coachingDraft"
  | "coachingDraftSummary"
  | "freeAgency"
  | "freeAgencySummary"
  | "trainingCamp"
  | "trainingCampResults"
  | "hoodedFigureEncounter" // per-GM: the catch-up mechanic offer, only shown to eligible losers
  | "coachingHiring" // 5-day coach free-agency period (0 coaches to start)
  | "preseason"
  | "leagueDevelopments" // league-wide post-preseason reveal of the season's hooded-figure consequences
  | "regularSeason"
  | "tradeDeadline" // three rounds of turns, between weeks 9 and 10
  | "tradeDeadlineSummary"
  | "midseasonFreeAgency" // Change 9: the same five-round market, at midseason
  | "midseasonFreeAgencySummary"
  | "midseasonDepthChart"
  | "playoffs"
  | "endOfSeasonAnnounce" // "END OF {year} SEASON" — click past, no gate
  | "endOfSeasonWin" // Super Bowl champion screen (tabs: this season / score tracker)
  | "endOfSeasonConsolation" // furthest-advanced screen (same tabs)
  | "offseasonRetirement"
  | "offseasonDraftPrep"
  | "offseasonDraft"
  | "offseasonDraftSummary" // Change 13: how round one went, before signings
  | "offseasonSignings"
  | "offseasonFreeAgency" // 5-day, starts on Day 1
  | "offseasonDepthChart"; // re-order depth chart, then next preseason

export type DeadlineChoice = 2 | 6 | 12 | 24 | 48;
/**
 * AI decision-quality level (07_AI_DIFFICULTY_SYSTEM_V1.md) — how competently
 * CPU GMs pursue their goals, never a rules/rating/cap change. See
 * `ui-source/src/state/aiDifficulty.ts` for the profile this drives.
 */
export type Difficulty = "casual" | "standard" | "competitive" | "expert" | "master";

export interface LeagueConfig {
  humanGmCount: number;
  fantasyDraft: boolean;
  draftOrder: "randomized" | "inOrder";
  draftType: "snake" | "linear";
  /**
   * How many picks each human GM makes by hand before the rest of the fantasy
   * draft completes itself. `null` means never — the whole draft is manual.
   *
   * Chosen by the commissioner at league creation and locked once the draft
   * begins, because changing it mid-draft would change how many picks some
   * GMs had already been asked for.
   */
  draftSimulateAfterPicks: number | null;
  /**
   * How many rounds the fantasy draft runs — i.e. how many players each team
   * ends up drafting before `fillRosterGaps` tops the roster up to 53.
   *
   * The rookie draft is not configurable: it is seven rounds because that is
   * what the NFL's is, and its picks are tradeable assets keyed to rounds.
   */
  fantasyDraftRounds: number;
  gameDayDeadlineHours: DeadlineChoice;
  offseasonStageDeadlineHours: DeadlineChoice;
  /** how well the AI GMs optimise their roster / game decisions. */
  difficulty: Difficulty;
  /**
   * `nfl` (all 32 franchises) or `humansOnly` (just the GMs' teams, padded to
   * an even count of at least four, playing a round robin) — see
   * `state/leagueFormat.ts`. Optional so a save from before it existed reads
   * as `nfl`.
   */
  leagueFormat?: "nfl" | "humansOnly";
  /**
   * How hard players' ratings swing games — `state/talentImpact.ts`.
   * Optional so a save from before it existed plays as it always did
   * (`realistic`, the validated engine).
   */
  talentImpact?: "realistic" | "amplified" | "extreme";
}

export interface Gm {
  id: string;
  name: string;
  isHuman: boolean;
  /** The one team this GM controls. Empty until picked in setup. */
  teamCode: string;
}

/** A single negotiated contract offer (players and coaches share the shape). */
export interface ContractOffer {
  teamCode: string;
  /** $M per year. */
  baseSalary: number;
  /** $M, one-time. */
  signingBonus: number;
  years: number;
  /** $M of the total that is guaranteed. */
  guaranteed: number;
}

/** What a free agent cares about, surfaced in the negotiation popup. */
export interface FreePriorities {
  /** ranked tags, most important first, e.g. ["salary", "winning", "starting"]. */
  ranked: string[];
  /** the player's opening expectation for a fair deal (the negotiation default). */
  expectation: { baseSalary: number; signingBonus: number; years: number; guaranteed: number };
}

/**
 * Bidding / negotiation state — used for the offseason player FA period AND the
 * initial coaching-hire period (`subject` says which).
 */
export interface FreeAgencyState {
  subject: "players" | "coaches";
  mode: "main" | "standing";
  /** main only: current in-game day, 1–5. */
  day: number;
  /** main only: seconds left on the 12:00 → 0:00 clock. */
  secondsRemaining: number;
  /** true while the "Day N" interstitial is blocking the board. */
  interstitialVisible: boolean;
  /** subject id (player id or coach id) → offers. */
  bids: Record<string, ContractOffer[]>;
  /** subject ids signed, in order. */
  signed: Array<{
    id: string;
    toTeam: string;
    baseSalary: number;
    signingBonus: number;
    years: number;
    guaranteed: number;
    at: number;
  }>;
}

export interface TradeAsset {
  kind: "player" | "pick";
  playerId?: string;
  pick?: DraftPickAsset;
}

export interface TradeProposal {
  id: string;
  fromTeam: string;
  toTeam: string;
  fromAssets: TradeAsset[];
  toAssets: TradeAsset[];
  aiValueDelta: number;
  aiAcceptLikelihood: number;
  vote?: {
    required: true;
    votes: Record<string, "for" | "against" | null>;
    outcome: "pending" | "passed" | "blocked";
  };
  /** `offered` is one the AI made *to* a human GM, waiting on their answer. */
  status: "draft" | "offered" | "pending" | "accepted" | "rejected" | "blocked" | "withdrawn";
  /** Why a trade was refused on cap or roster grounds, rather than on value. */
  blockedReason?: string;
}

export interface SeasonOutcome {
  season: number;
  gmId: string;
  teamCode: string;
  madePlayoffs: boolean;
  seed: number;
  furthestRound: "none" | "WC" | "DIV" | "CONF" | "SB";
  wonSuperBowl: boolean;
  regularSeasonRecord: { wins: number; losses: number; ties: number };
  eliminationMargin: number | null;
  pointDifferential: number;
  rivalsEliminated: string[];
}

/** A just-simulated week/round, held so the Game Day screen can show it. */
export interface PendingGameDay {
  phase: "PRE" | "REG" | "WC" | "DIV" | "CONF" | "SB";
  week: number;
  gameIds: string[];
  /** the viewer's game this slate, if any. */
  viewerGameId: string | null;
}

import type { CoachingDraftState } from "@/state/coachingDraft";
import type { FreeAgencyEventState } from "@/state/freeAgencyEvent";
import type { TrainingCampState } from "@/state/trainingCamp";
import type { TradeDeadlineState } from "@/state/tradeDeadline";
import type { RevealState } from "@/state/reveal";

export interface LeagueState {
  schemaVersion: number;
  season: number;
  stage: Stage;
  week: number;

  config: LeagueConfig;
  gms: Gm[];
  viewerGmId: string;

  teams: Record<string, TeamState>;
  players: Record<string, Player>;
  coaches: Record<string, Coach>;

  schedule: ScheduledGame[];
  games: GameResult[];

  draftClass: DraftProspect[];
  draft: DraftState | null;
  /** The twelve-round staff draft. Null until the coaching stage opens. */
  coachingDraft: CoachingDraftState | null;
  /** The five-round turn-based free-agency market. */
  freeAgencyEvent: FreeAgencyEventState | null;
  /** Per-team camp plans and their saved results. */
  trainingCamp: TrainingCampState | null;
  /** The three-round turn-based deadline. Null until the stage opens. */
  tradeDeadline: TradeDeadlineState | null;
  /** How far each GM has watched. Precomputed blocks are revealed, not played. */
  reveal: RevealState | null;
  /** rookie prospect id → whether the viewer's team signed or released them. */
  rookieOutcomes: Record<string, "signed" | "released">;
  /** offseason player FA period. */
  freeAgency: FreeAgencyState | null;
  /** persistent in-season FA market (open from the hub). */
  standingFreeAgents: string[];
  /**
   * Per-team depth chart: position -> player ids, best first. Only positions
   * the GM has actually reordered appear; everything else falls back to
   * overall. This is the one place a GM's lineup preference is recorded, so
   * it has to outlive the screen that sets it.
   */
  depthChart: Record<string, Partial<Record<Position, string[]>>>;
  /**
   * Every tradeable draft pick, keyed `year-round-originalTeam`. Covers this
   * draft and the next two, the same horizon the real rule allows.
   */
  draftPicks: Record<string, DraftPickAsset>;
  /** initial coaching-hire period. */
  coachingHire: FreeAgencyState | null;
  bracket: BracketState | null;
  trades: TradeProposal[];

  readiness: Record<string, boolean>;
  stageDeadlineAt: null | number;

  /** set after a week/round sims; the Game Day screen consumes it. */
  pendingGameDay: PendingGameDay | null;
  /** where a "return to …" link should go (e.g. "/retirement"); null = team hub. */
  returnTo: string | null;

  history: SeasonOutcome[];
  /** Each position's starter quality when the league began (`draftSupply.ts`). */
  positionBaseline?: Partial<Record<Position, number>>;
  /**
   * Online only, never sent to a client: each week of the current block's
   * stat lines, so a GM is shown the season as of the week they've watched
   * (`rewindSeasonStats`).
   */
  statLedger?: Record<number, Record<string, PlayerStatLine>>;
  /** Server-only: the injury report at the start of the current block (`rewindInjuries`). */
  injuryLedger?: import("@/state/injuries").InjuryLedger;
  /** Accumulated offset of each position from its baseline (`agingBalance`). */
  agingIntegral?: Partial<Record<Position, number>>;
  /** The season whose offsets were last banked into `agingIntegral`. */
  agingIntegralSeason?: number;
  /** Year one of a fantasy league: rosters fill to 53 after free agency closes. */
  rosterFillPending?: boolean;
  /**
   * Each GM's starred prospects for the coming draft, private to that GM.
   * League-level, not on `draft`: the preview happens before the draft
   * exists, and stars put on last year's draft object vanished when the new
   * one began.
   */
  draftTargets?: Record<string, string[]>;
  /** This league's scoring correction for the engine (`scoringCommittee`). */
  offenseAdjust?: number;
  /** The last season whose accrued years were credited (`accrueCareers`). */
  accruedSeason?: number;
  /** Every champion and runner-up (`seasonAwards.recordSeason`). */
  champions?: import("@/state/seasonAwards").ChampionRow[];
  /** The league's single-season records. */
  records?: import("@/state/seasonAwards").RecordRow[];
  /** All-Pro first teams, the last ten seasons. */
  allPro?: import("@/state/seasonAwards").AllProRow[];
  /** Every team's season record and finish (`recordSeason`). */
  teamSeasons?: import("@/state/seasonAwards").TeamSeasonRow[];
  /** Inducted as they retire (`inductHallOfFame`). */
  hallOfFame?: import("@/state/seasonAwards").HallOfFamer[];
  /** Every season's award winners (`seasonAwards.ts`). */
  awards?: import("@/state/seasonAwards").SeasonAward[];
  /** CPU coaching changes, the last three offseasons (`coachingCarousel.ts`). */
  coachingChanges?: import("@/state/coachingCarousel").CoachingChange[];
  /** Hooded Figure catch-up mechanic state. Null until first needed. */
  hoodedFigure: HoodedFigureLeagueState | null;
}
