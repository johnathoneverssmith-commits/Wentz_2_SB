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
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import {
  ROUND_ORDER,
  type Coach,
  type CoachRole,
  type ContractOffer,
  type DraftMode,
  type FreeAgencyState,
  type LeagueConfig,
  type LeagueState,
  type Player,
  type Position,
  type Stage,
} from "@/domain";
import { TEAMS, TEAMS_BY_CODE } from "@/data/teams";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { contractValueFor } from "@/sim/MockSimulationService";
import { OFFSEASON_ROSTER_SIZE, ROSTER_SIZE } from "@/sim/roster-template.ts";
import { coachPriorities, playerPriorities } from "@/sim/priorities";

import {
  applySeasonAging,
  createLeague,
  expireContracts,
  fillRosterGaps,
  marketDeal,
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
import { applyInjuries, clearInjuries, healOneWeek } from "./injuries.ts";
import {
  accrueSeasonStats,
  recomputeStandings,
  resetSeasonStats,
} from "./standings.ts";

const sim = new HybridSimulationService();

export type Subject = "players" | "coaches";

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

  signRookie: (prospectId: string, teamCode: string) => void;
  releaseRookie: (prospectId: string, teamCode: string) => void;

  /** Record the GM's depth order at one position. Ids are best-first;
   *  anyone left out falls in behind by overall. */
  setDepthOrder: (teamCode: string, position: Position, playerIds: string[]) => void;

  /** Cut a player from the roster. He goes straight onto the standing free
   *  agent market and his whole cap hit comes off the books — see
   *  `releaseToMarket` for why no dead money is charged. */
  releasePlayer: (playerId: string) => void;

  proposeTrade: (toTeam: string, fromPlayerIds: string[], toPlayerIds: string[]) => string;
  castTradeVote: (tradeId: string, gmId: string, vote: "for" | "against") => void;
  resolveTrade: (tradeId: string) => void;
}

export type Store = LeagueState & StoreActions;

