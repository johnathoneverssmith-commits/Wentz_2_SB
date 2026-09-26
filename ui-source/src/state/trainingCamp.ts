import type { LeagueState } from "@/domain";
import { COACH_POSITION_GROUPS } from "@/domain";
import { Rng } from "@/sim/rng";
import { agingDelta } from "@/sim/MockSimulationService";
import { agingBalance } from "./draftSupply";

import { applyCoachToDelta, coachModifiersFor } from "./coachEffects";
import { ratingOf } from "./coachingDraft";
import { strategyFor, strategyGroupBonus, strategyWeaknessMultiplier } from "./aiStrategy.ts";
import { deterministicNoiseUnit, difficultyProfile } from "./aiDifficulty.ts";

/**
 * Training camp: where a season's development actually happens.
 *
 * Three things stack, in this order, and the order is the whole design:
 *
 *   1. the aging model decides whether a player improves, declines or holds;
 *   2. his position coach scales that;
 *   3. if his group was one of the two the coordinators focused on, the focus
 *      scales it again.
 *
 * Nothing downstream may change the *direction* the aging model chose. A
 * focus makes a developing player develop more and a declining player decline
 * less — it never keeps a 34-year-old improving. That rule is what stops
 * coaching from becoming a way to opt out of age.
 */

/** The four things an offensive coordinator can concentrate on. */
export const OFFENSIVE_FOCUSES = ["QB", "RB", "OL", "WR"] as const;
/** And the three defensive ones. */
export const DEFENSIVE_FOCUSES = ["DL", "LB", "DB"] as const;

export type OffensiveFocus = (typeof OFFENSIVE_FOCUSES)[number];
export type DefensiveFocus = (typeof DEFENSIVE_FOCUSES)[number];

export const FOCUS_LABEL: Record<OffensiveFocus | DefensiveFocus, string> = {
  QB: "Quarterbacks",
  RB: "Running backs",
  OL: "Offensive line",
  WR: "Receivers and tight ends",
  DL: "Defensive line and edge",
  LB: "Linebackers",
  DB: "Defensive backs",
};

export interface TrainingCampPlan {
  offensiveFocus: OffensiveFocus | null;
  defensiveFocus: DefensiveFocus | null;
  submitted: boolean;
}

export interface TrainingCampResult {
  playerId: string;
  position: string;
  previous: number;
  delta: number;
  next: number;
}

export interface TrainingCampState {
  plans: Record<string, TrainingCampPlan>;
  results: Record<string, TrainingCampResult[]>;
  /** The season these plans and results belong to. */
  season?: number;
}

export function emptyPlan(): TrainingCampPlan {
  return {
    offensiveFocus: null,
    defensiveFocus: null,
    submitted: false,
  };
}

/**
 * Open this season's camp — once per season.
 *
 * It used to open once *ever*: the state was created the first time and
 * never cleared, so from the second season on every team read as having
 * already run camp. The viewer's screen said "You already ran camp this
 * season" over last year's results, `runCpuTrainingCamps` skipped every CPU
 * team as already submitted, and nobody in the league developed through camp
 * again. Keyed by season, a new year gets a fresh camp — including a save
 * written before the key existed, whose camp can only be a past season's
 * once a later one has begun.
 */
export function beginTrainingCamp(s: LeagueState): void {
  if (s.trainingCamp && s.trainingCamp.season === s.season) return;
  s.trainingCamp = { plans: {}, results: {}, season: s.season };
}

/**
 * The stage opening: a fresh camp for this season, then every CPU team's.
 * Called from both stage-entry paths (the local store's `applyStageEntry`
 * and online's `onStageEntered`) — the local one used to skip the CPU camps
 * entirely, so in a solo dynasty only the viewer's players ever developed.
 */
export function openTrainingCamp(s: LeagueState, humanTeams: Set<string>): void {
  if (s.trainingCamp?.season !== s.season) s.trainingCamp = null;
  beginTrainingCamp(s);
  runCpuTrainingCamps(s, humanTeams);
}

