import type { LeagueState } from "@/domain";
import { COACH_POSITION_GROUPS } from "@/domain";
import { Rng } from "@/sim/rng";
import { agingDelta } from "@/sim/MockSimulationService";

import { applyCoachToDelta, coachModifiersFor } from "./coachEffects";
import { ratingOf } from "./coachingDraft";

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
  /** $M put toward making good things likelier. */
  positiveInvestment: number;
  /** $M put toward making bad things rarer. */
  negativeInvestment: number;
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
}

export function emptyPlan(): TrainingCampPlan {
  return {
    offensiveFocus: null,
    defensiveFocus: null,
    positiveInvestment: 0,
    negativeInvestment: 0,
    submitted: false,
  };
}

export function beginTrainingCamp(s: LeagueState): void {
  if (s.trainingCamp) return;
  s.trainingCamp = { plans: {}, results: {} };
}

export function planFor(s: LeagueState, teamCode: string): TrainingCampPlan {
  return s.trainingCamp?.plans[teamCode] ?? emptyPlan();
}

/**
 * How much a coordinator's attention is worth, as a fraction.
 *
 * Ten percent at a league-average coordinator, half a point for every point
 * of rating either side, floored at three and capped at twenty-four. The
 * floor is the interesting part: even a poor coordinator helps the group he
 * concentrates on, because deliberately spending practice time on a unit is
 * not something that can go negative. A bad coach wastes the opportunity; he
 * does not actively make his players worse by paying attention to them.
 */
export function focusStrength(coordinatorRating: number): number {
  const raw = 0.1 + 0.005 * (coordinatorRating - 72);
  return Math.max(0.03, Math.min(0.24, raw));
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

export interface InvestmentCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether these two numbers are spendable.
 *
 * Both must be real, non-negative and together within the cap room the team
 * actually has. The money is gone once submitted, which is why this is strict
 * about it rather than clamping quietly — a GM who typed 40 when they meant 4
 * should be told, not silently charged 4.
 */
export function checkInvestments(
  s: LeagueState,
  teamCode: string,
  positive: number,
  negative: number,
): InvestmentCheck {
  if (!Number.isFinite(positive) || !Number.isFinite(negative)) {
    return { ok: false, reason: "Enter a number in each field, or leave them at 0." };
  }
  if (positive < 0 || negative < 0) {
    return { ok: false, reason: "Investments can't be negative." };
  }
  const team = s.teams[teamCode];
  if (!team) return { ok: false, reason: "Unknown team." };
  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;
  const asked = Math.round((positive + negative) * 10) / 10;
  if (asked > room) {
    return {
      ok: false,
      reason: `That's $${asked.toFixed(1)}M against $${room.toFixed(1)}M of cap space.`,
    };
  }
  return { ok: true };
}

/**
 * The odds multiplier bought by an investment.
 *
 * Applied to odds rather than added to a probability, so money can shift the
 * balance a long way without ever guaranteeing a good season or eliminating a
 * bad one. The square root is what makes the first million worth more than
 * the tenth — spending is worthwhile without being the whole game.
 */
export function oddsMultiplier(investmentMillions: number): number {
  return 1 + 0.1 * Math.sqrt(Math.max(0, investmentMillions));
}

export interface CampCheck {
  ok: boolean;
  reason?: string;
}

export function checkCampSubmission(s: LeagueState, teamCode: string, plan: TrainingCampPlan): CampCheck {
  if (!plan.offensiveFocus) return { ok: false, reason: "Choose an offensive focus." };
  if (!plan.defensiveFocus) return { ok: false, reason: "Choose a defensive focus." };
  return checkInvestments(s, teamCode, plan.positiveInvestment, plan.negativeInvestment);
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

  for (const p of Object.values(s.players)) {
    if (p.nfl_team !== teamCode || p.retired || p.free_agent) continue;

    // 1. what the aging model says, on its own
    const rng = new Rng((s.season * 9151) ^ hash(p.id));
    const base = agingDelta(rng, p.age, p.dev_age_threshold, p.decline_age_threshold);

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

  // the money leaves the cap for the season, whatever it buys
  const team = s.teams[teamCode];
  if (team) {
    team.cap.used =
      Math.round((team.cap.used + plan.positiveInvestment + plan.negativeInvestment) * 10) / 10;
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

    const weakest = (groups: readonly string[]): string => {
      let worst = groups[0]!;
      let worstRating = Infinity;
      for (const g of groups) {
        const positions = COACH_POSITION_GROUPS[g as keyof typeof COACH_POSITION_GROUPS] ?? [];
        const men = Object.values(s.players).filter(
          (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent && positions.includes(p.position),
        );
        const best = men.reduce((n, p) => Math.max(n, p.overall), 0);
        if (best < worstRating) {
          worstRating = best;
          worst = g;
        }
      }
      return worst;
    };

    runTrainingCamp(s, teamCode, {
      offensiveFocus: weakest(OFFENSIVE_FOCUSES) as OffensiveFocus,
      defensiveFocus: weakest(DEFENSIVE_FOCUSES) as DefensiveFocus,
      // the CPU does not gamble on events; the money is worth more on the cap
      positiveInvestment: 0,
      negativeInvestment: 0,
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