function humanGate(state: LeagueState): boolean {
  return state.gms.filter((g) => g.isHuman).every((g) => state.readiness[g.id]);
}
function clearReadiness(state: LeagueState): void {
  for (const g of state.gms) state.readiness[g.id] = g.id !== state.viewerGmId;
}
function faField(subject: Subject): "freeAgency" | "coachingHire" {
  return subject === "players" ? "freeAgency" : "coachingHire";
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
            s.schedule = schedule;
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
          if (s.stage === "setup" && partial.humanGmCount != null) {
            const fresh = createLeague(1, s.config);
            s.gms = fresh.gms.map((g) => s.gms.find((x) => x.id === g.id) ?? g);
            s.teams = fresh.teams;
            for (const g of s.gms) {
              if (g.teamCode && s.teams[g.teamCode]) {
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
          ? await sim.generateSchedule(before.season + 1, Object.keys(before.teams))
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
            s.games = [];
            s.draft = null;
            s.freeAgency = null;
            s.coachingHire = null;
            s.trades = [];
            s.rookieOutcomes = {};
            s.pendingGameDay = null;
            clearInjuries(s); // an offseason outlasts any injury
            pruneFreeAgentMarket(s); // careers that stopped going anywhere end
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

          // leaving the fantasy draft → undrafted players seed the standing FA
          // market, then every team is brought up to a full 53 (20 rounds only
          // hands each team 20 players)
          if (s.stage === "fantasyDraft" && t.stage === "fantasyDraftSummary") {
            openStandingMarketFromUndrafted(s);
            fillRosterGaps(s);
          }

          // leaving rookie signings → the AI teams put their own classes under
          // contract, then every roster is cut back to legal before the market
          // opens
          if (s.stage === "offseasonSignings" && t.stage === "offseasonFreeAgency") {
            signAiDraftPicks(s);
            trimRosters(s);
          }

          // Hard stop before the season: free agency is optional, so a team can
          // reach this point still short. Nobody takes the field without a full,
          // position-legal roster.
          if (t.stage === "preseason") fillRosterGaps(s);

          // leaving retirement review → actually retire the players it showed
          if (s.stage === "offseasonRetirement" && t.stage === "offseasonDraftPrep") {
            commitRetirements(s);
          }

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
          s.stage = t.stage;
          s.week = t.week;
          s.pendingGameDay = null;
          clearReadiness(s);
          recomputeTeamRatings(s);
        });
        return { route: STAGE_HOME[get().stage] };
      },

      startDraft: (mode) =>
        set((s) => {
          // a GM who somehow reached the draft without a team contributes no
          // slot, rather than an empty string in the pick order
          const humanCodes = s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
          const allCodes = Object.keys(s.teams);
          const aiCodes = allCodes.filter((c) => !humanCodes.includes(c));

          let fullFirstRound: string[];
          if (mode === "rookie") {
            // real NFL order: worst record picks first. Falls back to a shuffle
            // before any games have been played.
            const played = allCodes.some((c) => {
              const t = s.teams[c]!;
              return t.wins + t.losses + t.ties > 0;
            });
            const pct = (code: string): number => {
              const t = s.teams[code]!;
              const g = t.wins + t.losses + t.ties;
              return g === 0 ? 0.5 : (t.wins + 0.5 * t.ties) / g;
            };
            const diff = (code: string): number => {
              const t = s.teams[code]!;
              return t.pointsFor - t.pointsAgainst;
            };
            fullFirstRound = played
              ? [...allCodes].sort((a, b) => pct(a) - pct(b) || diff(a) - diff(b))
              : shuffle(allCodes, s.season + 11);
          } else if (s.config.draftOrder === "randomized") {
            // every team in the hat — not the humans first and the AI after,
            // which handed the human GMs the top picks of all 20 rounds
            fullFirstRound = shuffle(allCodes, s.season + 7);
          } else {
            // "in order": GM 1 first, GM 2 second, …, then the AI teams
            fullFirstRound = [...humanCodes, ...shuffle(aiCodes, s.season + 11)];
          }

          const rounds = mode === "fantasy" ? 20 : 7;
          const order: string[] = [];
          for (let r = 0; r < rounds; r++) {
            const seq =
              s.config.draftType === "snake" && r % 2 === 1
                ? [...fullFirstRound].reverse()
                : fullFirstRound;
            order.push(...seq);
          }
          s.draft = {
            mode,
            year: s.season,
            order: s.config.draftType,
            pickOrder: order,
            currentPickIndex: 0,
            results: [],
            targetsByGm: Object.fromEntries(s.gms.filter((g) => g.isHuman).map((g) => [g.id, []])),
          };
        }),

      makePick: (selectedId) => set((s) => { if (s.draft) applyPick(s, selectedId); }),

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

      startBidding: (subject) =>
        set((s) => {
          const field = faField(subject);
          if (s[field]) return;
          if (subject === "players") {
            // The market is whoever's deal has run out, which `expireContracts`
            // settled when the season was finalized. This used to release an
            // arbitrary first-160 slice of everyone on a one-year-or-less deal,
            // so which teams lost players came down to object key order.
            for (const p of Object.values(s.players)) {
              if (p.retired || p.free_agent) continue;
              if (p.contract && p.contract.years_remaining <= 0) releaseToMarket(s, p);
            }
          } else {
            // coaching: every team starts with zero coaches — all coaches to market
            for (const c of Object.values(s.coaches)) {
              c.team = null;
              c.contract = null;
            }
          }
          s[field] = {
            subject,
            mode: "main",
            day: 1,
            secondsRemaining: 12 * 60,
            interstitialVisible: false,
            bids: {},
            signed: [],
          };
        }),

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
          const fa = s[faField(subject)];
          if (!fa || fa.mode !== "main") return;
          resolveBiddingDay(s, subject, fa);
          if (fa.day >= 5) {
            // closing day — no team is left without a coaching staff
            if (subject === "coaches") fillVacantStaffs(s, fa);
            fa.mode = "standing";
            fa.interstitialVisible = false;
          } else {
            fa.day += 1;
            fa.secondsRemaining = 12 * 60;
            fa.interstitialVisible = true;
          }
          recomputeTeamRatings(s);
        }),

      dismissInterstitial: (subject) =>
        set((s) => {
          const fa = s[faField(subject)];
          if (fa) fa.interstitialVisible = false;
        }),

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

      releasePlayer: (playerId) =>
        set((s) => {
          const p = s.players[playerId];
          if (!p || p.free_agent || p.retired) return;
          releaseToMarket(s, p);
          recomputeTeamRatings(s);
        }),

      signRookie: (prospectId, teamCode) =>
        set((s) => {
          const pr = s.draftClass.find((d) => d.id === prospectId);
          if (!pr || s.rookieOutcomes[prospectId]) return;
          const round = s.draft?.results.find((r) => r.selectedId === prospectId)?.round ?? 4;
          upsertRookiePlayer(s, prospectId, teamCode, round, false);
          s.rookieOutcomes[prospectId] = "signed";
          recomputeTeamRatings(s);
        }),

      releaseRookie: (prospectId, teamCode) =>
        set((s) => {
          const pr = s.draftClass.find((d) => d.id === prospectId);
          if (!pr || s.rookieOutcomes[prospectId]) return;
          const round = s.draft?.results.find((r) => r.selectedId === prospectId)?.round ?? 4;
          upsertRookiePlayer(s, prospectId, teamCode, round, true);
          s.rookieOutcomes[prospectId] = "released";
          recomputeTeamRatings(s);
        }),

      proposeTrade: (toTeam, fromPlayerIds, toPlayerIds) => {
        const id = `trade_${Date.now()}`;
        set((s) => {
          const fromTeam = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "";
          const fromAssets = fromPlayerIds.map((pid) => ({ kind: "player" as const, playerId: pid }));
          const toAssets = toPlayerIds.map((pid) => ({ kind: "player" as const, playerId: pid }));
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
          const lopsided = t.aiAcceptLikelihood >= 0.85 || t.aiAcceptLikelihood <= 0.2;
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
      name: "nfl-sim-ui.league",
      version: 2,
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

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

/* ---- helpers -------------------------------------------------------- */

function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function applyPick(s: LeagueState, selectedId: string): void {
  const d = s.draft!;
  const idx = d.currentPickIndex;
  const teamCode = d.pickOrder[idx]!;
  // every team picks once per round (startDraft builds pickOrder from all 32
  // teams), so the round is the pick index over the team count — not over
  // the number of human GMs, which put pick 33 in "round 12" and drove the
  // slotted rookie contract (36 - round*4.5) negative for later picks
  const teamsPerRound = Object.keys(s.teams).length || 32;
  const round = Math.floor(idx / teamsPerRound) + 1;
  if (d.mode === "rookie") {
    const pr = s.draftClass.find((p) => p.id === selectedId);
    d.results.push({
      pickNumber: idx + 1,
      round,
      teamCode,
      selectedId,
      selectedName: pr?.name ?? null,
      selectedPosition: pr?.position ?? null,
    });
  } else {
    const p = s.players[selectedId];
    if (p) {
      // A drafted player is on the team — all of it, not just the team code.
      // Leaving `free_agent` set made him count as rostered *and* as market
      // supply, so the roster fill would "sign" a man it already had and stop
      // one real body short of 53.
      p.nfl_team = teamCode;
      p.free_agent = false;
      // a fantasy pick is a signing: pay him, on a term staggered by round so
      // a team's twenty deals don't all run out in the same offseason. (By
      // pick index they would: 32 teams pick per round, so every pick a team
      // owns shares the same index mod 4.)
      if (!p.contract) p.contract = marketDeal(teamCode, p, 2 + ((round - 1) % 4));
      s.standingFreeAgents = s.standingFreeAgents.filter((id) => id !== selectedId);
    }
    d.results.push({
      pickNumber: idx + 1,
      round,
      teamCode,
      selectedId,
      selectedName: p?.name ?? null,
      selectedPosition: p?.position ?? null,
    });
  }
  d.currentPickIndex += 1;
}

/**
 * Best-player-available, tempered by the picking team's actual positional
 * need (OQ-9) — not pure highest-overall. `NEED_WEIGHT` is calibrated so a
 * maximal need (no one at all on the roster at that position) can tip a
 * close call but won't make a team reach for a real reach over a
 * meaningfully better prospect at a position they're already fine at.
 */
const NEED_WEIGHT = 0.6;

export function bestAvailable(s: LeagueState): string | null {
  const d = s.draft!;
  const teamCode = d.pickOrder[d.currentPickIndex];
  const taken = new Set(d.results.map((r) => r.selectedId));
  // Need only depends on the picking team's roster, not on which two players
  // are being compared — compute it once per position per call. (It used to
  // run inside the sort comparator: ~40k full roster scans per pick, which
  // made "Autopick remaining" freeze the browser for minutes.)
  const needByPos = new Map<Position, number>();
  const need = (pos: Position): number => {
    let v = needByPos.get(pos);
    if (v === undefined) {
      v = teamCode ? positionalNeed(s, teamCode, pos) * NEED_WEIGHT : 0;
      needByPos.set(pos, v);
    }
    return v;
  };
  // first-max scan == stable sort's [0]: ties keep the earliest candidate
  let bestId: string | null = null;
  let bestScore = -Infinity;
  if (d.mode === "rookie") {
    for (const x of s.draftClass) {
      if (taken.has(x.id)) continue;
      const score = x.collegeOverall + need(x.position);
      if (score > bestScore) {
        bestScore = score;
        bestId = x.id;
      }
    }
    return bestId;
  }
  for (const x of Object.values(s.players)) {
    if (taken.has(x.id) || x.retired) continue;
    const score = x.overall + need(x.position);
    if (score > bestScore) {
      bestScore = score;
      bestId = x.id;
    }
  }
  return bestId;
}

/**
 * Every pick "Autopick remaining" would make, decided up front on plain data.
 *
 * Running the loop inside the immer producer meant `bestAvailable` re-read the
 * proxied player map on every pick (a 20-round fantasy draft is 640 picks over
 * ~1,700 players), and immer's proxies cost ~100x a plain property read: the
 * button froze the tab for over a minute. This mirrors the handful of fields
 * the scoring actually reads, runs the same first-max scan and the same
 * need-tempered score, and hands the producer a finished list of ids — same
 * picks, no proxy in the hot path. `positionalNeed` is maintained incrementally
 * here (a fantasy pick moves a player between teams, changing both teams' need
 * at that position) rather than rescanned per candidate.
 */
function planAutopicks(s: LeagueState): string[] {
  const d = s.draft;
  if (!d) return [];
  const rookie = d.mode === "rookie";

  // candidate order mirrors bestAvailable's, so ties resolve identically
  const candidates = rookie
    ? s.draftClass.map((p) => ({ id: p.id, position: p.position, overall: p.collegeOverall }))
    : Object.values(s.players)
        .filter((p) => !p.retired)
        .map((p) => ({ id: p.id, position: p.position, overall: p.overall }));
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const taken = new Set<string>();
  for (const r of d.results) if (r.selectedId) taken.add(r.selectedId);

  // team -> position -> overalls currently on that roster; positionalNeed only
  // ever asks for the max of one of these groups
  const rosters = new Map<string, Map<Position, number[]>>();
  const groupFor = (team: string, pos: Position): number[] => {
    let byPos = rosters.get(team);
    if (!byPos) rosters.set(team, (byPos = new Map()));
    let list = byPos.get(pos);
    if (!list) byPos.set(pos, (list = []));
    return list;
  };
  for (const p of Object.values(s.players)) {
    if (!p.retired) groupFor(p.nfl_team, p.position).push(p.overall);
  }
  const needOf = (team: string | undefined, pos: Position): number => {
    if (!team) return 0;
    const list = rosters.get(team)?.get(pos);
    let best = 0;
    if (list) for (const v of list) if (v > best) best = v;
    return Math.max(1, 78 - (best || 40)) * NEED_WEIGHT;
  };

  const out: string[] = [];
  for (let i = d.currentPickIndex; i < d.pickOrder.length; i++) {
    const teamCode = d.pickOrder[i];
    const needByPos = new Map<Position, number>();
    const need = (pos: Position): number => {
      let v = needByPos.get(pos);
      if (v === undefined) needByPos.set(pos, (v = needOf(teamCode, pos)));
      return v;
    };

    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (taken.has(c.id)) continue;
      const score = c.overall + need(c.position);
      if (score > bestScore) {
        bestScore = score;
        bestId = c.id;
      }
    }
    if (!bestId) break;
    out.push(bestId);
    taken.add(bestId);

    // a fantasy pick moves the player onto the picking team; a rookie pick
    // doesn't touch `players` until the signing stage, so nothing shifts
    if (!rookie && teamCode) {
      const c = byId.get(bestId);
      const from = s.players[bestId]?.nfl_team;
      if (c && from && from !== teamCode) {
        const old = groupFor(from, c.position);
        const at = old.indexOf(c.overall);
        if (at >= 0) old.splice(at, 1);
        groupFor(teamCode, c.position).push(c.overall);
      }
    }
  }
  return out;
}

function offerToContract(o: ContractOffer) {
  return {
    team_id: o.teamCode,
    years_remaining: o.years,
    total_value: Math.round((o.baseSalary * o.years + o.signingBonus) * 10) / 10,
    guaranteed: o.guaranteed,
    cap_hit_by_year: Array.from({ length: o.years }, () =>
      Math.round((o.baseSalary + o.signingBonus / o.years) * 10) / 10,
    ),
    signing_bonus: o.signingBonus,
  };
}

/** Resolve one in-game day for either subject. */
function resolveBiddingDay(s: LeagueState, subject: Subject, fa: FreeAgencyState): void {
  const rng = mulberry(s.season * 131 + fa.day * 7 + (subject === "players" ? 1 : 2));
  if (subject === "players") {
    const pool = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
    const signCount = 8 + Math.floor(rng() * 12);
    // `cap.used` is only recomputed once the day is over, so a day's own
    // signings are tracked here — otherwise four winning bids on one day each
    // see the same room and the team ends the day well past the cap.
    const spentToday: Record<string, number> = {};
    for (let i = 0; i < signCount; i++) {
      const p = pool[Math.floor(rng() * pool.length)];
      if (!p || fa.signed.some((x) => x.id === p.id)) continue;
      const winning = bestOfferFor(fa, "players", p.id, s) ?? aiOfferForPlayer(rng, s, p);
      const team = s.teams[winning.teamCode];
      if (!team) continue;
      const hit = offerToContract(winning).cap_hit_by_year[0] ?? 0;
      const room = team.cap.total - team.cap.used - (spentToday[winning.teamCode] ?? 0);
      // he stays on the market rather than being signed into an illegal roster
      if (hit > room || rosterCountOf(s, winning.teamCode) >= rosterLimitFor(s.stage)) continue;
      spentToday[winning.teamCode] = (spentToday[winning.teamCode] ?? 0) + hit;
      fa.signed.push({ id: p.id, toTeam: winning.teamCode, ...offerFields(winning), at: fa.day });
      p.free_agent = false;
      p.nfl_team = winning.teamCode;
      p.contract = offerToContract(winning);
    }
  } else {
    const openCoaches = Object.values(s.coaches).filter((c) => c.team === null);
    const signCount = 6 + Math.floor(rng() * 8);
    for (let i = 0; i < signCount; i++) {
      const c = openCoaches[Math.floor(rng() * openCoaches.length)];
      if (!c || fa.signed.some((x) => x.id === c.id)) continue;
      const winning = bestOfferFor(fa, "coaches", c.id, s) ?? aiOfferForCoach(rng, s, c);
      if (!winning) continue; // no AI team has a vacancy at this role right now
      // don't let an AI team stack two coaches of the same role
      const clash = Object.values(s.coaches).some(
        (o) => o.team === winning.teamCode && o.role === c.role,
      );
      if (clash) continue;
      fa.signed.push({ id: c.id, toTeam: winning.teamCode, ...offerFields(winning), at: fa.day });
      c.team = winning.teamCode;
      c.contract = { yearsRemaining: winning.years, annualValue: winning.baseSalary };
    }
  }
}

/** Rough "who's the better hire" ordering, for the closing-day backfill. */
function coachQuality(c: Coach): number {
  return c.role === "HC"
    ? (c.discipline ?? 0) + (c.gameManagement ?? 0) + (c.aggressiveness ?? 0) / 2
    : (c.playCallIq ?? 0) * 2;
}

/**
 * Nobody leaves the hiring window without a staff.
 *
 * The 5-day window only signs coaches to teams that actually bid, and it
 * resolves 6-13 of them a day — so a full window left ~29 of 32 teams short
 * and, if the player never bid, gave them nothing. There is no other way to
 * hire: `startBidding` won't reopen a window that already exists, and the
 * Coaching Staff hub is read-only. Teams were stranded with "Vacant" in every
 * role for the rest of the dynasty, which also means no scheme for
 * `computeSchemeFit` and no staff for the engine's coaching layer.
 *
 * So when the window closes, the league fills what's left: best remaining
 * candidate per role, teams taken in a seeded order so nobody is
 * systematically served last, at the coach's own asking price. Supply covers
 * it — the market is built with 40 HCs and 42 of each coordinator for 32
 * jobs apiece.
 */
function fillVacantStaffs(s: LeagueState, fa: FreeAgencyState): void {
  for (const role of ["HC", "OC", "DC"] as CoachRole[]) {
    const filled = new Set(
      Object.values(s.coaches)
        .filter((c) => c.team && c.role === role)
        .map((c) => c.team!),
    );
    const needy = shuffle(
      Object.keys(s.teams).filter((t) => !filled.has(t)),
      s.season * 31 + role.length,
    );
    const pool = Object.values(s.coaches)
      .filter((c) => c.team === null && c.role === role)
      .sort((a, b) => coachQuality(b) - coachQuality(a));
    for (const team of needy) {
      const c = pool.shift();
      if (!c) break;
      const asking = coachPriorities(c).expectation;
      c.team = team;
      c.contract = { yearsRemaining: asking.years, annualValue: asking.baseSalary };
      fa.signed.push({
        id: c.id,
        toTeam: team,
        baseSalary: asking.baseSalary,
        signingBonus: asking.signingBonus,
        years: asking.years,
        guaranteed: asking.guaranteed,
        at: fa.day,
      });
    }
  }
}

function offerFields(o: ContractOffer) {
  return {
    baseSalary: o.baseSalary,
    signingBonus: o.signingBonus,
    years: o.years,
    guaranteed: o.guaranteed,
  };
}
/**
 * Which competing offer wins (OQ-9): not just the highest dollar figure —
 * the subject's own stated top-3 priorities (`playerPriorities`/
 * `coachPriorities`, already computed for the negotiation-screen display,
 * previously never fed into the actual outcome) bend the decision toward an
 * offer that actually satisfies them. "location"/"market size" have no real
 * signal in this data model and are left neutral; the rest use data already
 * on hand: team overall (winning now / roster talent), positional need
 * (a starting role), and the real engine-backed computeSchemeFit (scheme
 * fit) — the same call CoachingStaffHub's live scheme-fit percentage uses.
 */
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function offerScore(o: ContractOffer, subject: Subject, subjectId: string, s: LeagueState): number {
  const dollar = o.baseSalary * o.years + o.signingBonus;
  const team = s.teams[o.teamCode];
  if (!team) return dollar;
  let bonus = 0;
  if (subject === "players") {
    const p = s.players[subjectId];
    if (p) {
      const ranked = playerPriorities(p).ranked;
      if (ranked.includes("winning now")) bonus += (team.ratings.overall - 75) / 50;
      if (ranked.includes("a starting role")) bonus += (positionalNeed(s, o.teamCode, p.position) - 10) / 100;
      if (ranked.includes("scheme fit")) {
        const oc = Object.values(s.coaches).find((c) => c.team === o.teamCode && c.role === "OC") ?? null;
        const dc = Object.values(s.coaches).find((c) => c.team === o.teamCode && c.role === "DC") ?? null;
        bonus += (sim.computeSchemeFit(p, oc, dc) - 62) / 150;
      }
    }
  } else {
    const c = s.coaches[subjectId];
    if (c) {
      const ranked = coachPriorities(c).ranked;
      if (ranked.includes("roster talent")) bonus += (team.ratings.rosterOverall - 75) / 50;
    }
  }
  return dollar * (1 + clamp(bonus, -0.3, 0.3));
}

function bestOfferFor(fa: FreeAgencyState, subject: Subject, id: string, s: LeagueState): ContractOffer | null {
  const offers = fa.bids[id];
  if (!offers || offers.length === 0) return null;
  return [...offers].sort((a, b) => offerScore(b, subject, id, s) - offerScore(a, subject, id, s))[0]!;
}

/**
 * AI GM decision-making (OQ-9, docs/decisions.md in the engine repo): an AI
 * team's free-agency/coach-hiring behavior optimizes for its own roster's
 * competitiveness — filling actual needs, at a realistic price, with a
 * coach whose scheme fits the roster already in place — not for grabbing
 * the single highest-rated player/coach available, and not (as it was
 * before) a uniformly random team + a uniformly random dollar amount.
 */

export function aiControlledTeams(s: LeagueState): string[] {
  return Object.entries(s.teams)
    .filter(([, t]) => t.controlledBy.kind === "ai")
    .map(([code]) => code);
}

/** Weighted pick — `weights` need not sum to 1; falls back to uniform if all-zero. */
export function weightedPick<T>(rng: () => number, items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)]!;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

/** How much a team needs help at `position` — bigger gap below a "starter-quality"
 *  bar (~78 overall) = more urgent; no one on the roster at all = most urgent. */
export function positionalNeed(s: LeagueState, teamCode: string, position: Position): number {
  const best = Object.values(s.players)
    .filter((p) => p.nfl_team === teamCode && p.position === position && !p.retired)
    .reduce((max, p) => Math.max(max, p.overall), 0);
  return Math.max(1, 78 - (best || 40));
}

/** Teams with at least `needed` ($M) of cap room — falls back to every AI
 *  team if literally none qualify, rather than deadlocking the market (a
 *  real front office would restructure/cut to create room; that maneuver
 *  isn't modeled, so this is the honest stand-in). */
export function affordableTeams(s: LeagueState, needed: number): string[] {
  const all = aiControlledTeams(s);
  const can = all.filter((code) => {
    const t = s.teams[code]!;
    return t.cap.total - t.cap.used >= needed;
  });
  return can.length > 0 ? can : all;
}

export function aiOfferForPlayer(rng: () => number, s: LeagueState, p: Player): ContractOffer {
  // real value (overall-driven), with market noise so it isn't a single fixed number
  const base = Math.round(contractValueFor(p.overall, p.position) * (0.85 + rng() * 0.4) * 10) / 10;
  const candidates = affordableTeams(s, base);
  const weights = candidates.map((code) => positionalNeed(s, code, p.position) ** 1.6);
  const teamCode = weightedPick(rng, candidates, weights) ?? candidates[0] ?? "FA";
  const years = 1 + Math.floor(rng() * 4);
  return {
    teamCode,
    baseSalary: base,
    signingBonus: Math.round(base * rng() * 1.5 * 10) / 10,
    years,
    guaranteed: Math.round(base * years * (0.3 + rng() * 0.4) * 10) / 10,
  };
}

// mirrors nfl-franchise-sim/src/engine/staff.ts's OFF_SCHEME_TAGS/DEF_SCHEME_TAGS
// (also duplicated in HybridSimulationService.ts for computeSchemeFit) — see
// that file's comment for why this stays a small inline table rather than a
// cross-project import.
const OFF_SCHEME_TAGS: Record<string, readonly string[]> = {
  west_coast: ["west_coast", "play_action", "move_te", "zone_run", "outside_zone"],
  vertical: ["vertical", "spread", "play_action", "downhill"],
  spread: ["spread", "rpo", "zone_run", "outside_zone", "west_coast"],
  power_run: ["power_run", "gap_scheme", "inline", "downhill", "pass_pro"],
  zone_run: ["zone_run", "outside_zone", "west_coast", "move_te"],
  pro_style: ["play_action", "inline", "move_te", "power_run", "west_coast"],
};
const DEF_SCHEME_TAGS: Record<string, readonly string[]> = {
  four_three: ["base_4_3", "one_gap", "penetrate", "attack", "wide_9"],
  three_four: ["base_3_4", "two_gap", "contain", "nose"],
  multiple: ["nickel", "cover_3", "split_safety", "robber", "move_te"],
  cover_3: ["cover_3", "single_high", "zone", "robber"],
  cover_2: ["cover_2", "split_safety", "zone"],
  man_press: ["man_press", "cover_man", "cover_1", "nickel"],
};

/** Fraction of `teamCode`'s active roster whose scheme_tags overlap `scheme`'s tags. */
export function rosterSchemeFit(s: LeagueState, teamCode: string, role: "OC" | "DC", scheme: string | undefined): number {
  if (!scheme) return 0;
  const table = role === "OC" ? OFF_SCHEME_TAGS : DEF_SCHEME_TAGS;
  const want = new Set(table[scheme] ?? []);
  if (want.size === 0) return 0;
  const roster = Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired);
  if (roster.length === 0) return 0;
  const fit = roster.filter((p) => p.scheme_tags.some((t) => want.has(t))).length;
  return fit / roster.length;
}

