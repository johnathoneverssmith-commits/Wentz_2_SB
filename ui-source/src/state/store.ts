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
  type ContractOffer,
  type DraftMode,
  type FreeAgencyState,
  type LeagueConfig,
  type LeagueState,
  type Player,
  type Position,
  type Stage,
} from "@/domain";
import { TEAMS } from "@/data/teams";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { contractValueFor } from "@/sim/MockSimulationService";
import { coachPriorities, playerPriorities } from "@/sim/priorities";

import { createLeague, recomputeTeamRatings } from "./seed.ts";
import {
  PRESEASON_WEEKS,
  REGULAR_SEASON_WEEKS,
  resolveTransition,
  STAGE_HOME,
} from "./stageMachine.ts";
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
  placeOffer: (subject: Subject, id: string, offer: ContractOffer) => void;
  advanceBiddingDay: (subject: Subject) => void;
  dismissInterstitial: (subject: Subject) => void;

  /** in-season standing FA market: sign a free agent immediately. */
  signStandingFreeAgent: (playerId: string, offer: ContractOffer) => void;

  signRookie: (prospectId: string, teamCode: string) => void;
  releaseRookie: (prospectId: string, teamCode: string) => void;

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
            const players: Record<string, Player> = {};
            for (const p of pool) players[p.id] = p;
            s.players = players;
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
            s.draftClass = sim.generateDraftClass(s.season, s.season);
            for (const code of Object.keys(s.teams)) {
              const team = s.teams[code]!;
              team.wins = team.losses = team.ties = 0;
              team.pointsFor = team.pointsAgainst = 0;
              team.playoffSeed = 0;
            }
            s.schedule = newSchedule!;
          }

          // leaving the fantasy draft → undrafted players seed the standing FA market
          if (s.stage === "fantasyDraft" && t.stage === "fantasyDraftSummary") {
            openStandingMarketFromUndrafted(s);
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
          const humanCodes = s.gms.filter((g) => g.isHuman).map((g) => g.teamCode);
          const aiCodes = Object.keys(s.teams).filter((c) => !humanCodes.includes(c));
          let base = [...humanCodes];
          if (s.config.draftOrder === "randomized") base = shuffle(base, s.season + 7);
          const fullFirstRound = [...base, ...shuffle(aiCodes, s.season + 11)];
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

      autopickRemaining: () =>
        set((s) => {
          if (!s.draft) return;
          let guard = 0;
          while (s.draft.currentPickIndex < s.draft.pickOrder.length && guard++ < 6000) {
            const pick = bestAvailable(s);
            if (!pick) break;
            applyPick(s, pick);
          }
        }),

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
            // offseason player FA: last-year contracts + anyone currently a FA
            const pool = Object.values(s.players).filter(
              (p) => !p.retired && (p.free_agent || (p.contract && p.contract.years_remaining <= 1)),
            );
            for (const p of pool.slice(0, 160)) {
              p.free_agent = true;
              p.contract = null;
              p.nfl_team = "FA";
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

      placeOffer: (subject, id, offer) =>
        set((s) => {
          const fa = s[faField(subject)];
          if (!fa) return;
          const list = (fa.bids[id] ??= []);
          const mine = list.findIndex((o) => o.teamCode === offer.teamCode);
          if (mine >= 0) list[mine] = offer;
          else list.push(offer);
        }),

      advanceBiddingDay: (subject) =>
        set((s) => {
          const fa = s[faField(subject)];
          if (!fa || fa.mode !== "main") return;
          resolveBiddingDay(s, subject, fa);
          if (fa.day >= 5) {
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

      signStandingFreeAgent: (playerId, offer) =>
        set((s) => {
          const p = s.players[playerId];
          if (!p || !p.free_agent) return;
          p.free_agent = false;
          p.nfl_team = offer.teamCode;
          p.contract = offerToContract(offer);
          s.standingFreeAgents = s.standingFreeAgents.filter((x) => x !== playerId);
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
            status: needsVote ? "pending" : "draft",
          });
        });
        return id;
      },

      castTradeVote: (tradeId, gmId, vote) =>
        set((s) => {
          const t = s.trades.find((x) => x.id === tradeId);
          if (!t?.vote) return;
          t.vote.votes[gmId] = vote;
          for (const g of s.gms) {
            if (g.isHuman && g.id !== gmId && t.vote.votes[g.id] == null) {
              t.vote.votes[g.id] = t.aiValueDelta >= -3 ? "for" : "against";
            }
          }
          const vals = Object.values(t.vote.votes);
          const forN = vals.filter((v) => v === "for").length;
          const againstN = vals.filter((v) => v === "against").length;
          t.vote.outcome = forN > againstN ? "passed" : "blocked";
          t.status = t.vote.outcome === "passed" ? "accepted" : "blocked";
          if (t.status === "accepted") applyTrade(s, t);
        }),

      resolveTrade: (tradeId) =>
        set((s) => {
          const t = s.trades.find((x) => x.id === tradeId);
          if (!t || t.status !== "draft") return;
          const accepted = t.aiAcceptLikelihood >= 0.5;
          t.status = accepted ? "accepted" : "rejected";
          if (accepted) applyTrade(s, t);
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
  const round = Math.floor(idx / s.gms.length) + 1;
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
    if (p) p.nfl_team = teamCode;
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
  if (d.mode === "rookie") {
    const p = [...s.draftClass]
      .filter((x) => !taken.has(x.id))
      .sort((a, b) => {
        const scoreB = b.collegeOverall + (teamCode ? positionalNeed(s, teamCode, b.position) * NEED_WEIGHT : 0);
        const scoreA = a.collegeOverall + (teamCode ? positionalNeed(s, teamCode, a.position) * NEED_WEIGHT : 0);
        return scoreB - scoreA;
      })[0];
    return p?.id ?? null;
  }
  const p = Object.values(s.players)
    .filter((x) => !taken.has(x.id) && !x.retired)
    .sort((a, b) => {
      const scoreB = b.overall + (teamCode ? positionalNeed(s, teamCode, b.position) * NEED_WEIGHT : 0);
      const scoreA = a.overall + (teamCode ? positionalNeed(s, teamCode, a.position) * NEED_WEIGHT : 0);
      return scoreB - scoreA;
    })[0];
  return p?.id ?? null;
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
    for (let i = 0; i < signCount; i++) {
      const p = pool[Math.floor(rng() * pool.length)];
      if (!p || fa.signed.some((x) => x.id === p.id)) continue;
      const winning = bestOfferFor(fa, "players", p.id, s) ?? aiOfferForPlayer(rng, s, p);
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

function applyTrade(s: LeagueState, t: LeagueState["trades"][number]): void {
  for (const a of t.fromAssets) {
    if (a.kind === "player" && a.playerId && s.players[a.playerId]) {
      s.players[a.playerId]!.nfl_team = t.toTeam;
    }
  }
  for (const a of t.toAssets) {
    if (a.kind === "player" && a.playerId && s.players[a.playerId]) {
      s.players[a.playerId]!.nfl_team = t.fromTeam;
    }
  }
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
}

export function isInSeason(stage: Stage): boolean {
  return stage === "preseason" || stage === "regularSeason" || stage === "playoffs";
}

export { PRESEASON_WEEKS, REGULAR_SEASON_WEEKS, ROUND_ORDER };
