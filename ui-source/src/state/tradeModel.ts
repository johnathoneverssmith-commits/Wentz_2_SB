/**
 * How a team reads a trade, in one place: the single decision every channel uses.
 *
 * A person asking a CPU team, the CPU teams answering one another at the deadline, a person's staff answering for them and the
 * league server all ask the same question of the same model (`judgeTrade`) and read the answer the same way (`tradeAccepts`).
 * Before this the deadline rolled a die against the likelihood, the staff wanted 0.55 and everything else took 0.5.
 *
 * The model has three parts, in order:
 *
 * 1. **The chart.** Every asset has one price (`tradeAssetValue`): rating, position, age, fitness and what is left of his contract
 *    (`playerContractValue`, built on B2b's projection of his decline and retirement). That is the number the trade screen shows.
 * 2. **The team's own reading of it.** A rebuilding team prices picks and young players up and veterans past their decline down; a
 *    contender the reverse, and a team already near the cap prices salary it would take on. All bounded, all scaled by the GM's
 *    planning (`longTermWeight`) so an easier GM reads its situation less sharply.
 * 3. **Need, strategy, difficulty.** What the roster is short of, the GM's identity, and the difficulty's deterministic shift, all as
 *    they were.
 *
 * A bad contract can be worth less than nothing, so a team taking one on wants paying, but relief is worth half its cost to the team
 * shedding it (`LIABILITY_RELIEF`): that is what stops "absorb a bad contract for a pick, then cut him" being a way to make picks.
 *
 * Deterministic: nothing here draws a random number. The same offer to the same league gives the same answer on every machine.
 */
import type { LeagueState, Player, Position, TradeAsset } from "@/domain";
import { isFranchiseQb, packageValue, tradeAssetValue } from "@/sim/MockSimulationService";
import type { TradeEvaluation } from "@/sim/SimulationService.ts";

import { clampTradeAcceptance, deterministicNoiseUnit } from "./aiDifficulty.ts";
import { difficultyFor, strategyOf } from "./aiGms.ts";
import { strategyTradeAcceptanceShift } from "./aiStrategy.ts";
import { windowEffect } from "./draftBoard.ts";
import { readTeamTimeline } from "./teamTimeline.ts";

/** The likelihood at which a team says yes. One number for every channel. */
export const TRADE_ACCEPT_THRESHOLD = 0.5;
export const tradeAccepts = (likelihood: number): boolean => likelihood >= TRADE_ACCEPT_THRESHOLD;

/** Relief from shedding a liability, as a share of what taking it on costs. */
export const LIABILITY_RELIEF = 0.5;

/**
 * What a team wants over and above an even trade, on its own reading: this share of the larger side, and a point. A CPU team does not
 * make a trade for nothing, and one that did would let a person trade the same assets round a league of teams that price them a little
 * differently and keep the gap.
 */
export const TRADE_FRICTION = 0.05;

/** The share of a team's cap past which taking on salary starts to cost it flexibility, and the points it costs at the cap itself. */
export const FLEX_START = 0.93;
export const FLEX_POINTS = 12;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

type Held = { id: string; overall: number };

/** What a run of judgements about one league shares: the teams' windows, their rosters by position and the chart's prices. */
export interface TradeContext {
  readonly state: LeagueState;
  /** each team's window, -1 (rebuilding) to +1 (contending) */
  windowOf(team: string): number;
  /** the chart's price of an asset */
  chart(a: TradeAsset): number;
  /** the best rating a team has at a position, leaving out some players (their roster as it would stand after they leave) */
  bestAt(team: string, pos: Position | undefined, exclude: ReadonlySet<string>): number;
}

export const assetKey = (a: TradeAsset): string =>
  a.kind === "player" ? `p:${a.playerId}` : `k:${a.pick?.year}.${a.pick?.round}.${a.pick?.originalTeam}`;