export function aiOfferForCoach(rng: () => number, s: LeagueState, c: Coach): ContractOffer | null {
  const skill = c.role === "HC" ? (c.gameManagement ?? 50) : (c.playCallIq ?? 50);
  const base = Math.round(contractValueFor(skill) * (0.8 + rng() * 0.4) * 10) / 10;
  // only teams with an actual vacancy at this role — and enough cap room —
  // are real candidates. Hiring into an already-filled role isn't
  // optimizing for anything; coach salaries count against the same cap.
  const vacant = aiControlledTeams(s).filter(
    (code) => !Object.values(s.coaches).some((o) => o.team === code && o.role === c.role),
  );
  const affordable = new Set(affordableTeams(s, base));
  const candidates = vacant.filter((code) => affordable.has(code));
  const pool = candidates.length > 0 ? candidates : vacant;
  if (pool.length === 0) return null;
  const weights = pool.map((code) => {
    if (c.role === "HC") return 1; // no roster-composition signal for HC fit
    const fit = rosterSchemeFit(s, code, c.role, c.scheme);
    return 1 + fit * 3; // a well-fitting scheme is preferred, not required
  });
  const teamCode = weightedPick(rng, pool, weights) ?? pool[0]!;
  const years = 1 + Math.floor(rng() * 4);
  return {
    teamCode,
    baseSalary: base,
    signingBonus: Math.round(base * rng() * 1.5 * 10) / 10,
    years,
    guaranteed: Math.round(base * years * (0.3 + rng() * 0.4) * 10) / 10,
  };
}
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function openStandingMarketFromUndrafted(s: LeagueState): void {
  const taken = new Set(s.draft?.results.map((r) => r.selectedId) ?? []);
  const undrafted = Object.values(s.players).filter(
    (p) => !p.retired && !taken.has(p.id),
  );
  s.standingFreeAgents = undrafted.map((p) => p.id);
  for (const p of undrafted) {
    p.free_agent = true;
    p.nfl_team = "FA";
    p.contract = null;
  }
}

