/**
 * AI Difficulty (07_AI_DIFFICULTY_SYSTEM_V1.md) — how competently a CPU GM
 * pursues its goals, never what it's allowed to do.
 *
 * Deliberately orthogonal to `aiStrategy.ts`: strategy answers "what kind of
 * roster does this GM want?", difficulty answers "how well does it search
 * for and evaluate the options in front of it?" A pass-heavy Casual AI and a
 * pass-heavy Expert AI want the same thing — Expert just makes fewer
 * mistakes finding and ranking it. Order of operations everywhere this is
 * wired in (spec §20): shared base value -> difficulty's search/noise limits
 * -> strategy preference -> hard roster/cap/legal constraints.
 *
 * Difficulty must never change league rules, ratings, cap, injury odds,
 * asking prices, or hidden information (rookie `trueOverall` above all) —
 * only how thoroughly and how accurately a CPU evaluates the same legal
 * options a human has.
 */
import type { Difficulty } from "@/domain";

export type { Difficulty as AiDifficulty };

export const AI_DIFFICULTY_LEVELS: readonly Difficulty[] = ["casual", "standard", "competitive", "expert", "master"];

export const AI_DIFFICULTY_LABEL: Record<Difficulty, string> = {
  casual: "Casual",
  standard: "Standard",
  competitive: "Competitive",
  expert: "Expert",
  master: "Master",
};

export const AI_DIFFICULTY_DESCRIPTION: Record<Difficulty, string> = {
  casual: "CPU GMs make more valuation and planning mistakes while following the same league rules.",
  standard: "Balanced CPU decision-making intended for normal play.",
  competitive: "CPU GMs search more thoroughly and make few valuation mistakes.",
  expert: "CPU GMs make no evaluation mistakes, with the same ratings-first judgment every level uses.",
  master:
    "The strongest CPU GMs the rules allow: they value players by what they are measured to be worth on the field, build complete units (lines, pass-rush pairs, a quarterback with his receivers) and never lose a trade. No rating, cap or rules advantages.",
};

export interface AiDifficultyProfile {
  /** Bounded deterministic score noise applied to fantasy-draft/FA/coach targets. */
  evaluationNoise: number;
  /** Rookie prospects already carry more visible uncertainty; noise is halved (§11). */
  rookieEvaluationNoise: number;
  coachEvaluationNoise: number;
  tradeEvaluationNoise: number;
  /** How many plausible candidates the CPU seriously evaluates; Infinity = all. */
  candidateDepth: number;
  /** Multiplier on existing future-value components (age, picks, contract years). */
  longTermWeight: number;
  /** Multiplier applied to the shared, calibrated need model — never exceeds 1.0. */
  needAwareness: number;
  /** How strongly future cap health is weighed (reserved for cap-aware call sites). */
  capPlanningWeight: number;
  /** Fraction of the rational chase ceiling below which a CPU may stop bidding early. */
  chaseCeilingFloor: number;
  /** Deterministic probability of failing to make an otherwise-rational rebid. */
  missedRebidRate: number;
  /** Deterministic variation applied to the trade-acceptance threshold. */
  tradeAcceptanceThresholdVariation: number;
  /**
   * How much a candidate's contribution to his team's *units* counts
   * (`unitValue.ts`): complete lines, paired rushers, QB and WR1, no weak
   * links — what the engine's synergy layer actually pays for. Zero below
   * Master, which is what separates it from Expert: Expert makes no
   * mistakes with the ratings-first model everyone uses; Master uses a
   * better model.
   */
  unitAwareness: number;
  /** Accept a trade only when it adds value — no coin-flip on a fair or losing deal. */
  strictTrades: boolean;
}

