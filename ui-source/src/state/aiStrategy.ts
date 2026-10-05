/**
 * AI GM season strategies (06_AI_GM_SEASON_STRATEGY_SYSTEM_V1.md).
 *
 * 29 AI-controlled teams used to share one objective function everywhere:
 * best-player-available + need at the draft, biggest raw OVR gain in free
 * agency, highest-rated coach at any vacancy, shared value + need in trades,
 * weakest group at Training Camp. Rational, but it makes every AI GM read
 * the same. A season strategy is a small, bounded bias on top of that shared
 * evaluator — *which* near-equivalent winning decision an AI prefers, never
 * a reason to take a clearly worse one. Every AI GM still tries to win;
 * strategy creates diversity, not irrationality.
 *
 * Deterministic per team + season (a stable hash, no persisted state): the
 * same league replayed, or reloaded from a save, assigns the same strategy,
 * and a multiplayer server and every client derive it independently without
 * agreeing on anything first.
 */
import type { CoachRole, Position } from "@/domain";
import type { OffensiveFocus, DefensiveFocus } from "./trainingCamp.ts";

export const AI_SEASON_STRATEGIES = [
  "balanced",
  "offense_heavy",
  "defense_heavy",
  "pass_heavy",
  "run_heavy",
  "high_floor",
  "high_ceiling",
  "trenches_first",
] as const;
export type AiSeasonStrategy = (typeof AI_SEASON_STRATEGIES)[number];

export const AI_STRATEGY_LABEL: Record<AiSeasonStrategy, string> = {
  balanced: "Balanced",
  offense_heavy: "Offense Heavy",
  defense_heavy: "Defense Heavy",
  pass_heavy: "Pass Heavy",
  run_heavy: "Run Heavy",
  high_floor: "High Floor",
  high_ceiling: "High Ceiling",
  trenches_first: "Trenches First",
};

/**
 * Deterministic hash of `teamCode|season`, so no seed or persisted field is
 * needed and a save/reload or a second client can't reroll it.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Same team + same season -> same strategy, every time, everywhere. */
export function strategyFor(teamCode: string, season: number): AiSeasonStrategy {
  const h = hashString(`${teamCode}|${season}`);
  return AI_SEASON_STRATEGIES[h % AI_SEASON_STRATEGIES.length]!;
}

export interface AiStrategyProfile {
  positionBonus: Partial<Record<Position, number>>;
  agePreference: number;
  elitePreference: number;
  needPreference: number;
  futurePreference: number;
  offenseCoachBonus: number;
  defenseCoachBonus: number;
}

const NEUTRAL: AiStrategyProfile = {
  positionBonus: {},
  agePreference: 0,
  elitePreference: 0,
  needPreference: 0,
  futurePreference: 0,
  offenseCoachBonus: 0,
  defenseCoachBonus: 0,
};

/** §4 strategy definitions — bounded player-choice score adjustments. */
export const STRATEGY_PROFILES: Record<AiSeasonStrategy, AiStrategyProfile> = {
  balanced: NEUTRAL,
  offense_heavy: {
    ...NEUTRAL,
    positionBonus: { QB: 3, RB: 2, WR: 3, TE: 2, OT: 2, OG: 1, C: 1 },
    offenseCoachBonus: 3,
  },
  defense_heavy: {
    ...NEUTRAL,
    positionBonus: { EDGE: 3, DT: 2, ILB: 2, OLB: 1, CB: 3, S: 3 },
    defenseCoachBonus: 3,
  },
  pass_heavy: {
    ...NEUTRAL,
    positionBonus: { QB: 4, WR: 3, TE: 2, OT: 2, OG: 1, C: 1, RB: -1, CB: 1, EDGE: 1 },
    offenseCoachBonus: 3,
  },
  run_heavy: {
    ...NEUTRAL,
    positionBonus: { RB: 4, OT: 3, OG: 3, C: 2, TE: 2, QB: 0, WR: -1, DT: 1, ILB: 1 },
    offenseCoachBonus: 2,
  },
  high_floor: {
    ...NEUTRAL,
    agePreference: -1,
    elitePreference: -1,
    needPreference: 2,
    futurePreference: -1,
  },
  high_ceiling: {
    ...NEUTRAL,
    agePreference: 1,
    elitePreference: 2,
    needPreference: -1,
    futurePreference: 2,
  },
  trenches_first: {
    ...NEUTRAL,
    positionBonus: {
      OT: 4,
      OG: 3,
      C: 3,
      EDGE: 4,
      DT: 3,
      QB: 1,
      RB: 1,
      TE: 1,
      ILB: 1,
      OLB: 1,
    },
    offenseCoachBonus: 1,
    defenseCoachBonus: 1,
  },
};

