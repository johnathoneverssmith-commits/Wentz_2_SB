/**
 * The single seam between the UI and the simulation.
 *
 * Implemented by `MockSimulationService` (seeded, in-browser, plausible) and by
 * `HybridSimulationService` — the one the store actually uses — which real-backs
 * whatever the engine genuinely supports today (schedule, game simulation +
 * the gamecast broadcast view, real rosters, scheme-fit) via `HttpSimulationService`
 * talking to the Node adapter in `nfl-franchise-sim/server/`, falling back to
 * `MockSimulationService` if that adapter isn't reachable. The rest (coach
 * market, draft classes, trade valuation, retirement, and the playoff bracket —
 * no calibrated engine model yet, see `ui-source/NOTES.md`) stays on Mock.
 *
 * `generateInitialPool`, `generateSchedule` and `simulateWeek` are the three
 * genuinely engine-backed methods, so they're the three that are async here
 * (an HTTP round-trip); everything else stays synchronous.
 */
import type {
  BracketState,
  Coach,
  DraftProspect,
  GameResult,
  LeagueState,
  Player,
  PlayoffRound,
  ScheduledGame,
  SeasonOutcome,
  TradeAsset,
} from "@/domain";

export interface TradeEvaluation {
  valueDelta: number;
  acceptLikelihood: number;
}

export interface RetirementOutcome {
  playerId: string;
  decision: "retiring" | "returning";
  /** short human-readable rationale (age vs position norm, injury history). */
  reason: string;
}

export interface SimulationService {
  /** Build a schema-valid initial player pool (fantasy-draft pool or real rosters). */
  generateInitialPool(seed: number, mode: "fantasyPool" | "realRosters"): Player[] | Promise<Player[]>;

  /** Coaches available on the market at league start. */
  generateCoachMarket(seed: number): Coach[];

  /** 18-week regular-season schedule + a 3-week preseason (spec §6.1/§6.7). */
  generateSchedule(seed: number, teamCodes: string[]): ScheduledGame[] | Promise<ScheduledGame[]>;

  /** A rookie draft class (spec §6.5). */
  generateDraftClass(seed: number, year: number): DraftProspect[];

  /** Sim every game for `week` in the given phase; returns fully-populated results. */
  simulateWeek(
    state: LeagueState,
    week: number,
    phase: "PRE" | "REG",
  ): GameResult[] | Promise<GameResult[]>;

  /** Play one playoff round, returning the updated bracket. */
  simulatePlayoffRound(state: LeagueState, round: PlayoffRound): BracketState;

  /** Seed the bracket from final regular-season standings (7 per conference). */
  seedBracket(state: LeagueState): BracketState;

  /** AI evaluation of a proposed trade (spec §6.8). */
  evaluateTrade(
    state: LeagueState,
    fromTeam: string,
    toTeam: string,
    fromAssets: TradeAsset[],
    toAssets: TradeAsset[],
  ): TradeEvaluation;

  /** Scheme-fit value 0–99 for a player against a team's current OC/DC. */
  computeSchemeFit(player: Player, oc: Coach | null, dc: Coach | null): number;

  /** Retire/return outcomes for a team's (or the league's) players (spec §4.9.1). */
  retirementOutcomes(seed: number, players: Player[]): RetirementOutcome[];

  /** Per-GM season outcome rows once a season completes (spec §6.11). */
  finalizeSeasonOutcomes(state: LeagueState): SeasonOutcome[];
}