// §5-§9, §11-§15 tables.
const BASE_PROFILES: Record<Exclude<Difficulty, "master">, AiDifficultyProfile> = {
  casual: {
    unitAwareness: 0,
    strictTrades: false,
    evaluationNoise: 4.0,
    rookieEvaluationNoise: 2.0,
    coachEvaluationNoise: 3.0,
    tradeEvaluationNoise: 4.0,
    candidateDepth: 8,
    longTermWeight: 0.45,
    needAwareness: 0.75,
    capPlanningWeight: 0.5,
    chaseCeilingFloor: 0.85,
    missedRebidRate: 0.12,
    tradeAcceptanceThresholdVariation: 0.08,
  },
  standard: {
    unitAwareness: 0,
    strictTrades: false,
    evaluationNoise: 2.0,
    rookieEvaluationNoise: 1.0,
    coachEvaluationNoise: 1.5,
    tradeEvaluationNoise: 2.0,
    candidateDepth: 16,
    longTermWeight: 0.7,
    needAwareness: 0.9,
    capPlanningWeight: 0.75,
    chaseCeilingFloor: 0.92,
    missedRebidRate: 0.05,
    tradeAcceptanceThresholdVariation: 0.04,
  },
  competitive: {
    unitAwareness: 0,
    strictTrades: false,
    evaluationNoise: 0.8,
    rookieEvaluationNoise: 0.4,
    coachEvaluationNoise: 0.5,
    tradeEvaluationNoise: 0.75,
    candidateDepth: 32,
    longTermWeight: 0.9,
    needAwareness: 1.0,
    capPlanningWeight: 0.9,
    chaseCeilingFloor: 0.97,
    missedRebidRate: 0.01,
    tradeAcceptanceThresholdVariation: 0.015,
  },
  expert: {
    unitAwareness: 0,
    strictTrades: false,
    evaluationNoise: 0,
    rookieEvaluationNoise: 0,
    coachEvaluationNoise: 0,
    tradeEvaluationNoise: 0,
    candidateDepth: Infinity,
    longTermWeight: 1.0,
    needAwareness: 1.0,
    capPlanningWeight: 1.0,
    chaseCeilingFloor: 1.0,
    missedRebidRate: 0,
    tradeAcceptanceThresholdVariation: 0,
  },
};

/**
 * Master: Expert's search (every candidate, no noise) with a better
 * evaluator on top. Still bound by §1 — same rules, same ratings, same cap,
 * no hidden information; it wins by knowing what the engine rewards.
 */
export const DIFFICULTY_PROFILES: Record<Difficulty, AiDifficultyProfile> = {
  ...BASE_PROFILES,
  // Unit gains are in points of margin per game; at 80 the measured unit
  // model decides and the ratings-first score only breaks ties. Swept against
  // Expert-built teams from the same draft slot (online/test/ai-master):
  // 10 -> 54.0%, 30 -> 53.9%, 80 -> 56.0% over 320 games.
  master: { ...BASE_PROFILES.expert, unitAwareness: 80, strictTrades: true },
};

export function difficultyProfile(difficulty: Difficulty): AiDifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty];
}

/** FNV-1a over a string, for the deterministic-noise hash below. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * §5: deterministic, centered noise in [-1, +1) keyed on the decision's own
 * canonical state — never on click order, screen re-opens, or presentation.
 * The same team/season/decision/candidate always gets the same unit, so a
 * save/reload or a re-opened screen cannot reroll it, and it is stable
 * against a resubmitted-with-a-trivial-change probe (the exploit audit's
 * "predictable valuation errors" check) as long as callers key `candidateId`
 * and `decisionIndex` on the canonical transaction, not on incidental state.
 */
export function deterministicNoiseUnit(
  teamCode: string,
  season: number,
  decisionType: string,
  candidateId: string,
  decisionIndex = 0,
): number {
  const h = hashString(`${teamCode}|${season}|${decisionType}|${candidateId}|${decisionIndex}`);
  return (h % 2_000_000) / 1_000_000 - 1; // [-1, 1)
}

/**
 * §6/§16: narrows `items` to the top `depth` by `baseScore` before any
 * strategy/noise term is applied, so a lower difficulty can miss the
 * globally-best candidate because it never seriously considered it — not
 * because it mis-ranked something outside its search. `depth === Infinity`
 * (Expert) returns every item, doing no work.
 */
export function shortlistByBaseScore<T>(items: readonly T[], baseScore: (item: T) => number, depth: number): T[] {
  if (!Number.isFinite(depth) || depth >= items.length) return [...items];
  // a bounded top-K insertion rather than a full sort: cheap even when this
  // runs once per remaining pick of a 20-round, 32-team fantasy draft.
  const top: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = baseScore(item);
    if (top.length < depth) {
      top.push({ item, score });
      if (top.length === depth) top.sort((a, b) => a.score - b.score);
    } else if (score > top[0]!.score) {
      top[0] = { item, score };
      // re-establish ascending order after replacing the current minimum;
      // depth is small (8/16/32) so a full re-sort here is negligible.
      top.sort((a, b) => a.score - b.score);
    }
  }
  return top.map((t) => t.item);
}

/**
 * §15 hard floor/ceiling: no difficulty may accept a catastrophic offer or
 * reject an obviously excellent one, whatever the threshold variation says.
 */
export function clampTradeAcceptance(likelihood: number): number {
  if (likelihood < 0.2) return 0;
  if (likelihood > 0.85) return 1;
  return likelihood;
}