export function tradeContext(state: LeagueState): TradeContext {
  let windows: Map<string, number> | null = null;
  let rosters: Map<string, Map<Position, Held[]>> | null = null;
  const prices = new Map<string, number>();
  return {
    state,
    windowOf(team) {
      windows ??= readTeamTimeline(state);
      return windows.get(team) ?? 0;
    },
    chart(a) {
      const k = assetKey(a);
      let v = prices.get(k);
      if (v === undefined) prices.set(k, (v = tradeAssetValue(state, a)));
      return v;
    },
    bestAt(team, pos, exclude) {
      if (!pos) return 0;
      if (!rosters) {
        rosters = new Map();
        for (const p of Object.values(state.players)) {
          if (p.retired) continue;
          let byPos = rosters.get(p.nfl_team);
          if (!byPos) rosters.set(p.nfl_team, (byPos = new Map()));
          const l = byPos.get(p.position);
          if (l) l.push({ id: p.id, overall: p.overall });
          else byPos.set(p.position, [{ id: p.id, overall: p.overall }]);
        }
      }
      let best = 0;
      for (const h of rosters.get(team)?.get(pos) ?? []) if (!exclude.has(h.id) && h.overall > best) best = h.overall;
      return best;
    },
  };
}

/**
 * What an asset is worth to this team in particular. A rebuild wants the future: picks and the young are worth more to it, a
 * veteran past his decline age less. A contender wants this year: picks are worth less to it and a starter-grade veteran more.
 * Only positive values are moved; a liability is a liability to everyone.
 */
export function teamAssetMultiplier(state: LeagueState, a: TradeAsset, fx: number): number {
  const rebuild = Math.max(0, -fx);
  const contend = Math.max(0, fx);
  // small on purpose: a team that prices a pick above the chart and another below it hands a person the difference for buying from
  // one and selling to the other, and `TRADE_FRICTION` has to be more than that gap
  if (a.kind === "pick") return clamp(1 + 0.05 * rebuild - 0.03 * contend, 0.9, 1.1);
  const p = state.players[a.playerId ?? ""];
  if (!p) return 1;
  let m: number;
  if (p.age <= 25) m = 1 + 0.05 * rebuild - 0.02 * contend;
  else if (p.age >= p.decline_age_threshold) m = 1 - 0.08 * rebuild + 0.01 * contend;
  else if (p.age >= 29) m = 1 - 0.04 * rebuild + 0.03 * contend;
  else m = 1;
  // a contender's starter-grade players, in their prime
  if (p.overall >= 80 && p.age < p.decline_age_threshold) m += 0.03 * contend;
  return clamp(m, 0.85, 1.12);
}

/** Points a team gives up for taking on salary when it is already close to the cap, and gains by shedding some then. */
function flexibilityPoints(state: LeagueState, team: string, incoming: readonly TradeAsset[], outgoing: readonly TradeAsset[]): number {
  const t = state.teams[team];
  if (!t || t.cap.total <= 0) return 0;
  const hit = (assets: readonly TradeAsset[]): number =>
    assets.reduce((n, a) => n + (a.kind === "player" ? (state.players[a.playerId ?? ""]?.contract?.cap_hit_by_year[0] ?? 0) : 0), 0);
  const net = hit(incoming) - hit(outgoing);
  const after = (t.cap.used + net) / t.cap.total;
  const pressure = clamp((after - FLEX_START) / (1 - FLEX_START), 0, 1);
  if (pressure === 0) return 0;
  return net > 0 ? FLEX_POINTS * pressure : -0.4 * FLEX_POINTS * pressure;
}