/**
 * Signs every draft pick the AI teams made.
 *
 * Only the viewer's picks were ever signed: the Rookie Signings screen is the
 * human's, and nothing did the same for the other 31 teams. So each year 217
 * drafted players simply vanished and the league never got any younger. Over
 * five seasons the average age climbed 27.5 -> 31.1, the median overall fell
 * 70 -> 65, and free agency drained from 358 players to 214 — a league quietly
 * ageing to death while its draft classes evaporated.
 */
function signAiDraftPicks(s: LeagueState): void {
  const humanTeams = new Set(s.gms.filter((g) => g.isHuman).map((g) => g.teamCode));
  for (const r of s.draft?.results ?? []) {
    if (!r.selectedId || humanTeams.has(r.teamCode)) continue;
    if (s.rookieOutcomes[r.selectedId]) continue;
    upsertRookiePlayer(s, r.selectedId, r.teamCode, r.round, false);
    s.rookieOutcomes[r.selectedId] = "signed";
  }
}

function upsertRookiePlayer(
  s: LeagueState,
  prospectId: string,
  teamCode: string,
  round: number,
  released: boolean,
): void {
  const pr = s.draftClass.find((d) => d.id === prospectId)!;
  const slot = Math.max(0.9, 8 - round);
  const id = `p_rookie_${prospectId}`;
  s.players[id] = {
    id,
    name: pr.name,
    position: pr.position,
    age: pr.age,
    nfl_team: released ? "FA" : teamCode,
    years_pro: 0,
    overall: pr.trueOverall,
    attributes: { speed: 70, strength: 70, awareness: 60 },
    scheme_tags: [],
    dev_age_threshold: pr.age + 3,
    decline_age_threshold: pr.age + 10,
    injury_history: [],
    contract: released
      ? null
      : {
          team_id: teamCode,
          years_remaining: 4,
          total_value: slot * 4,
          guaranteed: slot * 4,
          cap_hit_by_year: [slot, slot * 1.05, slot * 1.1, slot * 1.15],
          signing_bonus: slot,
        },
    free_agent: released,
    injury_status: null,
    retired: false,
    retirement_status: "active",
    draft_info: { round, pick: 0, class_year: s.season },
    college: pr.school,
    season_stats: { gamesPlayed: 0 },
  };
  if (released && !s.standingFreeAgents.includes(id)) s.standingFreeAgents.push(id);
}