/** §5/§7/§8: additive score bonus by position, at a strategy's own scale. */
export function strategyPositionBonus(
  strategy: AiSeasonStrategy,
  position: Position,
  scale = 1,
): number {
  return (STRATEGY_PROFILES[strategy].positionBonus[position] ?? 0) * scale;
}

/** §4.6/§4.7 age preference tables — 0 for every strategy without one. */
export function strategyAgeBonus(strategy: AiSeasonStrategy, age: number): number {
  if (strategy === "high_floor") {
    if (age <= 24) return -2;
    if (age >= 30) return 1;
    return 0;
  }
  if (strategy === "high_ceiling") {
    if (age <= 24) return 2;
    if (age <= 27) return 1;
    if (age <= 29) return 0;
    return -2;
  }
  return 0;
}

/** §4.7 elite-player term — only high-ceiling reaches for stars. */
export function strategyEliteBonus(strategy: AiSeasonStrategy, overall: number): number {
  if (strategy !== "high_ceiling") return 0;
  if (overall >= 90) return 2;
  if (overall >= 85) return 1;
  return 0;
}

/** §5 draft need adjustment — high-floor leans into need, high-ceiling away from it. */
export function strategyNeedAdjustment(strategy: AiSeasonStrategy, rawNeed: number): number {
  if (strategy === "high_floor") return Math.min(3, rawNeed * 0.08);
  if (strategy === "high_ceiling") return -Math.min(2, rawNeed * 0.05);
  return 0;
}

/** §6 coaching-draft / coach-hiring role bonuses. */
export function strategyCoachBonus(strategy: AiSeasonStrategy, role: CoachRole): number {
  switch (strategy) {
    case "offense_heavy":
      if (role === "OC") return 3;
      if (role === "QB" || role === "RB" || role === "OL" || role === "WR") return 1;
      return 0;
    case "defense_heavy":
      if (role === "DC") return 3;
      if (role === "DL" || role === "LB" || role === "DB") return 1;
      return 0;
    case "pass_heavy":
      if (role === "OC") return 3;
      if (role === "QB" || role === "WR") return 2;
      if (role === "OL") return 1;
      return 0;
    case "run_heavy":
      if (role === "OC") return 2;
      if (role === "RB") return 2;
      if (role === "OL") return 3;
      return 0;
    case "trenches_first":
      if (role === "OL") return 3;
      if (role === "DL") return 3;
      if (role === "OC" || role === "DC") return 1;
      return 0;
    case "high_floor":
      if (role === "HC") return 2;
      if (role === "MED") return 1;
      return 0;
    case "high_ceiling":
      if (role === "QB" || role === "RB" || role === "OL" || role === "WR" || role === "DL" || role === "LB" || role === "DB")
        return 1;
      return 0;
    case "balanced":
    default:
      return 0;
  }
}

/** §10 draft-pick preference multiplier — for ranking only, never the canonical chart. */
export function strategyPickValueMultiplier(strategy: AiSeasonStrategy): number {
  if (strategy === "high_floor") return 0.92;
  if (strategy === "high_ceiling") return 1.1;
  return 1.0;
}

/**
 * §8.2 bounded trade-acceptance preference shift, capped at ±0.05 total.
 * `incoming` describes what the accepting team is receiving; `incomingPicks`
 * whether any of it is a future (not-this-season) pick.
 */