export function planFor(s: LeagueState, teamCode: string): TrainingCampPlan {
  return s.trainingCamp?.plans[teamCode] ?? emptyPlan();
}

/**
 * How much a coordinator's attention is worth, as a fraction.
 *
 * Twenty percent at a league-average coordinator, a point for every point of
 * rating either side, floored at five and capped at forty-five — see the
 * constants below for why those are double what Change 5 writes down. The
 * floor is the interesting part: even a poor coordinator helps the group he
 * concentrates on, because deliberately spending practice time on a unit is
 * not something that can go negative. A bad coach wastes the opportunity; he
 * does not actively make his players worse by paying attention to them.
 */
/**
 * Double Change 5's written figures on every term, and deliberately so.
 *
 * The spec says 10% at an average coordinator, half a point per rating
 * point, floored at 3 and capped at 24. The Aging + Training Camp
 * optimization pass doubled all four, for the reason it gives beside the
 * position-coach slope in `coachEffects.ts`: development lands as an
 * integer rating change, and at the specified size the coaching effect
 * rounded away for most players before it could be seen. The change log
 * leaves "reassess the coordinator-focus strength, caps, rounding and
 * stacking" open as an optimization bookmark, and this is that reassessment
 * having happened.
 *
 * Named because the docstring above described the specified numbers long
 * after the code stopped using them, which reads as drift and invites
 * someone to "fix" the balance back.
 */
const FOCUS_AT_AVERAGE = 0.2;
const FOCUS_PER_RATING_POINT = 0.01;
const FOCUS_MIN = 0.05;
const FOCUS_MAX = 0.45;
const AVERAGE_COORDINATOR = 72;

export function focusStrength(coordinatorRating: number): number {
  const raw =
    FOCUS_AT_AVERAGE + FOCUS_PER_RATING_POINT * (coordinatorRating - AVERAGE_COORDINATOR);
  return Math.max(FOCUS_MIN, Math.min(FOCUS_MAX, raw));
}

/** The coordinator whose focus covers this group. */
function coordinatorFor(s: LeagueState, teamCode: string, group: string): number {
  const role = (DEFENSIVE_FOCUSES as readonly string[]).includes(group) ? "DC" : "OC";
  const coach = Object.values(s.coaches).find((c) => c.team === teamCode && c.role === role);
  return coach ? ratingOf(coach) : 72;
}

/** Whether this position is inside the group the team focused on. */
function inFocus(position: string, focus: string | null): boolean {
  if (!focus) return false;
  const group = COACH_POSITION_GROUPS[focus as keyof typeof COACH_POSITION_GROUPS];
  return !!group && group.includes(position);
}

export interface CampCheck {
  ok: boolean;
  reason?: string;
}

export function checkCampSubmission(plan: TrainingCampPlan): CampCheck {
  if (!plan.offensiveFocus) return { ok: false, reason: "Choose an offensive focus." };
  if (!plan.defensiveFocus) return { ok: false, reason: "Choose a defensive focus." };
  return { ok: true };
}

/**
 * Run one team's camp.
 *
 * Deterministic per player and season, so a retry after a failed save
 * produces the same camp rather than a second roll of the dice.
 */
