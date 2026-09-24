/**
 * The one league store: LeagueState + actions. immer-backed.
 *
 * Flow model (post-revision):
 * - `tryAdvance()` applies a *stage* transition once every human GM is ready.
 * - In-season, the hub/bracket readiness gate calls `simulateGameDay()` instead:
 *   it sims the current week/round, stores `pendingGameDay`, and routes to the
 *   Game Day screen. `finishGameDay()` then steps the week / advances the stage.
 * - Non-viewer human GMs are ready by default; the gate only waits on the viewer.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  ROUND_ORDER,
  bracketRounds,
  type ContractOffer,
  type DraftMode,
  type LeagueConfig,
  type LeagueState,
  type Player,
  type Position,
  type TradeAsset,
} from "@/domain";
import { TEAMS } from "@/data/teams";
import { HybridSimulationService } from "@/sim/HybridSimulationService";

import {
  applySeasonAging,
  createLeague,
  fillRosterGaps,
  forgetOldRetirees,
  normalizePool,
  pruneFreeAgentMarket,
  recomputeTeamRatings,
  releaseToMarket,
  trimRosters,
} from "./seed.ts";
import {
  PRESEASON_WEEKS,
  REGULAR_SEASON_WEEKS,
  resolveTransition,
  STAGE_HOME,
} from "./stageMachine.ts";
import {
  type ContractMoveResult,
  extendContract,
  restructureContract,
} from "./contracts.ts";
import { ensureDraftPicks, forgetSpentPicks } from "./draftPicks.ts";
import { formHumansOnlyLeague, humansOnlySchedule, isHumansOnly } from "./leagueFormat.ts";
import { CURRENT_SAVE_VERSION, migrateLeagueSave } from "./saveMigration.ts";
import {
  applyCoachingPick,
  beginCoachingDraft,
  checkCoachingPick,
  coachingDraftComplete,
  runAiCoachingPicks,
} from "./coachingDraft.ts";
import {
  applyOffer,
  applyPass,
  beginFreeAgencyEvent,
  checkOffer,
  runCpuTurns as runFreeAgencyCpuTurns,
} from "./freeAgencyEvent.ts";
import {
  checkCampSubmission,
  openTrainingCamp,
  runTrainingCamp,
  type TrainingCampPlan,
} from "./trainingCamp.ts";
import {
  beginTradeDeadline,
  proposeAtDeadline,
  respondAtDeadline,
  runCpuTurns as runDeadlineTurns,
  skipTurn,
  type DeadlineMove,
} from "./tradeDeadline.ts";
import { markRevealed, markRoundRevealed, markStep, revealedRounds } from "./reveal.ts";
import {
  checkHoodedFigurePayment,
  ensureHoodedFigureEncounters,
  hoodedFigureEncounterFor,
  resolveHoodedFigureEncounter,
} from "./hoodedFigure.ts";
import { generateAiTradeOffers } from "./aiTrades.ts";
import { reconcileCpuTeam } from "./reconciliation.ts";
import { applyInjuries, clearInjuries, healOneWeek } from "./injuries.ts";
import {
  accrueSeasonStats,
  recomputeStandings,
  resetSeasonStats,
} from "./standings.ts";
import {
  applyPick,
  applyTrade,
  checkBid,
  checkStandingSign,
  checkCoachHire,
  checkRookieOutcome,
  applyRookieOutcome,
  applyCoachHire,
  checkTrade,
  clearReadiness,
  commitRetirements,
  completeDraft,
  draftThresholdMet,
  faField,
  finalizeSeason,
  humanGate,
  offerToContract,
  openStandingMarketFromUndrafted,
  planAutopicks,
  runAiPicks,
  sbWonByHuman,
  advanceBiddingDayOn,
  beginBidding,
  beginDraft,
  signAiDraftPicks,
  signUndraftedAsFreeAgents,
  type Subject,
} from "./rules.ts";

// the rules live in `rules.ts` so a server can enforce them too; everything
// the app used to import from here still comes from here
export * from "./rules.ts";
export { PRESEASON_WEEKS, REGULAR_SEASON_WEEKS, ROUND_ORDER };

const sim = new HybridSimulationService();

export interface StoreActions {
  /** builds the league instantly (Mock skeleton), then upgrades players/schedule to
   *  real engine data in the background if the adapter is reachable. */
  newLeague: (seed?: number, config?: LeagueConfig) => Promise<void>;
  setConfig: (partial: Partial<LeagueConfig>) => void;
  pickTeam: (gmId: string, teamCode: string) => void;
  setReady: (gmId: string, ready: boolean) => void;
  autoReadyNonViewers: () => void;
  tryAdvance: () => Promise<{ moved: boolean; route: string }>;

  /** in-season: sim this week / round and stage the Game Day screen. */
  simulateGameDay: () => Promise<{ route: string }>;
  /** Game Day "continue": step the week or advance the stage. */
  finishGameDay: () => Promise<{ route: string }>;

  setReturnTo: (path: string | null) => void;

  startDraft: (mode: DraftMode) => void;
  makePick: (selectedId: string) => void;
  autopickRemaining: () => void;
  toggleDraftTarget: (gmId: string, id: string) => void;

  startBidding: (subject: Subject) => void;
  /** Place/replace this team's bid in the live window. Rejects (changing
   *  nothing) when the offer plus the team's other open bids wouldn't fit
   *  under the cap — see `checkBid`. */
  placeOffer: (subject: Subject, id: string, offer: ContractOffer) => { ok: boolean; reason?: string };
  advanceBiddingDay: (subject: Subject) => void;
  dismissInterstitial: (subject: Subject) => void;

  /** in-season standing FA market: sign a free agent immediately. Rejects
   * (without mutating anything) if the offer's year-1 cap hit doesn't fit
   * the signing team's remaining cap room. */
  signStandingFreeAgent: (playerId: string, offer: ContractOffer) => { ok: boolean; reason?: string };

  /** Reveal saved results through a week. Never simulates. */
  revealThrough: (through: number) => { ok: boolean; reason?: string };
  /** Run this team's training camp. */
  submitTrainingCamp: (plan: TrainingCampPlan) => { ok: boolean; reason?: string };
  /** Commit a hooded-figure payment (0 = decline) and resolve it immediately. */
  submitHoodedFigurePayment: (payment: number) => { ok: boolean; reason?: string };
  /** One trade-deadline turn: propose, skip, accept, deny or counter. */
  deadlineTurn: (move: DeadlineMove) => { ok: boolean; reason?: string };
  /** Reveal the next playoff round to the viewing GM. */
  revealRound: () => { ok: boolean; reason?: string };
  /** Move the viewing GM to the next screen inside this stage. */
  stepForward: (step: string) => { ok: boolean; reason?: string };
  /** One free-agency turn: an offer, or a pass. */
  freeAgencyTurn: (move: {
    playerId?: string;
    salary?: number;
    years?: number;
    pass?: boolean;
  }) => { ok: boolean; reason?: string };
  /** Take a coach in the coaching fantasy draft. */
  draftCoach: (coachId: string) => { ok: boolean; reason?: string };
  /** Hire an out-of-work coach into his role, replacing whoever holds it. */
  hireCoach: (coachId: string) => { ok: boolean; reason?: string };
  signRookie: (prospectId: string, teamCode: string) => void;
  releaseRookie: (prospectId: string, teamCode: string) => void;

  /** Record the GM's depth order at one position. Ids are best-first;
   *  anyone left out falls in behind by overall. */
  setDepthOrder: (teamCode: string, position: Position, playerIds: string[]) => void;

  /** Convert base salary to prorated bonus: cheaper now, dearer later. */
  restructurePlayer: (playerId: string) => ContractMoveResult;
  /** Add years to a deal at a newly negotiated rate. */
  extendPlayer: (
    playerId: string,
    offer: { baseSalary: number; years: number; guaranteed: number },
  ) => ContractMoveResult;

  /** Cut a player from the roster. He goes straight onto the standing free
   *  agent market and his whole cap hit comes off the books — see
   *  `releaseToMarket` for why no dead money is charged. */
  releasePlayer: (playerId: string) => void;

  proposeTrade: (toTeam: string, fromPlayerIds: string[], toPlayerIds: string[]) => string;
  /** Answer an offer the league made you. */
  respondToOffer: (tradeId: string, accept: boolean) => { ok: boolean; reason?: string };
  castTradeVote: (tradeId: string, gmId: string, vote: "for" | "against") => void;
  resolveTrade: (tradeId: string) => void;
}