export function strategyTradeAcceptanceShift(
  strategy: AiSeasonStrategy,
  incoming: { position: Position; age: number }[],
  incomingHasFuturePick: boolean,
): number {
  let shift = 0;
  if (strategy === "pass_heavy") {
    if (incoming.some((p) => p.position === "QB" || p.position === "WR" || p.position === "OT")) shift += 0.04;
  } else if (strategy === "run_heavy") {
    if (incoming.some((p) => p.position === "RB" || p.position === "OT" || p.position === "OG" || p.position === "C"))
      shift += 0.04;
  } else if (strategy === "high_ceiling") {
    if (incoming.some((p) => p.age <= 24)) shift += 0.04;
    if (incomingHasFuturePick) shift += 0.03;
  } else if (strategy === "high_floor") {
    if (incoming.some((p) => p.age >= 31)) shift += 0.02;
    if (incomingHasFuturePick) shift -= 0.02;
  }
  return Math.max(-0.05, Math.min(0.05, shift));
}

export type AiSeasonPosture = "buyer" | "neutral" | "seller";

/** §9 trade-deadline posture from record/playoff odds, before strategy nudges it. */
export function basePosture(winPct: number, playoffOdds: number | null): AiSeasonPosture {
  if (winPct >= 0.6 || (playoffOdds !== null && playoffOdds >= 0.65)) return "buyer";
  if (winPct <= 0.4 && (playoffOdds === null || playoffOdds <= 0.3)) return "seller";
  return "neutral";
}

const POSTURE_ORDER: AiSeasonPosture[] = ["seller", "neutral", "buyer"];

/** Strategy moves posture at most one step (never seller<->buyer directly). */
export function strategyPosture(strategy: AiSeasonStrategy, base: AiSeasonPosture): AiSeasonPosture {
  const i = POSTURE_ORDER.indexOf(base);
  if (strategy === "high_floor") return POSTURE_ORDER[Math.min(2, i + 1)]!;
  if (strategy === "high_ceiling") return POSTURE_ORDER[Math.max(0, i - 1)]!;
  return base;
}

/** §11 Training Camp group-focus bonus, keyed by the coordinator group id. */
export function strategyGroupBonus(strategy: AiSeasonStrategy, group: OffensiveFocus | DefensiveFocus): number {
  switch (strategy) {
    case "pass_heavy":
      return { QB: 4, WR: 3, OL: 2, RB: 0, DL: 0, LB: 0, DB: 0 }[group] ?? 0;
    case "run_heavy":
      return { OL: 4, RB: 4, WR: 0, QB: 0, DL: 0, LB: 0, DB: 0 }[group] ?? 0;
    case "trenches_first":
      return { OL: 4, DL: 4, QB: 0, RB: 0, WR: 0, LB: 0, DB: 0 }[group] ?? 0;
    case "defense_heavy":
      return { DB: 3, DL: 2, LB: 2, QB: 0, RB: 0, WR: 0, OL: 0 }[group] ?? 0;
    default:
      return 0;
  }
}

/** §11 high-floor's flat multiplier on the weakness score itself. */
export function strategyWeaknessMultiplier(strategy: AiSeasonStrategy): number {
  return strategy === "high_floor" ? 1.1 : 1.0;
}

/**
 * How a GM's identity reads in the app: what they prioritize, in plain words.
 * A CPU GM's identity is public (a person's is private); it is a preference,
 * never a promise, since every GM still tries to win.
 */
export const AI_STRATEGY_IDENTITY: Record<AiSeasonStrategy, { label: string; headline: string }> = {
  balanced: { label: "Balanced", headline: "No strong preference: takes the best player and the biggest need" },
  offense_heavy: { label: "Offense first", headline: "Prioritizes the offense" },
  defense_heavy: { label: "Defense first", headline: "Prioritizes the defense" },
  pass_heavy: { label: "Prioritizes the pass", headline: "Prioritizes the pass: quarterback, receivers, protection" },
  run_heavy: { label: "Prioritizes the run", headline: "Prioritizes the run: backs, linemen, tight ends" },
  high_floor: { label: "High floor", headline: "Prioritizes a high floor: proven, steady, no big swings" },
  high_ceiling: { label: "High ceiling", headline: "Prioritizes upside: stars and young talent, accepts the risk" },
  trenches_first: { label: "Trenches first", headline: "Prioritizes the trenches: both lines before anything else" },
};

/** The positions a strategy pays up for, best first (from its profile). */
export function prioritizedPositions(strategy: AiSeasonStrategy, limit = 4): Position[] {
  return (Object.entries(STRATEGY_PROFILES[strategy].positionBonus) as [Position, number][])
    .filter(([, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([p]) => p);
}