/**
 * Actually retires the players RetirementReview.tsx showed as "retiring" —
 * same seed (`s.season`) and same `!p.retired` filter/order that screen
 * uses, so `sim.retirementOutcomes` replays the identical decision instead
 * of drawing fresh random outcomes at commit time.
 */
export function commitRetirements(s: LeagueState): void {
  const outcomes = sim.retirementOutcomes(
    s.season,
    Object.values(s.players).filter((p) => !p.retired),
  );
  for (const o of outcomes) {
    if (o.decision !== "retiring") continue;
    const p = s.players[o.playerId];
    if (!p) continue;
    p.retired = true;
    p.retirement_status = "retiring";
  }
}

/**
 * Cap-room gate for signing a standing free agent (the human-side follow-up
 * to OQ-9's AI cap enforcement - `affordableTeams`/`aiOfferForPlayer` were
 * already gated, this action wasn't). Read-only: never mutates `s`, so it's
 * safe to call from the action just to preview the result before committing.
 */
export function checkStandingSign(
  s: LeagueState,
  playerId: string,
  offer: ContractOffer,
): { ok: boolean; reason?: string } {
  const p = s.players[playerId];
  if (!p || !p.free_agent) return { ok: false, reason: "This player is no longer a free agent." };
  const team = s.teams[offer.teamCode];
  if (!team) return { ok: false, reason: "Unknown team." };
  const limit = rosterLimitFor(s.stage);
  if (rosterCountOf(s, offer.teamCode) >= limit) {
    return {
      ok: false,
      reason: `Your roster is full at ${limit}. Release a player on Roster & Cap to open a spot.`,
    };
  }
  const capHitYear1 = offerToContract(offer).cap_hit_by_year[0] ?? 0;
  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;
  if (capHitYear1 > room) {
    return {
      ok: false,
      reason: `Not enough cap space: this deal needs $${capHitYear1.toFixed(1)}M this year, you have $${room.toFixed(1)}M free.`,
    };
  }
  return { ok: true };
}

