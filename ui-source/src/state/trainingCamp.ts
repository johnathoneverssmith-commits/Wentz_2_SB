import type { LeagueState, Player } from "@/domain";
import { startHoldouts } from "./contracts";
import { COACH_POSITION_GROUPS } from "@/domain";
import { Rng } from "@/sim/rng";
import { agingDelta } from "@/sim/MockSimulationService";
import { careerShape } from "@/sim/careerShape";
import { agingBalance } from "./draftSupply";
import { expectedAgingDelta } from "@/sim/MockSimulationService";
import { UNITS } from "./unitValue";

import { applyCoachToDelta, coachModifiersFor, developmentRoll, roundBy } from "./coachEffects";
import { ratingOf } from "./coachingDraft";
import { gamePlanFor, rookieDevelopment } from "./gamePlan.ts";
import { rookieRoles } from "../../../src/engine/rookies.js";
import { strategyGroupBonus, strategyWeaknessMultiplier } from "./aiStrategy.ts";
import { deterministicNoiseUnit } from "./aiDifficulty.ts";
import { difficultyFor, strategyOf } from "./aiGms.ts";

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
  /**
   * How many camps in a row (before this one) this team has chosen this same focus, set when the camp runs.
   * Absent on a plan from before streaks were kept, which reads as 0.
   */
  offensiveStreak?: number;
  defensiveStreak?: number;
}

/**
 * What a team did at the camp before this one: its two focuses and how long it had held each. Kept inside the camp
 * state (no new table, no migration) because the camp is replaced every season; it is carried over at the moment
 * the new camp opens, and only from the season immediately before. It belongs to the team, never to a GM.
 */
export interface CampPrior {
  offensiveFocus: OffensiveFocus | null;
  defensiveFocus: DefensiveFocus | null;
  offensiveStreak: number;
  defensiveStreak: number;
}

/** Each consecutive repeat of a focus keeps this share of the strength the one before had. */
export const REPEAT_DECAY = 0.8;

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
  /** Last season's choices, by team: the repeat history. Absent in a save from before it was kept, or after a skipped season. */
  prior?: Record<string, CampPrior>;
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
  // the repeat history is read off the camp this one replaces, and only when it was last season's
  const prev = s.trainingCamp;
  const prior: Record<string, CampPrior> = {};
  if (prev && prev.season === s.season - 1) {
    for (const [team, plan] of Object.entries(prev.plans)) {
      if (!plan.submitted) continue;
      prior[team] = {
        offensiveFocus: plan.offensiveFocus,
        defensiveFocus: plan.defensiveFocus,
        offensiveStreak: plan.offensiveStreak ?? 0,
        defensiveStreak: plan.defensiveStreak ?? 0,
      };
    }
  }
  s.trainingCamp = { plans: {}, results: {}, season: s.season, ...(Object.keys(prior).length ? { prior } : {}) };
}

/** Consecutive earlier camps in which `team` chose `focus` (0 for a first choice, a switch, a skipped year or an old save). */
export function focusStreak(s: LeagueState, team: string, side: "offense" | "defense", focus: string | null): number {
  const prior = s.trainingCamp?.prior?.[team];
  if (!prior || !focus) return 0;
  return side === "offense"
    ? prior.offensiveFocus === focus ? prior.offensiveStreak + 1 : 0
    : prior.defensiveFocus === focus ? prior.defensiveStreak + 1 : 0;
}

/**
 * The stage opening: a fresh camp for this season, then every CPU team's.
 * Called from both stage-entry paths (the local store's `applyStageEntry`
 * and online's `onStageEntered`) — the local one used to skip the CPU camps
 * entirely, so in a solo dynasty only the viewer's players ever developed.
 */
