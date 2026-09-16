import type { CoachRole, LeagueState } from "@/domain";
import { COACH_ROLES } from "@/domain";

import { ratingOf } from "./coachingDraft";

/**
 * What a staff is worth, as one number and as its parts.
 *
 * Two different questions get asked of a staff and they want different
 * weights, so both live here rather than being improvised at the call site.
 *
 * *How good is this staff overall* is a weighted average across all twelve,
 * with the head coach counting triple and the two coordinators double. That
 * ratio is a judgement rather than a measurement — it says a head coach
 * matters about as much as three position coaches, which is defensible and
 * unproven, and is flagged in the change log for calibration once there is
 * simulated evidence to calibrate against.
 *
 * *How good is this staff on offence* is a different question with a
 * different answer: the coordinator carries a third of it and the four
 * position coaches share the rest. The head coach is deliberately absent from
 * both unit composites — he is not an offensive or a defensive coach, and
 * counting him in each would double-count the one person already weighted
 * most heavily in the overall.
 */

/** Weight per job in the overall staff rating. */
export const STAFF_WEIGHTS: Record<CoachRole, number> = {
  HC: 3,
  OC: 2,
  DC: 2,
  QB: 1,
  RB: 1,
  OL: 1,
  WR: 1,
  DL: 1,
  LB: 1,
  DB: 1,
  ST: 1,
  MED: 1,
};

/** The offensive composite: coordinator a third, four position coaches the rest. */
const OFFENSE_COMPOSITE: Partial<Record<CoachRole, number>> = {
  OC: 1 / 3,
  QB: 1 / 6,
  RB: 1 / 6,
  OL: 1 / 6,
  WR: 1 / 6,
};

/** The defensive composite: coordinator two fifths, three position coaches a fifth each. */
const DEFENSE_COMPOSITE: Partial<Record<CoachRole, number>> = {
  DC: 0.4,
  DL: 0.2,
  LB: 0.2,
  DB: 0.2,
};

/** Every coach a team employs, by job. */
export function staffOf(s: LeagueState, teamCode: string): Partial<Record<CoachRole, number>> {
  const out: Partial<Record<CoachRole, number>> = {};
  for (const c of Object.values(s.coaches)) {
    if (c.team === teamCode) out[c.role] = ratingOf(c);
  }
  return out;
}

/**
 * A weighted average over whichever jobs are filled.
 *
 * Vacancies are skipped rather than scored as zero. A team one coach short
 * should read as a staff of eleven, not as a staff with a catastrophe in it —
 * scoring the gap would make one vacancy swamp every real rating around it.
 */
function weightedAverage(
  ratings: Partial<Record<CoachRole, number>>,
  weights: Partial<Record<CoachRole, number>>,
): number {
  let total = 0;
  let weight = 0;
  for (const role of Object.keys(weights) as CoachRole[]) {
    const r = ratings[role];
    const w = weights[role];
    if (r == null || w == null) continue;
    total += r * w;
    weight += w;
  }
  return weight === 0 ? 0 : Math.round(total / weight);
}

/** The headline number: a weighted average across all twelve jobs. */
export function staffOverall(s: LeagueState, teamCode: string): number {
  return weightedAverage(staffOf(s, teamCode), STAFF_WEIGHTS);
}

export function offensiveComposite(s: LeagueState, teamCode: string): number {
  return weightedAverage(staffOf(s, teamCode), OFFENSE_COMPOSITE);
}

export function defensiveComposite(s: LeagueState, teamCode: string): number {
  return weightedAverage(staffOf(s, teamCode), DEFENSE_COMPOSITE);
}

export interface StaffCard {
  teamCode: string;
  overall: number;
  offense: number;
  defense: number;
  headCoach: number;
  specialTeams: number;
  medical: number;
}

/** One row per team, for the comparison table. */
export function staffCards(s: LeagueState): StaffCard[] {
  return Object.keys(s.teams).map((teamCode) => {
    const r = staffOf(s, teamCode);
    return {
      teamCode,
      overall: staffOverall(s, teamCode),
      offense: offensiveComposite(s, teamCode),
      defense: defensiveComposite(s, teamCode),
      headCoach: r.HC ?? 0,
      specialTeams: r.ST ?? 0,
      medical: r.MED ?? 0,
    };
  });
}

/**
 * League ranks, 1 = best, ties sharing the better rank.
 *
 * Ties are common here — twelve ratings averaged into one integer collide
 * often — and giving two teams joint fourth rather than an arbitrary fourth
 * and fifth is both correct and avoids a table that reshuffles on a redraw.
 */
export function rankBy(cards: StaffCard[], key: keyof Omit<StaffCard, "teamCode">): Map<string, number> {
  const sorted = [...cards].sort((a, b) => b[key] - a[key]);
  const ranks = new Map<string, number>();
  let lastValue: number | null = null;
  let lastRank = 0;
  sorted.forEach((c, i) => {
    const rank = lastValue !== null && c[key] === lastValue ? lastRank : i + 1;
    ranks.set(c.teamCode, rank);
    lastValue = c[key];
    lastRank = rank;
  });
  return ranks;
}

/** Whether every job on this team is filled — the summary needs to say so. */
export function staffComplete(s: LeagueState, teamCode: string): boolean {
  const r = staffOf(s, teamCode);
  return COACH_ROLES.every((role) => r[role] != null);
}