/**
 * How many players a team may carry right now. The 53-man limit is a
 * season rule; between the last game and the preseason gate a team may carry
 * the offseason ceiling, which is what makes the free-agency window playable
 * (see `OFFSEASON_ROSTER_SIZE`).
 */
export function rosterLimitFor(stage: Stage): number {
  return stage.startsWith("offseason") || stage.startsWith("endOfSeason")
    ? OFFSEASON_ROSTER_SIZE
    : ROSTER_SIZE;
}

/** Players currently counting against `teamCode`'s roster limit. */
function rosterCountOf(s: LeagueState, teamCode: string): number {
  return Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired).length;
}

/**
 * The live free-agency window's equivalent of `checkStandingSign`.
 *
 * A bid isn't a signing, so nothing was charged when it was placed — which
 * meant a GM with $7M of room could sit on six $20M offers and wake up on day
 * 5 having won four of them and blown $80M past the cap. The gate the player
 * then hit was the preseason trim cutting their own roster back down.
 *
 * So outstanding bids are treated as committed money: a new offer has to fit
 * the room left after every other bid this team still has live. Coach bids
 * aren't checked — coaching salaries aren't a player-cap charge.
 */
export function checkBid(
  s: LeagueState,
  subject: Subject,
  targetId: string,
  offer: ContractOffer,
): { ok: boolean; reason?: string } {
  if (subject === "coaches") return { ok: true };
  const team = s.teams[offer.teamCode];
  const fa = s.freeAgency;
  if (!team || !fa) return { ok: true };

  const committed = Object.entries(fa.bids).reduce((sum, [id, list]) => {
    if (id === targetId) return sum; // this offer replaces that one
    if (fa.signed.some((x) => x.id === id)) return sum; // already resolved
    const mine = list.find((o) => o.teamCode === offer.teamCode);
    return mine ? sum + (offerToContract(mine).cap_hit_by_year[0] ?? 0) : sum;
  }, 0);

  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;
  const thisBid = offerToContract(offer).cap_hit_by_year[0] ?? 0;
  if (thisBid + committed > room) {
    const free = Math.round((room - committed) * 10) / 10;
    return {
      ok: false,
      reason:
        committed > 0
          ? `You have $${committed.toFixed(1)}M already tied up in open bids, leaving $${free.toFixed(1)}M. This offer needs $${thisBid.toFixed(1)}M.`
          : `Not enough cap space: this offer needs $${thisBid.toFixed(1)}M this year, you have $${room.toFixed(1)}M free.`,
    };
  }
  return { ok: true };
}