export function runTrainingCamp(s: LeagueState, teamCode: string, plan: TrainingCampPlan): void {
  beginTrainingCamp(s);
  const camp = s.trainingCamp!;
  const results: TrainingCampResult[] = [];

  const offStrength = focusStrength(coordinatorFor(s, teamCode, plan.offensiveFocus ?? "QB"));
  const defStrength = focusStrength(coordinatorFor(s, teamCode, plan.defensiveFocus ?? "DL"));

  const balance = agingBalance(s);
  for (const p of Object.values(s.players)) {
    if (p.nfl_team !== teamCode || p.retired || p.free_agent) continue;

    // 1. what the aging model says, nudged toward the league's positional
    //    balance (`agingBalance`)
    const rng = new Rng((s.season * 9151) ^ hash(p.id));
    const room = p.potential === undefined ? undefined : p.potential - p.overall;
    const base = balance(p.position, agingDelta(rng, p.age, p.dev_age_threshold, p.decline_age_threshold, room));

    // 2. the position coach
    const withCoach = applyCoachToDelta(base, coachModifiersFor(s, teamCode, p.position));

    // 3. the coordinator's focus, if this player is in the group
    let delta = withCoach;
    const focused =
      inFocus(p.position, plan.offensiveFocus) || inFocus(p.position, plan.defensiveFocus);
    if (focused && delta !== 0) {
      const f = inFocus(p.position, plan.offensiveFocus) ? offStrength : defStrength;
      // more development, or less decline — never a change of direction
      const scaled = delta > 0 ? delta * (1 + f) : delta * (1 - f);
      delta = Math.round(scaled);
      if (delta === 0) delta = withCoach > 0 ? 1 : -1;
    }

    const previous = p.overall;
    const next = Math.max(0, Math.min(99, previous + delta));
    if (next !== previous) {
      p.overall = next;
      for (const k of Object.keys(p.attributes)) {
        p.attributes[k] = Math.max(0, Math.min(99, (p.attributes[k] ?? 0) + delta));
      }
    }
    results.push({ playerId: p.id, position: p.position, previous, delta: next - previous, next });
  }

  camp.plans[teamCode] = { ...plan, submitted: true };
  camp.results[teamCode] = results;
}

/** CPU camps: concentrate where the roster is thinnest, and spend nothing. */
export function runCpuTrainingCamps(s: LeagueState, humanTeams: Set<string>): void {
  beginTrainingCamp(s);
  for (const teamCode of Object.keys(s.teams)) {
    if (humanTeams.has(teamCode)) continue;
    if (s.trainingCamp!.plans[teamCode]?.submitted) continue;

    // AI GM season strategy (§11): a bounded group preference on top of the
    // shared weakest-group evaluator. `strategyWeaknessMultiplier` only ever
    // amplifies the real weakness signal (high-floor), and the additive group
    // bonus is small enough that a catastrophically weak group still wins its
    // own focus regardless of what the strategy would otherwise prefer.
    const strategy = strategyFor(teamCode, s.season);
    // AI Difficulty (§18): focus-selection quality only — the optimized
    // development magnitudes in runTrainingCamp never change. Casual reads
    // the roster's weakness noisily; Expert adds a small tie-break toward
    // the group with more players still in their developing years, on top
    // of the same exact weakness signal every other level uses.
    const difficulty = difficultyProfile(s.config.difficulty);
    const weakest = (groups: readonly string[]): string => {
      let best = groups[0]!;
      let bestScore = -Infinity;
      for (const g of groups) {
        const positions = COACH_POSITION_GROUPS[g as keyof typeof COACH_POSITION_GROUPS] ?? [];
        const men = Object.values(s.players).filter(
          (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent && positions.includes(p.position),
        );
        const bestOvr = men.reduce((n, p) => Math.max(n, p.overall), 0);
        const noise =
          difficulty.evaluationNoise === 0
            ? 0
            : deterministicNoiseUnit(teamCode, s.season, "camp_focus", g) * difficulty.evaluationNoise;
        const weakness = (77 - bestOvr) * strategyWeaknessMultiplier(strategy) + noise;
        // Expert-only: up to +1.5, toward whichever group has the larger
        // share of players still below their development-age threshold.
        const developingShare =
          (s.config.difficulty === "expert" || s.config.difficulty === "master") && men.length > 0
            ? men.filter((p) => p.age < p.dev_age_threshold).length / men.length
            : 0;
        const score = weakness + strategyGroupBonus(strategy, g as OffensiveFocus | DefensiveFocus) + developingShare * 1.5;
        if (score > bestScore) {
          bestScore = score;
          best = g;
        }
      }
      return best;
    };

    runTrainingCamp(s, teamCode, {
      offensiveFocus: weakest(OFFENSIVE_FOCUSES) as OffensiveFocus,
      defensiveFocus: weakest(DEFENSIVE_FOCUSES) as DefensiveFocus,
      submitted: true,
    });
  }
}

function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