export type Store = LeagueState & StoreActions;

/**
 * Whether the last attempt to write the save failed (localStorage full, or
 * disabled entirely — a private window blocks it). The shell watches this so
 * the player is told rather than losing a dynasty silently.
 */
let saveBroken = false;
const saveWatchers = new Set<(broken: boolean) => void>();
function notifySaveState(): void {
  for (const fn of saveWatchers) fn(saveBroken);
}
export function onSaveStateChange(fn: (broken: boolean) => void): () => void {
  saveWatchers.add(fn);
  fn(saveBroken);
  return () => saveWatchers.delete(fn);
}

const SAVE_KEY = "nfl-sim-ui.league";
/** Where a save that failed to parse is copied before anything can overwrite it. */
const CORRUPT_BACKUP_KEY = `${SAVE_KEY}.corrupted-backup`;

/**
 * Whether the save on this device exists but could not be read back — bad
 * JSON, most likely from a browser crash mid-write or a hand-edited value.
 *
 * Loading a save must never fail silently: without this, `persist` swallows
 * the parse error, hydrates the store from its own fresh initial state, and
 * says nothing — a dynasty that looked lost only *looked* lost, right up
 * until the next autosave, which would have quietly overwritten the one copy
 * of it that still existed with that fresh empty state. `onRehydrateStorage`
 * below backs the raw string up to `CORRUPT_BACKUP_KEY` the moment the parse
 * fails, before any further write can touch it, and the shell surfaces this
 * flag instead of pretending the fresh state the player is now looking at
 * was always what was there.
 */