export function openTrainingCamp(s: LeagueState, humanTeams: Set<string>): Player[] {
  const fresh = s.trainingCamp?.season !== s.season;
  beginTrainingCamp(s); // carries last season's choices over before it replaces the camp
  runCpuTrainingCamps(s, humanTeams);
  // the underpaid stars decide whether to report (`startHoldouts`), once a season
  return fresh ? startHoldouts(s, humanTeams) : [];
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

  // a focus held for several camps running is worth a little less each time; the streak comes from last
  // season's stored choice, so running the same plan again (a retry) gives the same camp
  const offensiveStreak = focusStreak(s, teamCode, "offense", plan.offensiveFocus);
  const defensiveStreak = focusStreak(s, teamCode, "defense", plan.defensiveFocus);
  const offStrength = focusStrength(coordinatorFor(s, teamCode, plan.offensiveFocus ?? "QB")) * REPEAT_DECAY ** offensiveStreak;
  const defStrength = focusStrength(coordinatorFor(s, teamCode, plan.defensiveFocus ?? "DL")) * REPEAT_DECAY ** defensiveStreak;

  const balance = agingBalance(s);
  const rookiePolicy = gamePlanFor(s, teamCode).rookies;
  const roles =
    rookiePolicy === 0
      ? new Map<string, "promoted" | "merit" | "benched">()
      : rookieRoles(
          Object.values(s.players).filter((p) => p.nfl_team === teamCode && !p.retired && !p.free_agent),
          rookiePolicy,
          s.depthChart?.[teamCode],
        );
  for (const p of Object.values(s.players)) {
    if (p.nfl_team !== teamCode || p.retired || p.free_agent) continue;

    // 1. what the aging model says, nudged toward the league's positional
    //    balance (`agingBalance`)
    const rng = new Rng((s.season * 9151) ^ hash(p.id));
    const room = p.potential === undefined ? undefined : p.potential - p.overall;
    const aged = balance(p.position, agingDelta(rng, p.age, p.dev_age_threshold, p.decline_age_threshold, room, careerShape(p)));
    // the rookie policy: young players who got the snaps grow, those who sat on the bench grow less
    // (a whole point, rolled with the player's own seeded stream so a retry is the same camp)
    const grow = rookiePolicy === 0 ? 0 : rookieDevelopment(rookiePolicy, p, roles.get(p.id));
    const extra = grow === 0 ? 0 : grow > 0 ? Math.floor(grow + rng.random()) : -Math.floor(-grow + rng.random());
    const base = aged + extra;

    // 2. the position coach
    const withCoach = applyCoachToDelta(base, coachModifiersFor(s, teamCode, p.position), developmentRoll(s.season, p.id, "coach"));

    // 3. the coordinator's focus, if this player is in the group
    let delta = withCoach;
    const focused =
      inFocus(p.position, plan.offensiveFocus) || inFocus(p.position, plan.defensiveFocus);
    if (focused && delta !== 0) {
      const f = inFocus(p.position, plan.offensiveFocus) ? offStrength : defStrength;
      // more development, or less decline — never a change of direction
      const scaled = delta > 0 ? delta * (1 + f) : delta * (1 - f);
      delta = roundBy(scaled, developmentRoll(s.season, p.id, "focus"));
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

  camp.plans[teamCode] = { ...plan, submitted: true, offensiveStreak, defensiveStreak };
  camp.results[teamCode] = results;
}

/**
 * What focusing `group` is worth to `team` this camp, in the units `unitValue.ts` measures (points of margin per rating
 * point across a unit): for each starter the unit counts, his share of the unit's weight times how far he is still
 * expected to move this year. A prime-age starter is worth nothing to focus (nothing to speed up or slow), a young
 * starter with room or a declining one is. Shaped by his own career (`careerShape`), as the camp will apply it.
 */
export function focusGroupValue(s: LeagueState, team: string, group: string): number {
  const positions = (COACH_POSITION_GROUPS as Record<string, readonly string[]>)[group] ?? [];
  const roster = Object.values(s.players).filter((p) => p.nfl_team === team && !p.retired && !p.free_agent);
  let value = 0;
  for (const unit of Object.values(UNITS)) {
    const slotsInUnit = Object.values(unit.slots).reduce((a, b) => a + b, 0);
    for (const [position, slots] of Object.entries(unit.slots)) {
      if (!positions.includes(position)) continue;
      const starters = roster.filter((p) => p.position === position).sort((a, b) => b.overall - a.overall).slice(0, slots);
      for (const p of starters) {
        const shape = careerShape(p);
        const dev = p.dev_age_threshold + shape.devShift;
        const decline = Math.max(dev + 1, p.decline_age_threshold + shape.declineShift);
        const room = p.potential === undefined ? undefined : p.potential - p.overall;
        const mean = expectedAgingDelta(p.age, dev, decline, room) * (p.age < dev ? shape.growth : p.age >= decline ? shape.slope : 1);
        value += (unit.weight / slotsInUnit) * Math.abs(mean);
      }
    }
  }
  return value;
}

/** CPU camps: put the focus where a camp adds the most strength, and spend nothing. */
export function runCpuTrainingCamps(s: LeagueState, humanTeams: Set<string>): void {
  beginTrainingCamp(s);
  for (const teamCode of Object.keys(s.teams)) {
    if (humanTeams.has(teamCode)) continue;
    if (s.trainingCamp!.plans[teamCode]?.submitted) continue;

    // AI GM season strategy (§11): a bounded group preference on top of the
    // value score below. `strategyWeaknessMultiplier` only ever amplifies the
    // value signal (high-floor), and the additive group bonus stays small
    // enough that a group with far more to gain still wins its own focus.
    const strategy = strategyOf(s, teamCode);
    // AI Difficulty (§18): focus-selection quality only — the optimized
    // development magnitudes in runTrainingCamp never change. Casual reads
    // the roster's value noisily; Expert reads it exactly.
    const difficulty = difficultyFor(s, teamCode);
    // PD-3: a group's worth is what a camp can actually add to the team's strength — its starters' unit weights
    // times how much each is still expected to move (growing or declining, by his own career shape) — scaled to 0-10
    // against the best group on that side, and cut by the repeat decay for a focus held several camps running.
    const pickFocus = (groups: readonly string[], side: "offense" | "defense"): string => {
      const values = groups.map((g) => focusGroupValue(s, teamCode, g));
      const top = Math.max(...values);
      let best = groups[0]!;
      let bestScore = -Infinity;
      groups.forEach((g, i) => {
        const noise =
          difficulty.evaluationNoise === 0
            ? 0
            : deterministicNoiseUnit(teamCode, s.season, "camp_focus", g) * difficulty.evaluationNoise;
        const repeat = REPEAT_DECAY ** focusStreak(s, teamCode, side, g);
        const worth = top > 0 ? (10 * values[i]! * repeat) / top : 0;
        const score = worth * strategyWeaknessMultiplier(strategy) + noise + strategyGroupBonus(strategy, g as OffensiveFocus | DefensiveFocus);
        if (score > bestScore) {
          bestScore = score;
          best = g;
        }
      });
      return best;
    };

    runTrainingCamp(s, teamCode, {
      offensiveFocus: pickFocus(OFFENSIVE_FOCUSES, "offense") as OffensiveFocus,
      defensiveFocus: pickFocus(DEFENSIVE_FOCUSES, "defense") as DefensiveFocus,
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