/**
 * Whether both sides can legally absorb a trade.
 *
 * `applyTrade` only ever swapped team codes, so a trade was a free way around
 * every gate the rest of the app enforces: a GM with $2M of room could take
 * back a $40M contract, and a three-for-one put a team over the roster limit
 * with nothing to say about it. The cap is the point of the franchise layer;
 * it can't be optional on the one screen that moves the most money.
 *
 * Read-only, so the Trade Proposal screen can preview the answer before the
 * player commits to a deal that would be refused.
 */
export function checkTrade(
  s: LeagueState,
  t: Pick<LeagueState["trades"][number], "fromTeam" | "toTeam" | "fromAssets" | "toAssets">,
): { ok: boolean; reason?: string } {
  const hitOf = (ids: string[]): number =>
    ids.reduce((n, id) => n + (s.players[id]?.contract?.cap_hit_by_year[0] ?? 0), 0);
  const idsOf = (assets: LeagueState["trades"][number]["fromAssets"]): string[] =>
    assets.filter((a) => a.kind === "player" && a.playerId).map((a) => a.playerId!);

  const out = idsOf(t.fromAssets); // leaving fromTeam
  const back = idsOf(t.toAssets); // leaving toTeam
  const limit = rosterLimitFor(s.stage);

  for (const [code, gains, loses] of [
    [t.fromTeam, back, out],
    [t.toTeam, out, back],
  ] as const) {
    const team = s.teams[code];
    if (!team) return { ok: false, reason: "Unknown team." };
    const name = TEAMS_BY_CODE[code]?.abbr ?? code;

    const size = rosterCountOf(s, code) - loses.length + gains.length;
    if (size > limit) {
      return {
        ok: false,
        reason: `${name} would carry ${size} players, over the ${limit}-man limit. Even the trade up, or release someone first.`,
      };
    }

    const used = Math.round((team.cap.used - hitOf(loses) + hitOf(gains)) * 10) / 10;
    if (used > team.cap.total) {
      const over = Math.round((used - team.cap.total) * 10) / 10;
      return {
        ok: false,
        reason: `${name} would be $${over.toFixed(1)}M over the cap. Send back more salary, or take back less.`,
      };
    }
  }
  return { ok: true };
}