let saveCorrupted = false;
/** Team codes a person is actually playing, for the CPU sweeps to stop on. */
function humanTeamsOf(s: LeagueState): Set<string> {
  return new Set(s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
}

/**
 * Everything a stage does on the way in, in one place.
 *
 * There are two ways the league changes stage — `tryAdvance` for the gated
 * offseason stages, `finishGameDay` for the in-season ones — and they used
 * to carry different halves of this list. Every stage whose screen refuses
 * to work until its own state exists (the coaching draft's board, the
 * deadline's turn order, free agency's five rounds) therefore worked when
 * reached one way and dead-ended when reached the other: the trade deadline
 * is entered from the regular season, i.e. through `finishGameDay`, so a
 * league arrived at week 10 to "The deadline hasn't opened yet" and a screen
 * with no controls on it at all.
 *
 * Online has always had exactly one of these (`phases.ts`'s
 * `onStageEntered`) and does not have the matching bugs. This is that, for
 * the store: both paths call it, so a stage's opening logic cannot depend on
 * which door the league came through.
 */
function applyStageEntry(s: LeagueState, from: string, to: string): void {
  // leaving setup in a humans-only league → the league becomes the GMs' teams
  // plus the fewest CPU teams that make it even; every other franchise goes
  if (from === "setup" && isHumansOnly(s)) formHumansOnlyLeague(s);

  // training camp: this season's camp, and every CPU team runs theirs as it
  // opens (online always did; locally the CPU teams never trained at all)
  if (to === "trainingCamp") openTrainingCamp(s, humanTeamsOf(s));

  // leaving the fantasy draft → undrafted players seed the standing FA
  // market, then every team is brought up to a full 53 (20 rounds only
  // hands each team 20 players)
  if (from === "fantasyDraft" && to === "fantasyDraftSummary") {
    openStandingMarketFromUndrafted(s);
    fillRosterGaps(s);
  }

  // Leaving the draft summary for free agency — which is where the rookie
  // signings step now lives (Change 13). The CPU teams sign their classes
  // and every undrafted prospect goes to the market, before it opens. This
  // used to hang only off the retired `offseasonSignings` stage below, which
  // the league no longer enters: every CPU draft class vanished, every year.
  if (from === "offseasonDraftSummary" && to === "freeAgency") {
    signAiDraftPicks(s);
    signUndraftedAsFreeAgents(s);
  }

  // leaving rookie signings → the AI teams put their own classes under
  // contract, then every roster is cut back to legal before the market
  // opens. Without it the AI never signs its draft class and nobody trims,
  // and every team walks into the next season over the cap and the limit.
  if (from === "offseasonSignings" && to === "offseasonDepthChart") {
    signAiDraftPicks(s);
    trimRosters(s);
  }

  // Hard stop before the season: free agency is optional, so a team can
  // reach this point still short. Nobody takes the field without a full,
  // position-legal roster.
  if (to === "preseason") fillRosterGaps(s);

  // The league goes shopping at the two moments it would: the day the
  // season ends, and the week of the deadline. Seeded on the stage, so an
  // offer can't be rerolled by bouncing off the screen.
  if (to === "offseasonRetirement" || to === "offseasonDepthChart") {
    const fresh = generateAiTradeOffers(s, to === "offseasonRetirement" ? 1 : 2, 1);
    for (const offer of fresh) {
      // never offer a deal the offering team couldn't honour — an AI that
      // proposes something it can't fit under its own cap looks incompetent,
      // and it wastes the GM's decision
      if (!checkTrade(s, offer).ok) continue;
      if (!s.trades.some((x) => x.id === offer.id)) s.trades.push(offer);
    }
  }

  // leaving retirement review → actually retire the players it showed
  if (from === "offseasonRetirement" && to === "offseasonDraftPrep") {
    commitRetirements(s);
  }

  // the catch-up mechanic's offer, generated once per eligible human GM the
  // moment the stage opens — never regenerated on a later visit
  if (to === "hoodedFigureEncounter") ensureHoodedFigureEncounters(s);

  // The cap and the roster limit come back here, and the CPU teams sort
  // themselves out on the way in — the same block online's onStageEntered
  // runs. Solo never did, and a market that deliberately suspends both
  // limits leaves a lot behind: measured at this point in a stock dynasty,
  // 18 of the 31 CPU teams were over the roster limit and 5 over the cap.
  // They stayed that way until the blanket trim much later in the offseason,
  // so in the meantime League Rosters showed illegal squads and those teams
  // could not take a trade, because `checkTrade` reads the same cap.
  if (to === "freeAgencySummary" || to === "midseasonFreeAgencySummary") {
    const humans = humanTeamsOf(s);
    for (const code of Object.keys(s.teams)) {
      if (!humans.has(code)) reconcileCpuTeam(s, code);
    }
  }

  // the twelve-round coaching board opens with the stage; without this
  // `s.coachingDraft` stayed null and the screen sat on "One moment."
  if (to === "coachingDraft" && !s.coachingDraft) {
    beginCoachingDraft(s);
    runAiCoachingPicks(s, humanTeamsOf(s));
  }

  // the deadline builds its order from the week 1-9 standings and runs
  // itself forward until a human is on the clock
  if (to === "tradeDeadline" && !s.tradeDeadline) {
    beginTradeDeadline(s);
    runDeadlineTurns(s);
  }

  // Both five-round markets open with their stage, and the CPU teams ahead
  // of the first human take their turns straight away. The saved event is
  // cleared rather than resumed: each is a different five rounds, with an
  // order recalculated from current roster strength and a pool that has
  // moved on, and reusing the old one would reopen its offers.
  if ((to === "freeAgency" && from !== "freeAgency") || (to === "midseasonFreeAgency" && from !== "midseasonFreeAgency")) {
    s.freeAgencyEvent = null;
    beginFreeAgencyEvent(s);
    runFreeAgencyCpuTurns(s, humanTeamsOf(s));
  }
}

const corruptWatchers = new Set<(corrupted: boolean) => void>();
function notifyCorruptState(): void {
  for (const fn of corruptWatchers) fn(saveCorrupted);
}
export function onSaveCorrupted(fn: (corrupted: boolean) => void): () => void {
  corruptWatchers.add(fn);
  fn(saveCorrupted);
  return () => corruptWatchers.delete(fn);
}

export const useStore = create<Store>()(
  persist(
    immer((set, get) => ({
      ...createLeague(),

      newLeague: async (seed = Date.now() % 100000, config) => {
        // instant, Mock-backed skeleton — always playable, never blocks on the network
        set(() => createLeague(seed, config) as Store);
        try {
          const [pool, schedule, coachList] = await Promise.all([
            sim.generateInitialPool(seed, "realRosters"),
            sim.generateSchedule(seed, TEAMS.map((t) => t.code)),
            sim.generateCoachMarket(seed),
          ]);
          set((s) => {
            // the engine pool arrives unowned and unpaid — see `normalizePool`
            normalizePool(pool, s.config.fantasyDraft, seed);
            const players: Record<string, Player> = {};
            for (const p of pool) players[p.id] = p;
            s.players = players;
            s.standingFreeAgents = pool.filter((p) => p.free_agent).map((p) => p.id);
            // a humans-only league makes its own round robin when setup
            // closes; this NFL slate is only a placeholder until then
            if (!(isHumansOnly(s) && s.stage !== "setup")) s.schedule = schedule;
            const coaches: Store["coaches"] = {};
            for (const c of coachList) {
              c.team = null;
              c.contract = null;
              coaches[c.id] = c;
            }
            s.coaches = coaches;
            recomputeTeamRatings(s);
          });
        } catch (err) {
          // HybridSimulationService already falls back to Mock internally on its
          // own — this only trips on a genuinely unexpected error, and the Mock
          // skeleton set above already leaves the league fully playable.
          // eslint-disable-next-line no-console
          console.error("newLeague: real-data upgrade failed", err);
        }
      },

      setConfig: (partial) =>
        set((s) => {
          Object.assign(s.config, partial);
          // a humans-only league has no NFL rosters to inherit
          if (isHumansOnly(s)) s.config.fantasyDraft = true;
          if (s.stage === "setup" && partial.humanGmCount != null) {
            const fresh = createLeague(1, s.config);
            s.gms = fresh.gms.map((g) => s.gms.find((x) => x.id === g.id) ?? g);
            s.teams = fresh.teams;
            // only humans' teams are human-controlled — the rival GMs are CPU,
            // and `aiControlledTeams` (who bids in the offseason market) reads
            // this; `createLeague` makes the same distinction
            for (const g of s.gms) {
              if (g.isHuman && g.teamCode && s.teams[g.teamCode]) {
                s.teams[g.teamCode]!.controlledBy = { kind: "human", gmId: g.id };
              }
            }
            s.readiness = Object.fromEntries(s.gms.map((g) => [g.id, g.id !== s.viewerGmId]));
          }
        }),

      pickTeam: (gmId, teamCode) =>
        set((s) => {
          for (const code of Object.keys(s.teams)) {
            const c = s.teams[code]!.controlledBy;
            if (c.kind === "human" && c.gmId === gmId) s.teams[code]!.controlledBy = { kind: "ai" };
          }
          const g = s.gms.find((x) => x.id === gmId);
          if (g) g.teamCode = teamCode;
          s.teams[teamCode]!.controlledBy = { kind: "human", gmId };
        }),

      setReady: (gmId, ready) => set((s) => { s.readiness[gmId] = ready; }),

      autoReadyNonViewers: () =>
        set((s) => {
          for (const g of s.gms) if (g.isHuman && g.id !== s.viewerGmId) s.readiness[g.id] = true;
        }),

      setReturnTo: (path) => set((s) => { s.returnTo = path; }),

      tryAdvance: async () => {
        const before = get();
        if (!humanGate(before)) return { moved: false, route: STAGE_HOME[before.stage] };

        // resolved once, ahead of the producer, so the async pieces (a
        // season-rollover's new schedule, seeding the playoff bracket) can be
        // awaited outside it — immer producers must stay synchronous.
        const t = resolveTransition(before, { humanGmWonSuperBowl: sbWonByHuman(before) });
        const newSchedule = t.seasonRollover
          ? isHumansOnly(before)
            ? humansOnlySchedule({ teams: before.teams, season: before.season + 1 })
            : await sim.generateSchedule(before.season + 1, Object.keys(before.teams))
          : null;
        const newBracket =
          t.stage === "playoffs" && !before.bracket ? await sim.seedBracket(before) : null;

        set((s) => {
          if (newBracket && !s.bracket) s.bracket = newBracket;
          if (t.resetStats) resetSeasonStats(s);

          if (t.seasonRollover) {
            finalizeSeason(s);
            s.season += 1;
            s.bracket = null;
            // Last season's deadline has to go with it: the stage machine only
            // opens a deadline when there isn't one, so leaving it here meant
            // every season after the first skipped the trade deadline and the
            // midseason market entirely.
            s.tradeDeadline = null;
            s.games = [];
            s.draft = null;
            s.freeAgency = null;
            s.coachingHire = null;
            s.trades = [];
            s.rookieOutcomes = {};
            s.pendingGameDay = null;
            forgetSpentPicks(s, s.season); // this draft has happened
            ensureDraftPicks(s, s.season); // and two more are now tradeable
            clearInjuries(s); // an offseason outlasts any injury
            pruneFreeAgentMarket(s); // careers that stopped going anywhere end
            forgetOldRetirees(s); // and a save file shouldn't carry them forever
            applySeasonAging(s, s.season); // OQ-4: age + overall/attribute drift for every active player
            fillRosterGaps(s); // nobody starts a season unable to field a legal lineup
            s.draftClass = sim.generateDraftClass(s.season, s.season);
            for (const code of Object.keys(s.teams)) {
              const team = s.teams[code]!;
              team.wins = team.losses = team.ties = 0;
              team.pointsFor = team.pointsAgainst = 0;
              team.playoffSeed = 0;
            }
            s.schedule = newSchedule!;
          }

          applyStageEntry(s, s.stage, t.stage);

          s.stage = t.stage;
          s.week = t.week;
          s.returnTo = null;
          clearReadiness(s);
          s.stageDeadlineAt = null;
          recomputeTeamRatings(s);
        });

        return { moved: true, route: STAGE_HOME[get().stage] };
      },

      simulateGameDay: async () => {
        const before = get();
        // the async pieces (real game sim / real playoff round over HTTP)
        // resolved ahead of the producer, same reasoning as tryAdvance —
        // immer producers stay sync.
        const results =
          before.stage === "preseason" || before.stage === "regularSeason"
            ? await sim.simulateWeek(before, before.week, before.stage === "preseason" ? "PRE" : "REG")
            : null;
        const playoffRoundToPlay = before.stage === "playoffs" ? (before.bracket?.currentRound ?? "WC") : null;
        const newBracket = playoffRoundToPlay
          ? await sim.simulatePlayoffRound(before, playoffRoundToPlay)
          : null;

        set((s) => {
          if (results) {
            const viewerTeam = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode;
            const phase = s.stage === "preseason" ? "PRE" : "REG";
            s.games.push(...results);
            applyInjuries(s, results, s.season);
            if (phase === "REG") {
              accrueSeasonStats(s, results);
              recomputeStandings(s);
            }
            const viewerGame = results.find(
              (g) => g.homeTeam === viewerTeam || g.awayTeam === viewerTeam,
            );
            s.pendingGameDay = {
              phase,
              week: s.week,
              gameIds: results.map((g) => g.id),
              viewerGameId: viewerGame?.id ?? null,
            };
          } else if (newBracket && playoffRoundToPlay) {
            s.bracket = newBracket;
            s.pendingGameDay = {
              phase: playoffRoundToPlay,
              week: 0,
              gameIds: [],
              viewerGameId: null,
            };
          }
          recomputeTeamRatings(s);
        });
        return { route: "/game-day" };
      },

      finishGameDay: async () => {
        const before = get();
        const t = resolveTransition(before, { humanGmWonSuperBowl: sbWonByHuman(before) });
        const newBracket =
          t.stage === "playoffs" && !before.bracket ? await sim.seedBracket(before) : null;

        set((s) => {
          if (newBracket && !s.bracket) s.bracket = newBracket;
          if (t.resetStats) resetSeasonStats(s);
          healOneWeek(s); // a week has passed, so everyone hurt is a week closer
          // the season is scored the moment the playoffs end, so the End-of-Season
          // screens can show this year's row in the tracker.
          if (t.stage === "endOfSeasonAnnounce") finalizeSeason(s);
          // The in-season path changes stage too, and the stages it opens
          // (the trade deadline above all) need their own state built exactly
          // as much as the gated ones do — see `applyStageEntry`.
          applyStageEntry(s, s.stage, t.stage);
          s.stage = t.stage;
          s.week = t.week;
          s.pendingGameDay = null;
          clearReadiness(s);
          recomputeTeamRatings(s);
        });
        return { route: STAGE_HOME[get().stage] };
      },

      // Whoever opens the board, the league plays its own teams up to the
      // first pick a person owes — the same rule online's onStageEntered
      // applies. Without it, a draft that opens on an AI team's pick (any
      // fantasy draft not using "in order" with a human first) sat dead: the
      // old fix for that was a screen-local useEffect that polled every
      // 200ms and picked literal #1 overall, which is also what caused the
      // AI-drafts-by-pure-overall bug — removed along with it.
      startDraft: (mode) =>
        set((s) => {
          beginDraft(s, mode);
          runAiPicks(s);
        }),

      // Mirrors online's decideDraftPick exactly (online/src/decide.ts) —
      // single-player had drifted from it in three ways, all found in the
      // same playtest: the AI's own picks (made by a screen-local `useEffect`
      // that just took literal #1 overall) never went through the need/
      // strategy/difficulty-aware evaluator at all; `draftThresholdMet` and
      // `completeDraft` were defined but never called from here, so the
      // promised "the rest of the board completes itself" never happened;
      // and with no completion, the stage had nothing to advance it into the
      // summary. `runAiPicks` is the same call online makes for the same
      // reason: the clock cannot stop dead on the first AI team after you.
      makePick: (selectedId) =>
        set((s) => {
          if (!s.draft) return;
          applyPick(s, selectedId);
          runAiPicks(s);
          // `draftThresholdMet` covers the early-auto-complete case; a
          // manual draft (threshold null) never trips it, but the board can
          // still finish naturally once the human's own last pick lets
          // `runAiPicks` sweep every remaining (all-AI) slot in one pass —
          // that also has to advance the stage, there's just nothing left
          // for `completeDraft` to do.
          const draft = s.draft;
          const boardDone = draft.currentPickIndex >= draft.pickOrder.length;
          if (draftThresholdMet(s) || boardDone) {
            if (!boardDone) completeDraft(s);
            const t = resolveTransition(s, {});
            applyStageEntry(s, s.stage, t.stage);
            s.stage = t.stage;
            s.week = t.week;
            clearReadiness(s);
          }
        }),

      autopickRemaining: () => {
        // decided outside the producer — see planAutopicks
        const picks = planAutopicks(get());
        if (picks.length === 0) return;
        set((s) => {
          for (const id of picks) {
            if (!s.draft || s.draft.currentPickIndex >= s.draft.pickOrder.length) break;
            applyPick(s, id);
          }
        });
      },

      toggleDraftTarget: (gmId, id) =>
        set((s) => {
          if (!s.draft) return;
          const list = (s.draft.targetsByGm[gmId] ??= []);
          const i = list.indexOf(id);
          if (i >= 0) list.splice(i, 1);
          else list.push(id);
        }),

      startBidding: (subject) => set((s) => beginBidding(s, subject)),

      placeOffer: (subject, id, offer) => {
        const check = checkBid(get(), subject, id, offer);
        if (!check.ok) return check;
        set((s) => {
          const fa = s[faField(subject)];
          if (!fa) return;
          const list = (fa.bids[id] ??= []);
          const mine = list.findIndex((o) => o.teamCode === offer.teamCode);
          if (mine >= 0) list[mine] = offer;
          else list.push(offer);
        });
        return { ok: true };
      },

      advanceBiddingDay: (subject) =>
        set((s) => {
          advanceBiddingDayOn(s, subject);
        }),

      dismissInterstitial: (subject) =>
        set((s) => {
          const fa = s[faField(subject)];
          if (fa) fa.interstitialVisible = false;
        }),

      /**
       * The same deadline rules the server runs, applied locally.
       *
       * Single-player has no server to be authoritative, so the store calls
       * the rules module directly — which is the point of the module existing
       * apart from either. The CPU sweep afterwards is what carries the order
       * on to the viewer's next turn.
       */
      deadlineTurn: (move) => {
        let result: { ok: boolean; reason?: string } = { ok: false, reason: "No team." };
        set((s) => {
          const code = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode;
          if (!code) return;
          const give = (ids: string[]) =>
            ids.map((id) =>
              id.startsWith("pick:")
                ? { kind: "pick" as const, pick: s.draftPicks[id.slice(5)] }
                : { kind: "player" as const, playerId: id },
            );
          switch (move.kind) {
            case "propose":
              result = proposeAtDeadline(s, code, move.toTeam, give(move.give), give(move.get));
              break;
            case "skip":
              result = skipTurn(s, code);
              break;
            case "modify":
              result = respondAtDeadline(s, code, {
                kind: "modify",
                fromAssets: give(move.proposerGives),
                toAssets: give(move.proposerGets),
              });
              break;
            default:
              result = respondAtDeadline(s, code, { kind: move.kind });
          }
          if (result.ok) {
            runDeadlineTurns(s);
            // three rounds and tradeDeadline.ts marks itself `done`, but
            // nothing read that flag — a league that finished round three
            // had no further turns and no way off the stage (playtest
            // finding 16), the same gap online's decideDeadlineTurn had.
            if (s.tradeDeadline?.done) {
              const t = resolveTransition(s, {});
              applyStageEntry(s, s.stage, t.stage);
              s.stage = t.stage;
              s.week = t.week;
              clearReadiness(s);
            }
          }
        });
        return result;
      },

      stepForward: (step) => {
        set((s) => markStep(s, s.viewerGmId, step));
        return { ok: true };
      },

      revealRound: () => {
        let result: { ok: boolean; reason?: string } = { ok: false, reason: "Nothing to reveal." };
        set((s) => {
          const seen = revealedRounds(s, s.viewerGmId);
          const next = (s.bracket ? bracketRounds(s.bracket) : ROUND_ORDER).find((r) => !seen.includes(r));
          if (!next) return;
          markRoundRevealed(s, s.viewerGmId, next);
          result = { ok: true };
        });
        return result;
      },

      revealThrough: (through) => {
        set((s) => {
          const phase = s.stage === "preseason" ? "PRE" : "REG";
          markRevealed(s, s.viewerGmId, phase, through);
        });
        return { ok: true };
      },

      submitTrainingCamp: (plan) => {
        const st = get();
        const code = st.gms.find((g) => g.id === st.viewerGmId)?.teamCode;
        if (!code) return { ok: false, reason: "You don't have a team." };
        const check = checkCampSubmission(plan);
        if (!check.ok) return check;
        set((s) => {
          const mine = s.gms.find((g) => g.id === s.viewerGmId)!.teamCode;
          runTrainingCamp(s, mine, plan);
        });
        return { ok: true };
      },

      submitHoodedFigurePayment: (payment) => {
        const st = get();
        const code = st.gms.find((g) => g.id === st.viewerGmId)?.teamCode;
        if (!code) return { ok: false, reason: "You don't have a team." };
        const existing = hoodedFigureEncounterFor(st, code);
        if (existing?.resolved) return { ok: false, reason: "You've already answered the figure this year." };
        const check = checkHoodedFigurePayment(st, code, payment);
        if (!check.ok) return check;
        set((s) => {
          const mine = s.gms.find((g) => g.id === s.viewerGmId)!.teamCode;
          resolveHoodedFigureEncounter(s, mine, payment);
          recomputeTeamRatings(s);
        });
        return { ok: true };
      },

      freeAgencyTurn: (move) => {
        const st = get();
        const code = st.gms.find((g) => g.id === st.viewerGmId)?.teamCode;
        if (!code) return { ok: false, reason: "You don't have a team." };
        if (!move.pass && move.playerId) {
          const check = checkOffer(st, code, move.playerId, Number(move.salary), Number(move.years));
          if (!check.ok) return check;
        }
        set((s) => {
          const mine = s.gms.find((g) => g.id === s.viewerGmId)!.teamCode;
          if (move.pass || !move.playerId) applyPass(s, mine);
          else applyOffer(s, mine, move.playerId, Number(move.salary), Number(move.years));
          const humans = new Set(s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
          runFreeAgencyCpuTurns(s, humans);

          // The event ending is a stage change, not a prompt — there is
          // nothing left to decide once the fifth round resolves, and this
          // screen has no readiness gate to press. Without it the market
          // played itself out and then sat there complete and unleavable,
          // the same dead end the coaching draft and the trade deadline
          // both had. Both stages run this event (the opening market and
          // midseason's), so both have to be recognised.
          const from = s.stage;
          if (s.freeAgencyEvent?.complete && (from === "freeAgency" || from === "midseasonFreeAgency")) {
            const t = resolveTransition(s, {});
            applyStageEntry(s, from, t.stage);
            s.stage = t.stage;
            s.week = t.week;
            clearReadiness(s);
          }
        });
        return { ok: true };
      },

      draftCoach: (coachId) => {
        const st = get();
        const code = st.gms.find((g) => g.id === st.viewerGmId)?.teamCode;
        if (!code) return { ok: false, reason: "You don't have a team." };
        const check = checkCoachingPick(st, code, coachId);
        if (!check.ok) return check;
        set((s) => {
          const code2 = s.gms.find((g) => g.id === s.viewerGmId)!.teamCode;
          applyCoachingPick(s, code2, coachId);
          const humans = new Set(s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
          runAiCoachingPicks(s, humans);
          // mirrors online's decideCoachingPick — when the last job in the
          // league is filled there is nothing left to decide, so the stage
          // advances on its own instead of leaving the board sitting there
          // with no way out (playtest finding 3).
          if (coachingDraftComplete(s)) {
            const t = resolveTransition(s, {});
            applyStageEntry(s, s.stage, t.stage);
            s.stage = t.stage;
            s.week = t.week;
            clearReadiness(s);
          }
        });
        return { ok: true };
      },

      hireCoach: (coachId) => {
        const st = get();
        const code = st.gms.find((g) => g.id === st.viewerGmId)?.teamCode;
        if (!code) return { ok: false, reason: "You don't have a team." };
        const check = checkCoachHire(st, coachId, code);
        if (!check.ok) return check;
        set((s) => {
          applyCoachHire(s, coachId, code);
          recomputeTeamRatings(s);
        });
        return { ok: true };
      },

      signStandingFreeAgent: (playerId, offer) => {
        const check = checkStandingSign(get(), playerId, offer);
        if (!check.ok) return check;
        set((s) => {
          const pp = s.players[playerId];
          if (!pp || !pp.free_agent) return;
          pp.free_agent = false;
          pp.nfl_team = offer.teamCode;
          pp.contract = offerToContract(offer);
          s.standingFreeAgents = s.standingFreeAgents.filter((x) => x !== playerId);
          recomputeTeamRatings(s);
        });
        return { ok: true };
      },

      setDepthOrder: (teamCode, position, playerIds) =>
        set((s) => {
          const forTeam = (s.depthChart[teamCode] ??= {});
          forTeam[position] = playerIds;
          // the lineup is what the team rating averages, so benching a starter
          // has to show up on the screen that just did it
          recomputeTeamRatings(s);
        }),

      restructurePlayer: (playerId) => {
        let result: ContractMoveResult = { ok: false, reason: "Unknown player." };
        set((s) => {
          const p = s.players[playerId];
          if (!p || p.free_agent || p.retired) return;
          result = restructureContract(p, s.season);
          if (result.ok) recomputeTeamRatings(s);
        });
        return result;
      },

      extendPlayer: (playerId, offer) => {
        let result: ContractMoveResult = { ok: false, reason: "Unknown player." };
        set((s) => {
          const p = s.players[playerId];
          if (!p || p.free_agent || p.retired) return;
          result = extendContract(s, p, offer);
          if (result.ok) recomputeTeamRatings(s);
        });
        return result;
      },

      releasePlayer: (playerId) =>
        set((s) => {
          const p = s.players[playerId];
          if (!p || p.free_agent || p.retired) return;
          releaseToMarket(s, p);
          recomputeTeamRatings(s);
        }),

      signRookie: (prospectId, teamCode) =>
        set((s) => {
          if (!checkRookieOutcome(s, prospectId, teamCode).ok) return;
          applyRookieOutcome(s, prospectId, teamCode, false);
        }),

      releaseRookie: (prospectId, teamCode) =>
        set((s) => {
          if (!checkRookieOutcome(s, prospectId, teamCode).ok) return;
          applyRookieOutcome(s, prospectId, teamCode, true);
        }),

      proposeTrade: (toTeam, fromPlayerIds, toPlayerIds) => {
        const id = `trade_${Date.now()}`;
        set((s) => {
          const fromTeam = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "";
          // ids prefixed `pick:` are draft capital, not people
          const asAssets = (ids: string[]): TradeAsset[] =>
            ids.map((id) =>
              id.startsWith("pick:")
                ? { kind: "pick" as const, pick: s.draftPicks[id.slice(5)] }
                : { kind: "player" as const, playerId: id },
            );
          const fromAssets = asAssets(fromPlayerIds);
          const toAssets = asAssets(toPlayerIds);
          const evalResult = sim.evaluateTrade(s, fromTeam, toTeam, fromAssets, toAssets);
          const involves90 = [...fromPlayerIds, ...toPlayerIds].some(
            (pid) => (s.players[pid]?.overall ?? 0) >= 90,
          );
          const toIsHuman = s.gms.some((g) => g.isHuman && g.teamCode === toTeam);
          const fromIsHuman = s.gms.some((g) => g.isHuman && g.teamCode === fromTeam);
          const needsVote = involves90 && (toIsHuman || fromIsHuman);
          s.trades.push({
            id,
            fromTeam,
            toTeam,
            fromAssets,
            toAssets,
            aiValueDelta: evalResult.valueDelta,
            aiAcceptLikelihood: evalResult.acceptLikelihood,
            vote: needsVote
              ? {
                  required: true,
                  votes: Object.fromEntries(s.gms.filter((g) => g.isHuman).map((g) => [g.id, null])),
                  outcome: "pending",
                }
              : undefined,
            // always a draft: `resolveTrade` is what decides, and for a trade
            // that needs a league vote it is also what lets the partner refuse
            // before the vote is ever taken
            status: "draft",
          });
        });
        return id;
      },

      respondToOffer: (tradeId, accept) => {
        let result: { ok: boolean; reason?: string } = { ok: false, reason: "No such offer." };
        set((s) => {
          const t = s.trades.find((x) => x.id === tradeId);
          if (!t || t.status !== "offered") return;
          if (!accept) {
            t.status = "rejected";
            result = { ok: true };
            return;
          }
          const legal = checkTrade(s, t);
          if (!legal.ok) {
            t.blockedReason = legal.reason;
            result = legal;
            return;
          }
          t.status = "accepted";
          applyTrade(s, t);
          result = { ok: true };
        });
        return result;
      },

      castTradeVote: (tradeId, gmId, vote) =>
        set((s) => {
          const t = s.trades.find((x) => x.id === tradeId);
          if (!t?.vote) return;
          t.vote.votes[gmId] = vote;
          // The rest of the league is a collusion guard: wave through a deal
          // that looks roughly fair, block one that is lopsided either way.
          // This used to vote "for" whenever the deal wasn't bad *for the
          // proposer*, which rubber-stamped precisely the fleecings the vote
          // exists to stop — a 2%-acceptance heist passed 3-0.
          // Trade Valuation optimization pass (trade.vote_safeguard).
          const lopsided = t.aiAcceptLikelihood >= 0.82 || t.aiAcceptLikelihood <= 0.18;
          for (const g of s.gms) {
            if (g.isHuman && g.id !== gmId && t.vote.votes[g.id] == null) {
              t.vote.votes[g.id] = lopsided ? "against" : "for";
            }
          }
          const vals = Object.values(t.vote.votes);
          const forN = vals.filter((v) => v === "for").length;
          const againstN = vals.filter((v) => v === "against").length;
          t.vote.outcome = forN > againstN ? "passed" : "blocked";
          t.status = t.vote.outcome === "passed" ? "accepted" : "blocked";
          if (t.status === "accepted") {
            const legal = checkTrade(s, t);
            if (!legal.ok) {
              t.status = "rejected";
              t.blockedReason = legal.reason;
              return;
            }
            applyTrade(s, t);
          }
        }),

      resolveTrade: (tradeId) =>
        set((s) => {
          const t = s.trades.find((x) => x.id === tradeId);
          if (!t || t.status !== "draft") return;
          const partnerIsHuman = s.gms.some((g) => g.isHuman && g.teamCode === t.toTeam);
          // An AI partner decides for itself, first and regardless of any vote.
          // A league vote exists to block a blockbuster, never to force an
          // unwilling team into one — without this, any trade involving a 90+
          // player skipped the partner entirely and a star could be prised off
          // a team that wanted no part of the deal.
          if (!partnerIsHuman && t.aiAcceptLikelihood < 0.5) {
            t.status = "rejected";
            delete t.vote;
            return;
          }
          // willing is not the same as able — neither side may come out of a
          // trade over the cap or over the roster limit
          const legal = checkTrade(s, t);
          if (!legal.ok) {
            t.status = "rejected";
            t.blockedReason = legal.reason;
            delete t.vote;
            return;
          }
          if (t.vote) {
            t.status = "pending"; // the partner is willing; the league still votes
            return;
          }
          t.status = "accepted";
          applyTrade(s, t);
        }),
    })),
    {
      name: SAVE_KEY,
      version: CURRENT_SAVE_VERSION,
      migrate: (persisted, version) => migrateLeagueSave(persisted, version) as never,
      // Fires once, after the one hydration attempt `persist` makes on
      // startup, whether it succeeded or not — this is the only hook it
      // gives a parse failure, since the failure happens inside its own
      // `JSON.parse` of whatever storage.getItem returned, not in the
      // storage object below.
      onRehydrateStorage: () => (_state, error) => {
        if (!error) {
          if (saveCorrupted) {
            saveCorrupted = false;
            notifyCorruptState();
          }
          return;
        }
        try {
          const raw = window.localStorage.getItem(SAVE_KEY);
          if (raw != null) window.localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
        } catch {
          // the backup is a courtesy on top of the flag, not the fix itself —
          // a device where even this write fails still gets the warning
        }
        saveCorrupted = true;
        notifyCorruptState();
      },
      // A quota error out of `localStorage.setItem` is swallowed by the
      // persist middleware — it logs and carries on, so a dynasty that
      // outgrows its storage just quietly stops saving and the player finds
      // out when they reopen the tab. This surfaces it instead.
      storage: createJSONStorage(() => ({
        getItem: (k) => window.localStorage.getItem(k),
        removeItem: (k) => window.localStorage.removeItem(k),
        setItem: (k, v) => {
          try {
            window.localStorage.setItem(k, v);
            if (saveBroken) {
              saveBroken = false;
              notifySaveState();
            }
          } catch {
            if (!saveBroken) {
              saveBroken = true;
              notifySaveState();
            }
          }
        },
      })),
      partialize: (s) => {
        const rest: Partial<Store> = { ...s };
        for (const k of Object.keys(rest) as (keyof Store)[]) {
          if (typeof rest[k] === "function") delete rest[k];
        }
        return rest;
      },
    },
  ),
);

if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}