export function judgeWith(
  ctx: TradeContext,
  _fromTeam: string,
  toTeam: string,
  fromAssets: TradeAsset[],
  toAssets: TradeAsset[],
  /** `friction: false` asks whether the team would break even on its own reading, for a team that is making an offer rather than answering one */
  opts: { friction?: boolean } = {},
): TradeEvaluation {
  const state = ctx.state;
  const chart = (a: TradeAsset): number => ctx.chart(a);
  // fromAssets: what the proposer gives up (toTeam receives them); toAssets: what toTeam gives up. Each side is a package.
  const out = packageValue(state, fromAssets, chart);
  const inn = packageValue(state, toAssets, chart);
  // pure chart value, positive = good for the proposer: the number the trade screen shows, so it is not the decision's number
  const delta = round1(inn - out);

  // A team doesn't sell its franchise quarterback. The one exception is a swap for another quarterback of the same class, so two
  // teams can trade starters; picks, prospects and depth never buy one.
  const franchiseGiven = toAssets
    .map((a) => (a.kind === "player" ? state.players[a.playerId ?? ""] : undefined))
    .filter((p): p is Player => !!p && isFranchiseQb(state, p));
  if (franchiseGiven.length > 0) {
    const best = Math.max(...franchiseGiven.map((p) => p.overall));
    const getsComparable = fromAssets.some((a) => {
      const q = a.kind === "player" ? state.players[a.playerId ?? ""] : undefined;
      return !!q && q.position === "QB" && q.overall >= best - 4 && q.age <= 34;
    });
    if (!getsComparable) {
      return {
        valueDelta: delta,
        acceptLikelihood: 0,
        refusal: `${franchiseGiven[0]!.name} is their franchise quarterback. They won't trade him for anything but another franchise quarterback.`,
      };
    }
  }

  const difficulty = difficultyFor(state, toTeam);
  const cpu = state.teams[toTeam]?.controlledBy.kind === "ai";

  // the team's own reading of the chart: its window, and what the salary does to its room
  let teamDelta = delta;
  if (cpu) {
    const fx = windowEffect(ctx.windowOf(toTeam), difficulty.longTermWeight);
    const mine = (a: TradeAsset): number => {
      const v = chart(a);
      return v > 0 ? v * teamAssetMultiplier(state, a, fx) : v;
    };
    const received = packageValue(state, fromAssets, mine, 1);
    const given = packageValue(state, toAssets, mine, LIABILITY_RELIEF);
    teamDelta = given - received + flexibilityPoints(state, toTeam, fromAssets, toAssets) + (opts.friction === false ? 0 : TRADE_FRICTION * Math.max(given, received) + 1);
  }

  // OQ-9: a player who fills an actual hole on toTeam's roster is worth more to them than his overall alone says, and a player leaving a
  // position toTeam is already thin at costs them more than his overall says.
  const needAt = (team: string, pos: Position | undefined, exclude: ReadonlySet<string>): number =>
    pos ? Math.max(1, 78 - (ctx.bestAt(team, pos, exclude) || 40)) : 0;
  const none = new Set<string>();
  // (a player the chart prices at or below nothing fills no hole: a bad contract is not a need)
  const useful = (a: TradeAsset): boolean => a.kind === "player" && chart(a) > 0;
  const needGained = fromAssets.reduce((s, a) => s + (useful(a) ? needAt(toTeam, state.players[a.playerId ?? ""]?.position, none) : 0), 0);
  // measured on their roster after every departing player leaves: losing your only starter at a position is a real cost
  const departing = new Set(toAssets.flatMap((a) => (a.kind === "player" && a.playerId ? [a.playerId] : [])));
  const needLost = toAssets.reduce((s, a) => s + (useful(a) ? needAt(toTeam, state.players[a.playerId ?? ""]?.position, departing) : 0), 0);

  // AI GM season strategy: a bounded preference shift on top of the base model, never enough on its own to turn a clearly bad deal attractive
  const strategy = strategyOf(state, toTeam);
  const incoming = fromAssets
    .filter((a) => a.kind === "player" && a.playerId)
    .map((a) => state.players[a.playerId!])
    .filter((p): p is Player => !!p)
    .map((p) => ({ position: p.position, age: p.age }));
  const incomingHasFuturePick = fromAssets.some((a) => a.kind === "pick" && a.pick && a.pick.year > state.season);
  const strategyShift = strategyTradeAcceptanceShift(strategy, incoming, incomingHasFuturePick);

  // AI Difficulty: a deterministic shift to the acceptance threshold, keyed on the canonical asset sets so reordering the same offer
  // can never reroll it
  const canonical = (assets: TradeAsset[]): string => assets.map(assetKey).sort().join(",");
  const tradeKey = `${canonical(fromAssets)}|${canonical(toAssets)}`;
  const thresholdShift =
    difficulty.tradeAcceptanceThresholdVariation === 0
      ? 0
      : deterministicNoiseUnit(toTeam, state.season, "trade_accept", tradeKey) * difficulty.tradeAcceptanceThresholdVariation;

  const raw = clamp(0.5 - teamDelta / 36 + (needGained - needLost) / 90 + strategyShift + thresholdShift, 0.02, 0.98);
  // Master: no coin flip. It takes a deal only when the deal helps it, its value side and its need side together, with a small margin
  const strictGain = -teamDelta / 36 + (needGained - needLost) / 90;
  const acceptance = difficulty.strictTrades ? (strictGain > 0.03 ? 1 : 0) : clampTradeAcceptance(raw);

  return { valueDelta: delta, acceptLikelihood: acceptance };
}

/** The decision for one offer: `evaluateTrade`, and everything that answers a trade, comes through here. */
export function judgeTrade(state: LeagueState, fromTeam: string, toTeam: string, fromAssets: TradeAsset[], toAssets: TradeAsset[]): TradeEvaluation {
  return judgeWith(tradeContext(state), fromTeam, toTeam, fromAssets, toAssets);
}