function applyTrade(s: LeagueState, t: LeagueState["trades"][number]): void {
  // a contract moves with the player: `team_id` used to keep pointing at the
  // team he just left
  const move = (assets: LeagueState["trades"][number]["fromAssets"], to: string): void => {
    for (const a of assets) {
      if (a.kind !== "player" || !a.playerId) continue;
      const p = s.players[a.playerId];
      if (!p) continue;
      p.nfl_team = to;
      if (p.contract) p.contract.team_id = to;
    }
  };
  move(t.fromAssets, t.toTeam);
  move(t.toAssets, t.fromTeam);
  recomputeTeamRatings(s);
}

function sbWonByHuman(s: LeagueState): boolean {
  const champ = s.bracket?.matchups.find((m) => m.round === "SB")?.winner ?? s.bracket?.champion;
  if (!champ) return false;
  return s.gms.some((g) => g.isHuman && g.teamCode === champ);
}

function finalizeSeason(s: LeagueState): void {
  if (s.history.some((h) => h.season === s.season)) return;
  s.history.push(...sim.finalizeSeasonOutcomes(s));
  // the year has been played, so every contract is a year shorter — and the
  // ones that just ran out hit the market in time for this offseason's window
  expireContracts(s);
  recomputeTeamRatings(s);
}

export function isInSeason(stage: Stage): boolean {
  return stage === "preseason" || stage === "regularSeason" || stage === "playoffs";
}

export { PRESEASON_WEEKS, REGULAR_SEASON_WEEKS, ROUND_ORDER };
